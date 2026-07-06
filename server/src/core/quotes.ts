import { cardsRepo, snapshotsRepo } from '../db.js';
import type { Card, CardQuote, SourceId } from '../types.js';
import { provenanceForAge } from '../adapters/runtime.js';
import type { Poller } from './poller.js';

/**
 * Cross-market quotes: for a card (or list), the per-source average and the
 * single best price, every number carrying source + timestamp + provenance.
 */
export function quoteCard(card: Card, poller: Poller): CardQuote {
  const perSource = (['tcgplayer', 'ebay'] as const).map((source) => {
    const snap = snapshotsRepo.latestForCard(card.id, source);
    const health = poller.healthFor(source);
    if (!snap) {
      return {
        source: source as SourceId,
        avgPrice: null,
        bestPrice: null,
        bestUrl: null,
        listingCount: null,
        ts: null,
        provenance: null,
        state: health.state,
      };
    }
    // sample/synthetic provenance is preserved verbatim; real data downgrades
    // by age so a number can never silently pretend to be fresher than it is.
    const prov = snap.provenance === 'sample' || snap.provenance === 'synthetic'
      ? snap.provenance
      : provenanceForAge(snap.ts);
    return {
      source: source as SourceId,
      avgPrice: snap.marketPrice,
      bestPrice: snap.lowPrice,
      bestUrl:
        source === 'tcgplayer' && card.tcgplayerProductId
          ? `https://www.tcgplayer.com/product/${card.tcgplayerProductId}`
          : null,
      listingCount: snap.listingCount,
      ts: snap.ts,
      provenance: prov,
      state: health.state,
    };
  });

  const avgs = perSource.filter((p) => p.avgPrice != null).map((p) => p.avgPrice as number);
  const blendedAvg = avgs.length ? round2(avgs.reduce((s, x) => s + x, 0) / avgs.length) : null;

  let best: CardQuote['best'] = null;
  for (const p of perSource) {
    if (p.bestPrice == null || p.ts == null || p.provenance == null) continue;
    if (!best || p.bestPrice < best.price) {
      best = { source: p.source, price: p.bestPrice, url: p.bestUrl, ts: p.ts, provenance: p.provenance };
    }
  }
  return { card, perSource, blendedAvg, best };
}

export function searchQuotes(query: string, poller: Poller): CardQuote[] {
  // Support comma/newline-separated multi-card queries.
  const parts = query.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set<number>();
  const out: CardQuote[] = [];
  for (const part of parts) {
    for (const card of cardsRepo.search(part, parts.length > 1 ? 3 : 12)) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      out.push(quoteCard(card, poller));
    }
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
