import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { alertsRepo, feedRepo, snapshotsRepo } from '../db.js';
import { EbayAdapter } from '../adapters/ebay.js';
import { XFeedAdapter } from '../adapters/feed.js';
import { SampleMarket } from '../adapters/sample.js';
import { TcgplayerAdapter } from '../adapters/tcgplayer.js';
import type { Mover, SourceHealth, SourceId, SourceState } from '../types.js';
import { computeMovers } from './movers.js';

/**
 * The heartbeat. Each cycle: poll every source that's up, persist snapshots,
 * recompute movers, and emit events for the SSE stream. A dead source never
 * stops the cycle — it just shows up as degraded/down in health.
 */
export class Poller extends EventEmitter {
  readonly tcgplayer = new TcgplayerAdapter();
  readonly ebay = new EbayAdapter();
  readonly feed = new XFeedAdapter();
  readonly sample = new SampleMarket();

  /** 'live' = real adapters; 'sample' = simulated market, loudly labeled. */
  mode: 'live' | 'sample' = 'live';
  movers: Mover[] = [];
  lastCycleTs = 0;
  cycleCount = 0;
  private killed = new Set<SourceId>();
  private timer: NodeJS.Timeout | null = null;
  private feedTimer: NodeJS.Timeout | null = null;

  async start() {
    if (config.mode === 'sample') {
      this.enterSampleMode('RBT_MODE=sample set in .env');
    } else {
      // auto: try the real catalog once; if unreachable, fall back to sample.
      try {
        await this.tcgplayer.refreshCatalog();
      } catch (err: any) {
        if (config.mode === 'live') {
          console.error('[poller] live mode forced but TCGplayer catalog unreachable:', err?.message);
        } else {
          this.enterSampleMode(`real sources unreachable (${String(err?.message).slice(0, 80)})`);
        }
      }
    }
    await this.cycle();
    await this.pollFeed();
    this.timer = setInterval(() => void this.cycle(), config.pollIntervalMs);
    this.feedTimer = setInterval(() => void this.pollFeed(), config.feedPollMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.feedTimer) clearInterval(this.feedTimer);
  }

  private enterSampleMode(reason: string) {
    this.mode = 'sample';
    this.sample.seed();
    this.tcgplayer.force('sample', `SAMPLE mode — ${reason}`);
    this.ebay.force('sample', `SAMPLE mode — ${reason}`);
    this.feed.force('sample', `SAMPLE mode — ${reason}`);
    console.log(`[poller] SAMPLE mode: ${reason}`);
  }

  async cycle() {
    const t0 = Date.now();
    if (this.mode === 'sample') {
      const rows = this.sample.tick().filter((r) => !this.killed.has(r.source));
      if (rows.length) snapshotsRepo.insertMany(rows);
    } else {
      for (const adapter of [this.tcgplayer, this.ebay] as const) {
        if (this.killed.has(adapter.id)) continue;
        try {
          const rows = await adapter.poll();
          if (rows.length) snapshotsRepo.insertMany(rows);
        } catch (err: any) {
          console.error(`[poller] ${adapter.id} poll failed:`, err?.message);
        }
      }
    }
    this.movers = computeMovers();
    this.evaluateAlerts();
    this.lastCycleTs = Date.now();
    this.cycleCount++;
    this.emit('cycle', { ts: this.lastCycleTs, ms: this.lastCycleTs - t0 });
  }

  /** Check active alerts against the freshest cross-venue price. */
  private evaluateAlerts() {
    for (const alert of alertsRepo.active()) {
      const prices: number[] = [];
      for (const source of ['tcgplayer', 'ebay'] as const) {
        const s = snapshotsRepo.latestForCard(alert.cardId, source);
        const p = alert.basis === 'best' ? s?.lowPrice : s?.marketPrice;
        if (p != null) prices.push(p);
      }
      if (!prices.length) continue;
      const price = alert.basis === 'best'
        ? Math.min(...prices)
        : prices.reduce((a, b) => a + b, 0) / prices.length;
      const crossed = alert.direction === 'above' ? price >= alert.threshold : price <= alert.threshold;
      if (crossed) {
        alertsRepo.trigger(alert.id, Math.round(price * 100) / 100);
        this.emit('alert', { id: alert.id, cardId: alert.cardId, price });
      }
    }
  }

  async pollFeed() {
    if (this.mode === 'sample' || this.killed.has('feed')) return;
    try {
      const items = await this.feed.poll();
      const added = feedRepo.insertMany(items);
      if (added) this.emit('feed', { added });
    } catch (err: any) {
      console.error('[poller] feed poll failed:', err?.message);
    }
  }

  /** Kill-switch for the resilience drill (and real source outages). */
  setKilled(source: SourceId, killed: boolean) {
    const adapter = source === 'tcgplayer' ? this.tcgplayer : source === 'ebay' ? this.ebay : this.feed;
    if (killed) {
      this.killed.add(source);
      adapter.force('down', 'source killed via terminal (resilience drill)');
    } else {
      this.killed.delete(source);
      adapter.force(this.mode === 'sample' ? 'sample' : null, this.mode === 'sample' ? 'SAMPLE mode' : undefined);
    }
    this.emit('health');
  }

  healthFor(source: SourceId): SourceHealth {
    const h =
      source === 'tcgplayer'
        ? this.tcgplayer.health()
        : source === 'ebay'
          ? this.ebay.health()
          : this.feed.health();
    return h;
  }

  healthAll(): SourceHealth[] {
    return (['tcgplayer', 'ebay', 'feed'] as const).map((s) => this.healthFor(s));
  }

  /** Inject a demo scenario (sample mode only — never touches real data). */
  inject(cardId: number, kind: 'price_jump' | 'volume_spike', pct?: number): boolean {
    if (this.mode !== 'sample') return false;
    this.sample.inject(cardId, kind, pct);
    return true;
  }

  overallState(): SourceState {
    const states = this.healthAll().map((h) => h.state);
    if (states.every((s) => s === 'down')) return 'down';
    if (this.mode === 'sample') return 'sample';
    if (states.some((s) => s === 'down' || s === 'degraded')) return 'degraded';
    return 'live';
  }
}
