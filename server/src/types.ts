// Shared domain types for the Riftbound Terminal.

export type SourceId = 'tcgplayer' | 'ebay' | 'feed';

/**
 * Provenance of every number that can appear on screen. This is the trust
 * backbone: no price is ever displayed without one of these attached.
 *  - live:      fetched from the source within its freshness window
 *  - cached:    fetched from the source, older than the freshness window
 *  - stale:     cached data past its stale threshold; still shown, loudly marked
 *  - sample:    generated demo data; never mixable with live data in one source
 *  - synthetic: an operator-injected scenario event (e.g. demo price jump)
 */
export type Provenance = 'live' | 'cached' | 'stale' | 'sample' | 'synthetic';

export type SourceState = 'live' | 'degraded' | 'down' | 'sample' | 'disabled';

export interface SourceHealth {
  source: SourceId;
  state: SourceState;
  detail: string;
  lastOkTs: number | null;
  lastCheckTs: number | null;
  consecutiveFailures: number;
}

export type CardKind = 'single' | 'sealed' | 'slab' | 'promo';

export interface Card {
  id: number;
  name: string;
  setName: string;
  number: string | null;
  rarity: string | null;
  finish: string | null; // Normal / Foil / etc.
  kind: CardKind;
  tcgplayerProductId: number | null;
}

export interface PriceSnapshot {
  id?: number;
  cardId: number;
  source: SourceId;
  ts: number; // epoch ms when the data was OBSERVED at the source
  marketPrice: number | null; // source's market/average price
  lowPrice: number | null; // best (lowest) available price
  listingCount: number | null;
  salesVolume: number | null; // sales in trailing window if the source exposes it
  provenance: Provenance;
}

export interface Listing {
  id?: number;
  cardId: number | null;
  source: SourceId;
  ts: number;
  title: string;
  price: number;
  shipping: number | null;
  condition: string | null;
  url: string | null;
  provenance: Provenance;
}

export interface FeedItem {
  id?: number;
  account: string; // handle without @
  author: string;
  ts: number;
  text: string;
  url: string | null;
  provenance: Provenance;
}

export interface MoverWhy {
  headline: string; // one plain-language sentence
  factors: string[]; // supporting bullet reads
  feedRefs: { account: string; text: string; ts: number }[];
}

export interface Mover {
  cardId: number;
  card: Card;
  score: number;
  direction: 'up' | 'down';
  pct24h: number | null; // % change of blended market price vs ~24h ago
  volumeZ: number | null; // z-score of listing/sales activity vs trailing week
  spreadPct: number | null; // cross-market spread (positive = ebay cheaper etc.)
  spreadLowSource: SourceId | null;
  latest: { source: SourceId; price: number; ts: number; provenance: Provenance }[];
  why: MoverWhy;
  computedTs: number;
}

export interface CardQuote {
  card: Card;
  perSource: {
    source: SourceId;
    avgPrice: number | null;
    bestPrice: number | null;
    bestUrl: string | null;
    listingCount: number | null;
    ts: number | null;
    provenance: Provenance | null;
    state: SourceState;
  }[];
  blendedAvg: number | null;
  best: { source: SourceId; price: number; url: string | null; ts: number; provenance: Provenance } | null;
}

// Adapter contracts. Every market source implements MarketAdapter; the rest of
// the app only ever talks to these interfaces.
export interface MarketAdapter {
  readonly id: SourceId;
  readonly label: string;
  /** Pull latest prices for known catalog cards into snapshots. */
  poll(): Promise<PriceSnapshot[]>;
  /** Free-text search against the source; returns listings (may be async-expensive). */
  search(query: string, opts?: { limit?: number }): Promise<Listing[]>;
  health(): SourceHealth;
}

export interface FeedAdapter {
  readonly id: 'feed';
  poll(): Promise<FeedItem[]>;
  health(): SourceHealth;
}
