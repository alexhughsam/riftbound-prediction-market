import type { FastifyInstance } from 'fastify';
import { cardsRepo, feedRepo, snapshotsRepo, watchlistRepo } from '../db.js';
import type { Poller } from '../core/poller.js';
import { quoteCard, searchQuotes } from '../core/quotes.js';
import { config } from '../config.js';

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
    return {
      quote: quoteCard(card, poller),
      history: {
        tcgplayer: snapshotsRepo.seriesForCard(card.id, 'tcgplayer', since),
        ebay: snapshotsRepo.seriesForCard(card.id, 'ebay', since),
      },
    };
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
    poller.on('cycle', onCycle);
    poller.on('feed', onFeed);
    poller.on('health', onHealth);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      poller.off('cycle', onCycle);
      poller.off('feed', onFeed);
      poller.off('health', onHealth);
    });
  });
}
