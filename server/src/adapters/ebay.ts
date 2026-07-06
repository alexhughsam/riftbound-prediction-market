import { config } from '../config.js';
import { cardsRepo, snapshotsRepo, watchlistRepo } from '../db.js';
import type { Card, Listing, MarketAdapter, PriceSnapshot, SourceHealth } from '../types.js';
import { SourceRuntime, fetchJson } from './runtime.js';

/**
 * eBay via the official Browse API (client-credentials OAuth).
 * Requires EBAY_CLIENT_ID / EBAY_CLIENT_SECRET from a free developer account.
 *
 * Averages are computed over ACTIVE listings (sold-price history is a
 * restricted eBay API) and are labeled as such in the UI.
 */
export class EbayAdapter implements MarketAdapter {
  readonly id = 'ebay' as const;
  readonly label = 'eBay Browse API (active listings)';
  private rt = new SourceRuntime('ebay', config.ebayMinRequestIntervalMs, this.label);
  private token: { value: string; expiresTs: number } | null = null;
  private searchCache = new Map<string, { ts: number; listings: Listing[] }>();

  get configured(): boolean {
    return Boolean(config.ebayClientId && config.ebayClientSecret);
  }

  health(): SourceHealth {
    if (!this.configured && !this.rt.isForced) {
      return {
        source: 'ebay',
        state: 'disabled',
        detail: 'no EBAY_CLIENT_ID/EBAY_CLIENT_SECRET in .env — register free at developer.ebay.com',
        lastOkTs: null,
        lastCheckTs: null,
        consecutiveFailures: 0,
      };
    }
    return this.rt.health();
  }

  force(state: Parameters<SourceRuntime['force']>[0], detail?: string) {
    this.rt.force(state, detail);
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresTs - 60_000) return this.token.value;
    const basic = Buffer.from(`${config.ebayClientId}:${config.ebayClientSecret}`).toString('base64');
    const data = await this.rt.guard(() =>
      fetchJson('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
          authorization: `Basic ${basic}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
      }),
    );
    this.token = { value: data.access_token, expiresTs: Date.now() + data.expires_in * 1000 };
    return this.token.value;
  }

  private async browseSearch(q: string, limit: number): Promise<any[]> {
    const token = await this.getToken();
    const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(limit));
    // CCG categories: 183454 singles, 261329 graded — keep broad, filter by title.
    url.searchParams.set('category_ids', '2536');
    const data = await this.rt.guard(() =>
      fetchJson(url.toString(), { headers: { authorization: `Bearer ${token}` } }),
    );
    return data.itemSummaries ?? [];
  }

  private toListings(items: any[], cardId: number | null): Listing[] {
    const ts = Date.now();
    return items
      .filter((it) => it.price?.value != null)
      .map((it) => ({
        cardId,
        source: 'ebay' as const,
        ts,
        title: it.title,
        price: Number(it.price.value),
        shipping: it.shippingOptions?.[0]?.shippingCost?.value != null
          ? Number(it.shippingOptions[0].shippingCost.value)
          : null,
        condition: it.condition ?? null,
        url: it.itemWebUrl ?? null,
        provenance: 'live' as const,
      }));
  }

  async search(query: string, opts?: { limit?: number }): Promise<Listing[]> {
    if (!this.configured) throw new Error('ebay adapter not configured');
    const key = `${query}|${opts?.limit ?? 25}`;
    const cached = this.searchCache.get(key);
    if (cached && Date.now() - cached.ts < 10 * 60_000) return cached.listings;
    const items = await this.browseSearch(`riftbound ${query}`, opts?.limit ?? 25);
    const listings = this.toListings(items, null);
    this.searchCache.set(key, { ts: Date.now(), listings });
    return listings;
  }

  /**
   * Poll prices for watch-worthy cards: query each card's canonical name and
   * derive avg (trimmed mean of actives) + best price. Deliberately bounded —
   * eBay polling covers watchlist + cards already having tcgplayer data
   * movement, not the whole catalog (rate-limit respect).
   */
  async poll(): Promise<PriceSnapshot[]> {
    if (!this.configured) return [];
    const targets = this.pollTargets();
    const out: PriceSnapshot[] = [];
    for (const card of targets) {
      try {
        const q = `${card.name} ${card.number ?? ''}`.trim();
        const items = await this.browseSearch(`riftbound ${q}`, 25);
        const listings = this.toListings(items, card.id).filter((l) => relevance(l.title, card));
        if (!listings.length) continue;
        const prices = listings.map((l) => l.price + (l.shipping ?? 0)).sort((a, b) => a - b);
        const trimmed = prices.slice(0, Math.max(1, Math.floor(prices.length * 0.8))); // drop top 20% outliers
        const avg = trimmed.reduce((s, p) => s + p, 0) / trimmed.length;
        out.push({
          cardId: card.id,
          source: 'ebay',
          ts: Date.now(),
          marketPrice: round2(avg),
          lowPrice: round2(prices[0]),
          listingCount: listings.length,
          salesVolume: null,
          provenance: 'live',
        });
      } catch {
        // guard() already tracked the failure; move on to the next card
      }
    }
    return out;
  }

  private pollTargets(): Card[] {
    const ids = new Set<number>(watchlistRepo.ids());
    // include cards that recently moved on tcgplayer so spread detection works
    for (const id of snapshotsRepo.cardsWithData().slice(0, 40)) ids.add(id);
    return [...ids].map((id) => cardsRepo.byId(id)).filter((c): c is Card => Boolean(c)).slice(0, 40);
  }
}

function relevance(title: string, card: Card): boolean {
  const t = title.toLowerCase();
  const words = card.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const hits = words.filter((w) => t.includes(w)).length;
  return hits >= Math.max(1, Math.ceil(words.length * 0.6));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
