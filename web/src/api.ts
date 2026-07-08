// Typed client for the RBT server API.

export type Provenance = 'live' | 'cached' | 'stale' | 'sample' | 'synthetic';
export type SourceState = 'live' | 'degraded' | 'down' | 'sample' | 'disabled';
export type SourceId = 'tcgplayer' | 'ebay' | 'feed';

export interface SourceHealth {
  source: SourceId;
  state: SourceState;
  detail: string;
  lastOkTs: number | null;
  lastCheckTs: number | null;
  consecutiveFailures: number;
}

export interface Card {
  id: number;
  name: string;
  setName: string;
  number: string | null;
  rarity: string | null;
  finish: string | null;
  kind: 'single' | 'sealed' | 'slab' | 'promo';
  tcgplayerProductId: number | null;
}

export interface Mover {
  cardId: number;
  card: Card;
  score: number;
  direction: 'up' | 'down';
  pct24h: number | null;
  volumeZ: number | null;
  spreadPct: number | null;
  spreadLowSource: SourceId | null;
  latest: { source: SourceId; price: number; ts: number; provenance: Provenance }[];
  why: { headline: string; factors: string[]; feedRefs: { account: string; text: string; ts: number }[] };
  computedTs: number;
}

export interface PerSourceQuote {
  source: SourceId;
  avgPrice: number | null;
  bestPrice: number | null;
  bestUrl: string | null;
  listingCount: number | null;
  ts: number | null;
  provenance: Provenance | null;
  state: SourceState;
}

export interface CardQuote {
  card: Card;
  perSource: PerSourceQuote[];
  blendedAvg: number | null;
  best: { source: SourceId; price: number; url: string | null; ts: number; provenance: Provenance } | null;
}

export interface Status {
  mode: 'live' | 'sample';
  overall: SourceState;
  sources: SourceHealth[];
  lastCycleTs: number;
  cycleCount: number;
  nextCycleTs: number;
  pollIntervalMs: number;
  cards: number;
  serverTs: number;
}

export interface FeedItem {
  id: number;
  account: string;
  author: string;
  ts: number;
  text: string;
  url: string | null;
  provenance: Provenance;
}

export interface Snapshot {
  ts: number;
  marketPrice: number | null;
  lowPrice: number | null;
  listingCount: number | null;
  salesVolume: number | null;
  provenance: Provenance;
}

export interface CardStats {
  d7Pct: number | null;
  d30Pct: number | null;
  liquidity: number;
  vol7: number;
}

export interface GradedVariant {
  card: Card;
  grade: { company: string; grade: number } | null;
  quote: CardQuote;
}

export interface CardDetail {
  quote: CardQuote;
  stats: CardStats;
  graded: GradedVariant[];
  raw: { card: Card; quote: CardQuote } | null;
  links: { tcgplayer: string; ebay: string };
  history: { tcgplayer: Snapshot[]; ebay: Snapshot[] };
}

export interface AlertItem {
  id: number;
  cardId: number;
  direction: 'above' | 'below';
  threshold: number;
  basis: 'best' | 'avg';
  createdTs: number;
  triggeredTs: number | null;
  triggeredPrice: number | null;
  card: Card | null;
}

export interface PortfolioItem {
  cardId: number;
  qty: number;
  costBasis: number;
  addedTs: number;
  card: Card | null;
  mark: number | null;
  value: number | null;
  pnl: number | null;
  pnlPct: number | null;
  provenance: Provenance | null;
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  status: () => j<Status>('/api/status'),
  movers: () => j<{ movers: Mover[]; computedTs: number }>('/api/movers'),
  search: (q: string) => j<{ quotes: CardQuote[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  board: () => j<{ quotes: CardQuote[] }>('/api/board'),
  card: (id: number) => j<CardDetail>(`/api/card/${id}`),
  alerts: () => j<{ alerts: AlertItem[] }>('/api/alerts'),
  addAlert: (cardId: number, direction: 'above' | 'below', threshold: number) =>
    j('/api/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cardId, direction, threshold }),
    }),
  removeAlert: (id: number) => j(`/api/alerts/${id}`, { method: 'DELETE' }),
  portfolio: () =>
    j<{ rows: PortfolioItem[]; totals: { value: number; cost: number; pnl: number } }>('/api/portfolio'),
  addPortfolio: (cardId: number, qty: number, costBasis: number) =>
    j('/api/portfolio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cardId, qty, costBasis }),
    }),
  removePortfolio: (cardId: number) => j(`/api/portfolio/${cardId}`, { method: 'DELETE' }),
  feed: () => j<{ items: FeedItem[]; accounts: string[]; health: SourceHealth }>('/api/feed'),
  watchlist: () => j<{ quotes: CardQuote[] }>('/api/watchlist'),
  watch: (cardId: number) =>
    j('/api/watchlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId }) }),
  unwatch: (cardId: number) => j(`/api/watchlist/${cardId}`, { method: 'DELETE' }),
  inject: (cardId: number, kind: 'price_jump' | 'volume_spike', pct?: number) =>
    j('/api/demo/inject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cardId, kind, pct }),
    }),
  kill: (source: SourceId, killed: boolean) =>
    j('/api/demo/kill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source, killed }),
    }),
};

export function fmtPrice(p: number | null | undefined): string {
  if (p == null) return '—';
  return p >= 1000 ? p.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : p.toFixed(2);
}

export function fmtAge(ts: number | null | undefined, now: number): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 36) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export const PROV_LABEL: Record<Provenance, string> = {
  live: 'LIVE',
  cached: 'CACH',
  stale: 'STALE',
  sample: 'SMPL',
  synthetic: 'SYNTH',
};

export function provTitle(p: Provenance, source: string, ts: number | null, now: number): string {
  const when = ts ? `${new Date(ts).toISOString()} (${fmtAge(ts, now)} ago)` : 'unknown time';
  switch (p) {
    case 'live': return `Fetched live from ${source} at ${when}`;
    case 'cached': return `Cached from ${source}, observed ${when}`;
    case 'stale': return `STALE — last observed at ${source} ${when}; treat with caution`;
    case 'sample': return `SAMPLE DATA — simulated demo value, NOT a real ${source} price`;
    case 'synthetic': return `SYNTHETIC — operator-injected demo scenario, NOT a real ${source} price`;
  }
}
