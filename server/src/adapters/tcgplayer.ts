import { config } from '../config.js';
import { cardsRepo, kv, snapshotsRepo, watchlistRepo } from '../db.js';
import type { Card, CardKind, Listing, MarketAdapter, PriceSnapshot, SourceHealth } from '../types.js';
import { SourceRuntime, fetchJson } from './runtime.js';

/**
 * TCGplayer adapter, two tiers behind one interface:
 *
 *  1. Catalog + daily prices from TCGCSV (https://tcgcsv.com) — free daily
 *     mirrors of TCGplayer's own catalog and market prices. ToS-clean.
 *  2. Gentle intraday top-ups from TCGplayer's public price-points endpoint,
 *     only for watchlisted cards and current movers, hard rate-limited and
 *     cached. Disable with TCGPLAYER_INTRADAY=0.
 */
export class TcgplayerAdapter implements MarketAdapter {
  readonly id = 'tcgplayer' as const;
  readonly label = 'TCGplayer (via TCGCSV daily + intraday top-up)';
  private rt = new SourceRuntime('tcgplayer', config.tcgplayerMinRequestIntervalMs, this.label);
  private categoryId: number | null = config.tcgplayerCategoryId || null;
  private groupIds: number[] = [];
  private lastCatalogTs = 0;
  private intradayCache = new Map<number, { ts: number; snap: PriceSnapshot }>();

  health(): SourceHealth {
    return this.rt.health();
  }

  force(state: Parameters<SourceRuntime['force']>[0], detail?: string) {
    this.rt.force(state, detail);
  }

  private async resolveCategory(): Promise<number> {
    if (this.categoryId) return this.categoryId;
    const cached = kv.get('tcg_category_id');
    if (cached) return (this.categoryId = Number(cached));
    const data = await this.rt.guard(() => fetchJson(`${config.tcgcsvBase}/categories`));
    const cats: any[] = data.results ?? data;
    const rift = cats.find((c) => /riftbound/i.test(`${c.name} ${c.displayName ?? ''}`));
    if (!rift) throw new Error('Riftbound category not found on TCGCSV');
    this.categoryId = rift.categoryId;
    kv.set('tcg_category_id', String(rift.categoryId));
    return rift.categoryId;
  }

  /** Refresh the card catalog (products) — cheap, a handful of requests. */
  async refreshCatalog(): Promise<number> {
    const cat = await this.resolveCategory();
    const groupsData = await this.rt.guard(() => fetchJson(`${config.tcgcsvBase}/${cat}/groups`));
    const groups: any[] = groupsData.results ?? groupsData;
    this.groupIds = groups.map((g) => g.groupId);
    let count = 0;
    for (const g of groups) {
      const prodData = await this.rt.guard(() => fetchJson(`${config.tcgcsvBase}/${cat}/${g.groupId}/products`));
      const products: any[] = prodData.results ?? prodData;
      for (const p of products) {
        const ext = Object.fromEntries(
          (p.extendedData ?? []).map((e: any) => [String(e.name).toLowerCase(), e.value]),
        );
        const kind: CardKind = /pack|box|bundle|display|case/i.test(p.name)
          ? 'sealed'
          : /promo/i.test(`${p.name} ${ext['rarity'] ?? ''}`)
            ? 'promo'
            : 'single';
        cardsRepo.upsertByTcgProductId({
          name: p.cleanName ?? p.name,
          setName: g.name,
          number: ext['number'] ?? null,
          rarity: ext['rarity'] ?? null,
          finish: null,
          kind,
          tcgplayerProductId: p.productId,
        });
        count++;
      }
    }
    this.lastCatalogTs = Date.now();
    return count;
  }

  /** Daily price pull for the whole catalog from TCGCSV. */
  async poll(): Promise<PriceSnapshot[]> {
    const cat = await this.resolveCategory();
    if (!this.groupIds.length || Date.now() - this.lastCatalogTs > config.catalogRefreshMs) {
      await this.refreshCatalog();
    }
    const byProduct = new Map<number, Card>();
    for (const c of cardsRepo.all()) if (c.tcgplayerProductId) byProduct.set(c.tcgplayerProductId, c);
    const out: PriceSnapshot[] = [];
    const ts = Date.now();
    for (const gid of this.groupIds) {
      const priceData = await this.rt.guard(() => fetchJson(`${config.tcgcsvBase}/${cat}/${gid}/prices`));
      const prices: any[] = priceData.results ?? priceData;
      for (const p of prices) {
        const card = byProduct.get(p.productId);
        if (!card) continue;
        out.push({
          cardId: card.id,
          source: 'tcgplayer',
          ts,
          marketPrice: p.marketPrice ?? p.midPrice ?? null,
          lowPrice: p.lowPrice ?? null,
          listingCount: null,
          salesVolume: null,
          provenance: 'live',
        });
      }
    }
    // Intraday top-up for the cards that matter most right now.
    if (config.tcgplayerIntradayEnabled) {
      const focus = new Set<number>(watchlistRepo.ids());
      for (const cardId of focus) {
        const snap = await this.intraday(cardId).catch(() => null);
        if (snap) out.push(snap);
      }
    }
    return out;
  }

  /**
   * Intraday price for one card via TCGplayer's public price-points endpoint.
   * Cached 15 minutes; globally paced by the source rate limiter.
   */
  async intraday(cardId: number): Promise<PriceSnapshot | null> {
    const card = cardsRepo.byId(cardId);
    if (!card?.tcgplayerProductId) return null;
    const cached = this.intradayCache.get(cardId);
    if (cached && Date.now() - cached.ts < 15 * 60_000) return cached.snap;
    const data = await this.rt.guard(() =>
      fetchJson(`https://mpapi.tcgplayer.com/v2/product/${card.tcgplayerProductId}/pricepoints`),
    );
    const points: any[] = Array.isArray(data) ? data : (data.results ?? []);
    const normal = points.find((p) => /normal/i.test(p.printingType ?? '')) ?? points[0];
    if (!normal) return null;
    const snap: PriceSnapshot = {
      cardId,
      source: 'tcgplayer',
      ts: Date.now(),
      marketPrice: normal.marketPrice ?? null,
      lowPrice: normal.listedMedianPrice ?? normal.buylistMarketPrice ?? null,
      listingCount: null,
      salesVolume: null,
      provenance: 'live',
    };
    this.intradayCache.set(cardId, { ts: Date.now(), snap });
    return snap;
  }

  async search(query: string, opts?: { limit?: number }): Promise<Listing[]> {
    // Search is served from the ingested catalog + latest snapshots; TCGplayer
    // "best price" is the lowPrice of the latest snapshot for matched cards.
    const cards = cardsRepo.search(query, opts?.limit ?? 10);
    const out: Listing[] = [];
    for (const card of cards) {
      const snap = snapshotsRepo.latestForCard(card.id, 'tcgplayer');
      if (!snap || snap.lowPrice == null) continue;
      out.push({
        cardId: card.id,
        source: 'tcgplayer',
        ts: snap.ts,
        title: `${card.name} · ${card.setName}${card.number ? ` #${card.number}` : ''}`,
        price: snap.lowPrice,
        shipping: null,
        condition: 'NM (market low)',
        url: card.tcgplayerProductId
          ? `https://www.tcgplayer.com/product/${card.tcgplayerProductId}`
          : null,
        provenance: snap.provenance,
      });
    }
    return out;
  }
}
