import { cardsRepo, feedRepo, kv, snapshotsRepo } from '../db.js';
import type { Card, CardKind, FeedItem, PriceSnapshot } from '../types.js';

/**
 * SAMPLE market simulator.
 *
 * Used when real sources are unreachable or unconfigured (or RBT_MODE=sample).
 * Everything it produces carries provenance 'sample' (or 'synthetic' for
 * operator-injected scenario events) and the UI renders those loudly — a
 * sample number is never allowed to look live. Card names/prices are
 * plausible demo data, not real market values.
 */

interface SampleSpec {
  name: string;
  set: string;
  number: string | null;
  rarity: string | null;
  kind: CardKind;
  base: number; // baseline USD price
  vol: number; // daily volatility (fraction)
}

const CATALOG: SampleSpec[] = [
  { name: 'Jinx, Loose Cannon', set: 'Origins', number: '045/298', rarity: 'Legendary', kind: 'single', base: 42, vol: 0.05 },
  { name: 'Viktor, Herald of Progress', set: 'Origins', number: '112/298', rarity: 'Legendary', kind: 'single', base: 31, vol: 0.06 },
  { name: 'Yasuo, Unforgiven', set: 'Origins', number: '078/298', rarity: 'Epic', kind: 'single', base: 18.5, vol: 0.05 },
  { name: 'Lee Sin, Blind Monk', set: 'Origins', number: '091/298', rarity: 'Epic', kind: 'single', base: 14, vol: 0.05 },
  { name: 'Annie, Dark Child', set: 'Origins', number: '023/298', rarity: 'Rare', kind: 'single', base: 6.25, vol: 0.07 },
  { name: 'Garen, Might of Demacia', set: 'Origins', number: '007/298', rarity: 'Rare', kind: 'single', base: 3.8, vol: 0.06 },
  { name: 'Ahri, Nine-Tailed Fox', set: 'Origins', number: '134/298', rarity: 'Epic', kind: 'single', base: 22, vol: 0.06 },
  { name: 'Ekko, Boy Who Shattered Time', set: 'Origins', number: '156/298', rarity: 'Epic', kind: 'single', base: 12.5, vol: 0.08 },
  { name: 'Volibear, Relentless Storm', set: 'Origins', number: '188/298', rarity: 'Rare', kind: 'single', base: 2.4, vol: 0.09 },
  { name: 'Sett, The Boss', set: 'Origins', number: '167/298', rarity: 'Epic', kind: 'single', base: 9.75, vol: 0.07 },
  { name: 'Lux, Lady of Luminosity', set: 'Origins', number: '012/298', rarity: 'Rare', kind: 'single', base: 5.5, vol: 0.06 },
  { name: 'Master Yi, Wuju Bladesman', set: 'Origins', number: '099/298', rarity: 'Rare', kind: 'single', base: 4.2, vol: 0.06 },
  { name: 'Jinx, Loose Cannon (Overnumbered)', set: 'Origins', number: '311/298', rarity: 'Overnumbered', kind: 'single', base: 480, vol: 0.04 },
  { name: 'Ahri, Nine-Tailed Fox (Overnumbered)', set: 'Origins', number: '305/298', rarity: 'Overnumbered', kind: 'single', base: 350, vol: 0.05 },
  { name: 'Teemo, Swift Scout (Convention Promo)', set: 'Promos', number: 'P-001', rarity: 'Promo', kind: 'promo', base: 195, vol: 0.05 },
  { name: 'Jinx, Loose Cannon PSA 10', set: 'Origins (Graded)', number: '045/298', rarity: 'Legendary', kind: 'slab', base: 145, vol: 0.04 },
  { name: 'Teemo Promo PSA 10', set: 'Promos (Graded)', number: 'P-001', rarity: 'Promo', kind: 'slab', base: 520, vol: 0.05 },
  { name: 'Origins Booster Box', set: 'Origins', number: null, rarity: null, kind: 'sealed', base: 128, vol: 0.02 },
  { name: 'Origins Collector Booster Box', set: 'Origins', number: null, rarity: null, kind: 'sealed', base: 310, vol: 0.03 },
  { name: 'Riven, Exile', set: 'Origins', number: '203/298', rarity: 'Rare', kind: 'single', base: 1.9, vol: 0.1 },
  { name: 'Darius, Hand of Noxus', set: 'Origins', number: '211/298', rarity: 'Epic', kind: 'single', base: 7.4, vol: 0.07 },
  { name: 'Braum, Heart of the Freljord', set: 'Origins', number: '242/298', rarity: 'Rare', kind: 'single', base: 1.2, vol: 0.08 },
];

const FEED_TEMPLATES: ((card: string) => string)[] = [
  (c) => `${c} keeps disappearing off vendor tables. Someone knows something. #Riftbound`,
  (c) => `New list from the weekend 4-0'd locals running 3x ${c}. Sleeper no more.`,
  (c) => `Vendors at regionals were paying over TCG mid for ${c}. That's your signal.`,
  (c) => `Quietly, ${c} supply on eBay is half what it was Tuesday.`,
  (c) => `If the leak about next set support is real, ${c} is the buy. NFA.`,
];
const FEED_FILLER: string[] = [
  'Origins collector box distribution feels tighter this wave. Watch sealed.',
  'Reminder: grade your overnumbered pulls. Population counts are tiny right now.',
  'Set 2 announcement stream confirmed for next month. Position accordingly.',
  'Local scene doubling every month. Demand side of this game is not priced in.',
  'PSA turnaround on Riftbound slabs down to 12 days. More supply incoming.',
];

// Deterministic PRNG so sample data is reproducible run-to-run.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SampleMarket {
  private rng = mulberry32(0x5eed);
  private cards: Card[] = [];
  private lastPrice = new Map<string, number>(); // `${cardId}|${source}` -> price
  private pendingInjections: { cardId: number; kind: 'price_jump' | 'volume_spike'; pct: number }[] = [];

  /** Create sample cards + 14 days of history once. */
  seed() {
    if (kv.get('sample_seeded') === '1') {
      this.cards = cardsRepo.all();
      this.restoreLastPrices();
      return;
    }
    for (const spec of CATALOG) {
      const card = cardsRepo.upsertByTcgProductId({
        name: spec.name,
        setName: spec.set,
        number: spec.number,
        rarity: spec.rarity,
        finish: null,
        kind: spec.kind,
        tcgplayerProductId: null,
      });
      this.cards.push(card);
      this.seedHistory(card, spec);
    }
    this.seedFeed();
    kv.set('sample_seeded', '1');
  }

  private seedHistory(card: Card, spec: SampleSpec) {
    const now = Date.now();
    const rows: PriceSnapshot[] = [];
    let tp = spec.base;
    let eb = spec.base * (0.94 + this.rng() * 0.12); // ebay sits within ±6% of tcg
    for (let h = 14 * 24; h >= 1; h -= 3) {
      const ts = now - h * 3600_000;
      tp *= 1 + (this.rng() - 0.5) * spec.vol * 0.25;
      eb *= 1 + (this.rng() - 0.5) * spec.vol * 0.3;
      // real venues arbitrage toward each other; without this the two walks
      // drift to permanent fantasy spreads that pin the movers board
      eb += (tp - eb) * 0.15;
      const tpListings = Math.max(2, Math.round(8 + this.rng() * 30));
      const ebListings = Math.max(1, Math.round(4 + this.rng() * 18));
      rows.push({
        cardId: card.id, source: 'tcgplayer', ts,
        marketPrice: round2(tp), lowPrice: round2(tp * (0.88 + this.rng() * 0.08)),
        listingCount: tpListings, salesVolume: Math.round(this.rng() * 6), provenance: 'sample',
      });
      rows.push({
        cardId: card.id, source: 'ebay', ts,
        marketPrice: round2(eb), lowPrice: round2(eb * (0.85 + this.rng() * 0.1)),
        listingCount: ebListings, salesVolume: Math.round(this.rng() * 4), provenance: 'sample',
      });
    }
    snapshotsRepo.insertMany(rows);
    this.lastPrice.set(`${card.id}|tcgplayer`, tp);
    this.lastPrice.set(`${card.id}|ebay`, eb);
  }

  private restoreLastPrices() {
    for (const card of this.cards) {
      for (const source of ['tcgplayer', 'ebay'] as const) {
        const s = snapshotsRepo.latestForCard(card.id, source);
        if (s?.marketPrice != null) this.lastPrice.set(`${card.id}|${source}`, s.marketPrice);
      }
    }
  }

  private seedFeed() {
    const now = Date.now();
    const accounts = ['riftcubtcg', 'smertcollector', 'riftvesting', 'riftboundgg'];
    const items: FeedItem[] = [];
    for (let i = 0; i < 26; i++) {
      const account = accounts[Math.floor(this.rng() * accounts.length)];
      const useCard = this.rng() < 0.55;
      const card = this.cards[Math.floor(this.rng() * this.cards.length)];
      const text = useCard
        ? FEED_TEMPLATES[Math.floor(this.rng() * FEED_TEMPLATES.length)](shortName(card.name))
        : FEED_FILLER[Math.floor(this.rng() * FEED_FILLER.length)];
      items.push({
        account,
        author: account,
        ts: now - Math.floor(this.rng() * 36) * 3600_000 - Math.floor(this.rng() * 3600_000),
        text: `[SAMPLE] ${text}`,
        url: null,
        provenance: 'sample',
      });
    }
    feedRepo.insertMany(items);
  }

  /** Queue a demo scenario; applied on the next tick. */
  inject(cardId: number, kind: 'price_jump' | 'volume_spike', pct = 10) {
    this.pendingInjections.push({ cardId, kind, pct });
  }

  /** One refresh cycle of the simulated market. */
  tick(): PriceSnapshot[] {
    if (!this.cards.length) this.cards = cardsRepo.all();
    const rows: PriceSnapshot[] = [];
    const ts = Date.now();
    const injections = this.pendingInjections.splice(0);
    for (const card of this.cards) {
      const inj = injections.find((i) => i.cardId === card.id);
      // venue mean-reversion (see seedHistory)
      const tpKey = `${card.id}|tcgplayer`, ebKey = `${card.id}|ebay`;
      const tpNow = this.lastPrice.get(tpKey), ebNow = this.lastPrice.get(ebKey);
      if (tpNow != null && ebNow != null && (!inj || inj.kind !== 'price_jump')) {
        this.lastPrice.set(ebKey, ebNow + (tpNow - ebNow) * 0.05);
      }
      for (const source of ['tcgplayer', 'ebay'] as const) {
        const key = `${card.id}|${source}`;
        let price = this.lastPrice.get(key) ?? 10;
        let listings = Math.max(1, Math.round(6 + this.rng() * 24));
        let volume = Math.round(this.rng() * 5);
        let provenance: PriceSnapshot['provenance'] = 'sample';
        price *= 1 + (this.rng() - 0.5) * 0.012; // gentle drift per tick
        if (inj) {
          provenance = 'synthetic';
          if (inj.kind === 'price_jump') price *= 1 + inj.pct / 100;
          if (inj.kind === 'volume_spike') {
            listings = Math.round(listings * 0.4); // supply getting bought out
            volume = Math.round(20 + this.rng() * 15);
          }
        }
        this.lastPrice.set(key, price);
        rows.push({
          cardId: card.id, source, ts,
          marketPrice: round2(price),
          lowPrice: round2(price * (0.88 + this.rng() * 0.08)),
          listingCount: listings, salesVolume: volume, provenance,
        });
      }
      if (inj) this.injectFeedEcho(card, inj.kind, ts);
    }
    return rows;
  }

  /** A scenario event also produces a plausible SAMPLE feed echo, so the
   *  "why" engine has something to correlate — mirroring real life where
   *  moves and chatter arrive together. */
  private injectFeedEcho(card: Card, kind: 'price_jump' | 'volume_spike', ts: number) {
    const text =
      kind === 'price_jump'
        ? `[SAMPLE·SCENARIO] ${shortName(card.name)} just repriced across vendors — paying up is the new floor.`
        : `[SAMPLE·SCENARIO] Watching ${shortName(card.name)} get bought out listing by listing right now.`;
    feedRepo.insertMany([
      { account: 'riftvesting', author: 'riftvesting', ts: ts - 60_000, text, url: null, provenance: 'sample' },
    ]);
  }
}

function shortName(name: string): string {
  return name.split(' (')[0].split(',')[0];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
