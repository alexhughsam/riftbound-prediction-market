import type { FastifyInstance } from 'fastify';
import { alertsRepo, cardsRepo, feedRepo, portfolioRepo, snapshotsRepo, watchlistRepo } from '../db.js';
import type { Poller } from '../core/poller.js';
import { quoteCard, searchQuotes } from '../core/quotes.js';
import { gradedVariantsOf, parseGrade, rawCounterpartOf } from '../core/grades.js';
import { imageCandidates } from '../core/images.js';
import { config } from '../config.js';
import type { Card, SourceId } from '../types.js';

/** Blended % change of market price vs ~h hours ago, strongest venue kept. */
function pctChange(cardId: number, hours: number): number | null {
  let out: number | null = null;
  const now = Date.now();
  for (const source of ['tcgplayer', 'ebay'] as const) {
    const series = snapshotsRepo.seriesForCard(cardId, source, now - (hours + 24) * 3600_000);
    if (series.length < 2) continue;
    const last = series[series.length - 1];
    let ref = series[0];
    for (const s of series) if (s.ts <= last.ts - hours * 3600_000) ref = s;
    if (last.marketPrice == null || ref.marketPrice == null || ref.marketPrice === 0) continue;
    const pct = ((last.marketPrice - ref.marketPrice) / ref.marketPrice) * 100;
    if (out == null || Math.abs(pct) > Math.abs(out)) out = Math.round(pct * 10) / 10;
  }
  return out;
}

function cardStats(cardId: number) {
  const now = Date.now();
  let liquidity = 0;
  let vol7 = 0;
  for (const source of ['tcgplayer', 'ebay'] as const) {
    const latest = snapshotsRepo.latestForCard(cardId, source);
    liquidity += latest?.listingCount ?? 0;
    for (const s of snapshotsRepo.seriesForCard(cardId, source, now - 7 * 24 * 3600_000)) {
      vol7 += s.salesVolume ?? 0;
    }
  }
  return { d7Pct: pctChange(cardId, 24 * 7), d30Pct: pctChange(cardId, 24 * 30), liquidity, vol7 };
}

function venueUrl(card: Card, source: SourceId): string {
  const q = encodeURIComponent(`riftbound ${card.name}`);
  return source === 'ebay'
    ? `https://www.ebay.com/sch/i.html?_nkw=${q}`
    : card.tcgplayerProductId
      ? `https://www.tcgplayer.com/product/${card.tcgplayerProductId}`
      : `https://www.tcgplayer.com/search/all/product?q=${q}`;
}

export function registerApi(app: FastifyInstance, poller: Poller) {
  app.get('/api/status', async () => ({
    mode: poller.mode,
    overall: poller.overallState(),
    sources: poller.healthAll(),
    lastCycleTs: poller.lastCycleTs,
    cycleCount: poller.cycleCount,
    nextCycleTs: poller.lastCycleTs + config.pollIntervalMs,
    pollIntervalMs: config.pollIntervalMs,
    cards: cardsRepo.count(),
    serverTs: Date.now(),
  }));

  app.get('/api/movers', async () => ({ movers: poller.movers, computedTs: poller.lastCycleTs }));

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
    const q = (req.query.q ?? '').trim();
    if (!q) return { quotes: [] };
    return { quotes: searchQuotes(q, poller) };
  });

  app.get<{ Params: { id: string }; Querystring: { days?: string } }>('/api/card/:id', async (req, reply) => {
    const card = cardsRepo.byId(Number(req.params.id));
    if (!card) return reply.code(404).send({ error: 'card not found' });
    const days = Math.min(30, Number(req.query.days ?? 14));
    const since = Date.now() - days * 24 * 3600_000;
    const all = cardsRepo.all();
    const graded = gradedVariantsOf(card, all).map((g) => ({
      card: g,
      grade: parseGrade(g.name),
      quote: quoteCard(g, poller),
    }));
    const raw = rawCounterpartOf(card, all);
    return {
      quote: quoteCard(card, poller),
      stats: cardStats(card.id),
      graded,
      raw: raw ? { card: raw, quote: quoteCard(raw, poller) } : null,
      images: imageCandidates(card, poller.mode === 'sample'),
      links: { tcgplayer: venueUrl(card, 'tcgplayer'), ebay: venueUrl(card, 'ebay') },
      history: {
        tcgplayer: snapshotsRepo.seriesForCard(card.id, 'tcgplayer', since),
        ebay: snapshotsRepo.seriesForCard(card.id, 'ebay', since),
      },
    };
  });

  // ---- Alerts -------------------------------------------------------------
  app.get('/api/alerts', async () => ({
    alerts: alertsRepo.all().map((a) => ({ ...a, card: cardsRepo.byId(a.cardId) })),
  }));

  app.post<{ Body: { cardId: number; direction: 'above' | 'below'; threshold: number; basis?: 'best' | 'avg' } }>(
    '/api/alerts',
    async (req, reply) => {
      const { cardId, direction, threshold, basis } = req.body;
      if (!cardsRepo.byId(cardId)) return reply.code(404).send({ error: 'card not found' });
      if (!(threshold > 0) || !['above', 'below'].includes(direction)) {
        return reply.code(400).send({ error: 'need direction above|below and threshold > 0' });
      }
      const id = alertsRepo.add(cardId, direction, threshold, basis ?? 'best');
      return { ok: true, id };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/alerts/:id', async (req) => {
    alertsRepo.remove(Number(req.params.id));
    return { ok: true };
  });

  // ---- Portfolio ----------------------------------------------------------
  app.get('/api/portfolio', async () => {
    const rows = portfolioRepo.all().map((p) => {
      const card = cardsRepo.byId(p.cardId);
      const quote = card ? quoteCard(card, poller) : null;
      const mark = quote?.blendedAvg ?? null;
      return {
        ...p,
        card,
        mark,
        value: mark != null ? Math.round(mark * p.qty * 100) / 100 : null,
        pnl: mark != null ? Math.round((mark - p.costBasis) * p.qty * 100) / 100 : null,
        pnlPct: mark != null && p.costBasis > 0 ? Math.round(((mark - p.costBasis) / p.costBasis) * 1000) / 10 : null,
        provenance: quote?.perSource.find((s) => s.provenance)?.provenance ?? null,
      };
    });
    const value = rows.reduce((s, r) => s + (r.value ?? 0), 0);
    const cost = rows.reduce((s, r) => s + r.costBasis * r.qty, 0);
    return {
      rows,
      totals: {
        value: Math.round(value * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        pnl: Math.round((value - cost) * 100) / 100,
      },
    };
  });

  app.post<{ Body: { cardId: number; qty: number; costBasis: number } }>('/api/portfolio', async (req, reply) => {
    const { cardId, qty, costBasis } = req.body;
    if (!cardsRepo.byId(cardId)) return reply.code(404).send({ error: 'card not found' });
    if (!(qty > 0) || !(costBasis >= 0)) return reply.code(400).send({ error: 'need qty > 0 and costBasis >= 0' });
    portfolioRepo.upsert(cardId, qty, costBasis);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/portfolio/:id', async (req) => {
    portfolioRepo.remove(Number(req.params.id));
    return { ok: true };
  });

  // Default content for the quotes panel before any search: the most
  // valuable cards on the board (by blended market price), watchlist first.
  app.get('/api/board', async () => {
    const watched = new Set(watchlistRepo.ids());
    const quotes = cardsRepo
      .all()
      .map((c) => quoteCard(c, poller))
      .filter((q) => q.blendedAvg != null)
      .sort((a, b) => {
        const w = Number(watched.has(b.card.id)) - Number(watched.has(a.card.id));
        return w !== 0 ? w : (b.blendedAvg ?? 0) - (a.blendedAvg ?? 0);
      })
      .slice(0, 14);
    return { quotes };
  });

  app.get('/api/feed', async () => ({
    items: feedRepo.latest(80),
    accounts: config.feedAccounts,
    health: poller.healthFor('feed'),
  }));

  app.get('/api/watchlist', async () => ({
    quotes: watchlistRepo.ids().map((id) => {
      const card = cardsRepo.byId(id);
      return card ? quoteCard(card, poller) : null;
    }).filter(Boolean),
  }));

  app.post<{ Body: { cardId: number } }>('/api/watchlist', async (req) => {
    watchlistRepo.add(req.body.cardId);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/watchlist/:id', async (req) => {
    watchlistRepo.remove(Number(req.params.id));
    return { ok: true };
  });

  // ---- Demo / drill controls -------------------------------------------
  // Scenario injection only works in SAMPLE mode; it can never contaminate
  // real market data. Kill/restore works in both modes (resilience drill).
  app.post<{ Body: { cardId: number; kind: 'price_jump' | 'volume_spike'; pct?: number } }>(
    '/api/demo/inject',
    async (req, reply) => {
      const ok = poller.inject(req.body.cardId, req.body.kind, req.body.pct);
      if (!ok) return reply.code(409).send({ error: 'scenario injection is only available in SAMPLE mode' });
      await poller.cycle(); // surface within one refresh
      return { ok: true };
    },
  );

  app.post<{ Body: { source: 'tcgplayer' | 'ebay' | 'feed'; killed: boolean } }>(
    '/api/demo/kill',
    async (req) => {
      poller.setKilled(req.body.source, req.body.killed);
      return { ok: true, health: poller.healthAll() };
    },
  );

  // ---- SSE stream --------------------------------------------------------
  app.get('/api/stream', (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('hello', { ts: Date.now() });
    const onCycle = (d: unknown) => send('cycle', d);
    const onFeed = (d: unknown) => send('feed', d);
    const onHealth = () => send('health', poller.healthAll());
    const onAlert = (d: unknown) => send('alert', d);
    poller.on('cycle', onCycle);
    poller.on('feed', onFeed);
    poller.on('health', onHealth);
    poller.on('alert', onAlert);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      poller.off('cycle', onCycle);
      poller.off('feed', onFeed);
      poller.off('health', onHealth);
      poller.off('alert', onAlert);
    });
  });
}
