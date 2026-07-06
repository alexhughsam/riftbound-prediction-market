import { cardsRepo, feedRepo, snapshotsRepo } from '../db.js';
import type { Card, Mover, MoverWhy, PriceSnapshot, SourceId } from '../types.js';

/**
 * Mover detection. For every card with history, blend three signals:
 *
 *   1. 24h price momentum  — % change of per-source market price vs ~24h ago
 *   2. activity anomaly    — z-score of (sales volume, listing-count draining)
 *                            vs that card's own trailing 7-day distribution
 *   3. cross-market spread — gap between sources right now; a market that
 *                            hasn't repriced yet is where the entry is
 *
 * Signals are normalized per-card (its own history is the baseline) so cheap
 * volatile cards don't drown out slow expensive ones, and no card ever needs
 * special-casing.
 */

const H24 = 24 * 3600_000;
const D7 = 7 * 24 * 3600_000;

export function computeMovers(limit = 12): Mover[] {
  const out: Mover[] = [];
  const now = Date.now();
  for (const cardId of snapshotsRepo.cardsWithData()) {
    const card = cardsRepo.byId(cardId);
    if (!card) continue;
    const m = analyzeCard(card, now);
    if (m) out.push(m);
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function analyzeCard(card: Card, now: number): Mover | null {
  const perSource: Record<string, PriceSnapshot[]> = {};
  for (const source of ['tcgplayer', 'ebay'] as const) {
    perSource[source] = snapshotsRepo.seriesForCard(card.id, source, now - D7);
  }
  const latest = (['tcgplayer', 'ebay'] as const)
    .map((s) => {
      const arr = perSource[s];
      const last = arr[arr.length - 1];
      return last?.marketPrice != null
        ? { source: s as SourceId, price: last.marketPrice, ts: last.ts, provenance: last.provenance }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  if (!latest.length) return null;

  // -- Signal 1: 24h momentum (use the strongest source move, keep its sign)
  let pct24h: number | null = null;
  for (const source of ['tcgplayer', 'ebay'] as const) {
    const arr = perSource[source];
    if (arr.length < 2) continue;
    const last = arr[arr.length - 1];
    const ref = closestBefore(arr, last.ts - H24) ?? arr[0];
    if (last.marketPrice == null || ref.marketPrice == null || ref.marketPrice === 0) continue;
    const pct = ((last.marketPrice - ref.marketPrice) / ref.marketPrice) * 100;
    if (pct24h == null || Math.abs(pct) > Math.abs(pct24h)) pct24h = pct;
  }

  // -- Signal 2: activity anomaly (volume up and/or supply draining)
  let volumeZ: number | null = null;
  for (const source of ['tcgplayer', 'ebay'] as const) {
    const arr = perSource[source];
    if (arr.length < 8) continue;
    const z = activityZ(arr);
    if (z != null && (volumeZ == null || Math.abs(z) > Math.abs(volumeZ))) volumeZ = z;
  }

  // -- Signal 3: cross-market spread right now
  let spreadPct: number | null = null;
  let spreadLowSource: SourceId | null = null;
  if (latest.length === 2) {
    const [a, b] = latest;
    const hi = a.price >= b.price ? a : b;
    const lo = a.price >= b.price ? b : a;
    if (lo.price > 0) {
      spreadPct = ((hi.price - lo.price) / lo.price) * 100;
      spreadLowSource = lo.source;
    }
  }

  const score =
    Math.abs(pct24h ?? 0) * 1.0 +
    Math.max(0, volumeZ ?? 0) * 2.2 +
    // spreads under ~4% are noise/fees; above ~20% they're usually a data
    // quirk (wrong variant matched, one dead listing), so cap the credit
    Math.min(16, Math.max(0, (spreadPct ?? 0) - 4)) * 0.5;

  if (score < 1.5) return null;

  const direction: 'up' | 'down' = (pct24h ?? 0) >= 0 ? 'up' : 'down';
  return {
    cardId: card.id,
    card,
    score: round2(score),
    direction,
    pct24h: pct24h != null ? round2(pct24h) : null,
    volumeZ: volumeZ != null ? round2(volumeZ) : null,
    spreadPct: spreadPct != null ? round2(spreadPct) : null,
    spreadLowSource,
    latest,
    why: buildWhy(card, { pct24h, volumeZ, spreadPct, spreadLowSource, direction }),
    computedTs: now,
  };
}

/** z-score of the most recent activity vs the trailing week's distribution.
 *  Activity = salesVolume where available, plus listing-count DRAIN (a drop in
 *  supply counts as buying pressure). */
function activityZ(arr: PriceSnapshot[]): number | null {
  const acts: number[] = [];
  for (let i = 1; i < arr.length; i++) {
    const vol = arr[i].salesVolume ?? 0;
    const prevCount = arr[i - 1].listingCount;
    const count = arr[i].listingCount;
    const drain = prevCount != null && count != null ? Math.max(0, prevCount - count) : 0;
    acts.push(vol + drain);
  }
  if (acts.length < 6) return null;
  const recent = acts[acts.length - 1];
  const hist = acts.slice(0, -1);
  const mean = hist.reduce((s, x) => s + x, 0) / hist.length;
  const sd = Math.sqrt(hist.reduce((s, x) => s + (x - mean) ** 2, 0) / hist.length);
  if (sd === 0) return recent > mean ? 3 : 0;
  return (recent - mean) / sd;
}

function closestBefore(arr: PriceSnapshot[], ts: number): PriceSnapshot | null {
  let best: PriceSnapshot | null = null;
  for (const s of arr) {
    if (s.ts <= ts) best = s;
    else break;
  }
  return best;
}

/** Plain-language read on what's driving the move, grounded only in things we
 *  actually measured — price change, activity, spread, and feed chatter that
 *  mentions the card. No speculation beyond what the data shows. */
function buildWhy(
  card: Card,
  s: {
    pct24h: number | null;
    volumeZ: number | null;
    spreadPct: number | null;
    spreadLowSource: SourceId | null;
    direction: 'up' | 'down';
  },
): MoverWhy {
  const factors: string[] = [];
  if (s.pct24h != null && Math.abs(s.pct24h) >= 1) {
    factors.push(`${s.pct24h >= 0 ? '+' : ''}${s.pct24h.toFixed(1)}% in 24h`);
  }
  if (s.volumeZ != null && s.volumeZ >= 1.5) {
    factors.push(`buying activity ${s.volumeZ.toFixed(1)}σ above its weekly norm`);
  }
  if (s.spreadPct != null && s.spreadPct >= 4 && s.spreadLowSource) {
    factors.push(`${s.spreadLowSource === 'ebay' ? 'eBay' : 'TCGplayer'} still ${s.spreadPct.toFixed(0)}% cheaper — hasn't repriced yet`);
  }

  // Correlate with feed chatter from the last 48h that names this card.
  const stem = card.name.split(' (')[0].split(',')[0].toLowerCase();
  const feedRefs = feedRepo
    .since(Date.now() - 48 * 3600_000)
    .filter((f) => f.text.toLowerCase().includes(stem))
    .slice(0, 2)
    .map((f) => ({ account: f.account, text: f.text, ts: f.ts }));

  let headline: string;
  // Verb follows the dominant signal: a big activity spike with a flat/soft
  // price is accumulation, not a sell-off — price only names the move when
  // it's actually the story.
  const activityDominant = (s.volumeZ ?? 0) >= 1.5 && Math.abs(s.pct24h ?? 0) < 3;
  const moveWord = activityDominant
    ? 'getting bought up'
    : s.direction === 'up'
      ? 'moving up'
      : 'selling off';
  const activityPhrase = activityDominant ? '' : ' on unusual buying';
  if (feedRefs.length && s.volumeZ != null && s.volumeZ >= 1.5) {
    headline = `${shortName(card.name)} is ${moveWord}${activityPhrase} with chatter from @${feedRefs[0].account} — reads like the crowd is onto something.`;
  } else if (feedRefs.length) {
    headline = `${shortName(card.name)} is ${moveWord}; @${feedRefs[0].account} was talking about it in the last 48h.`;
  } else if (s.volumeZ != null && s.volumeZ >= 1.5) {
    headline = `${shortName(card.name)} is ${moveWord}${activityDominant ? ' with no public chatter yet — quiet accumulation pattern' : ' on unusual activity'}.`;
  } else if (s.spreadPct != null && s.spreadPct >= 4) {
    headline = `${shortName(card.name)} repriced on one market; the other is lagging ${s.spreadPct.toFixed(0)}% behind.`;
  } else {
    headline = `${shortName(card.name)} is ${moveWord} steadily over the last day.`;
  }
  return { headline, factors, feedRefs };
}

function shortName(name: string): string {
  return name.split(' (')[0];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
