import type { SourceHealth, SourceId, SourceState } from '../types.js';
import { config } from '../config.js';

/**
 * Shared per-source runtime: honest rate limiting, failure tracking and a
 * circuit breaker. Adapters wrap their outbound calls in `guard()`; the rest
 * of the app reads `health()` and never sees a throw take the process down.
 */
export class SourceRuntime {
  private lastRequestTs = 0;
  private failures = 0;
  private lastOkTs: number | null = null;
  private lastCheckTs: number | null = null;
  private openUntil = 0; // circuit breaker: no calls before this ts
  private detail = 'not yet polled';
  private forcedState: SourceState | null = null;

  constructor(
    readonly source: SourceId,
    private minIntervalMs: number,
    private label: string,
  ) {}

  /** Manually force a state (used for kill-switch demos and sample mode). */
  force(state: SourceState | null, detail?: string) {
    this.forcedState = state;
    if (detail) this.detail = detail;
  }

  get isForcedDown() {
    return this.forcedState === 'down' || this.forcedState === 'disabled';
  }

  get isForced() {
    return this.forcedState !== null;
  }

  async guard<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isForcedDown) throw new Error(`${this.source} is disabled`);
    const now = Date.now();
    if (now < this.openUntil) throw new Error(`${this.source} circuit open`);
    // Honest pacing: never hit a source faster than its configured interval.
    const wait = this.lastRequestTs + this.minIntervalMs - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestTs = Date.now();
    this.lastCheckTs = this.lastRequestTs;
    try {
      const out = await fn();
      this.failures = 0;
      this.lastOkTs = Date.now();
      this.detail = 'ok';
      return out;
    } catch (err: any) {
      this.failures += 1;
      this.detail = String(err?.message ?? err).slice(0, 200);
      if (this.failures >= 3) {
        // Back off exponentially, cap 10 min. Being banned is a failure mode.
        this.openUntil = Date.now() + Math.min(600_000, 30_000 * 2 ** (this.failures - 3));
      }
      throw err;
    }
  }

  health(): SourceHealth {
    let state: SourceState;
    if (this.forcedState) state = this.forcedState;
    else if (this.lastOkTs == null) state = this.failures > 0 ? 'down' : 'degraded';
    else if (this.failures >= 3) state = 'down';
    else if (this.failures > 0 || Date.now() - this.lastOkTs > config.staleMs) state = 'degraded';
    else state = 'live';
    return {
      source: this.source,
      state,
      detail: this.forcedState ? this.detail : `${this.label}: ${this.detail}`,
      lastOkTs: this.lastOkTs,
      lastCheckTs: this.lastCheckTs,
      consecutiveFailures: this.failures,
    };
  }

  markOk(detail = 'ok') {
    this.lastOkTs = Date.now();
    this.lastCheckTs = this.lastOkTs;
    this.failures = 0;
    this.detail = detail;
  }
}

export async function fetchJson(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<any> {
  const res = await fetchRaw(url, init, timeoutMs);
  return res.json();
}

export async function fetchText(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<string> {
  const res = await fetchRaw(url, init, timeoutMs);
  return res.text();
}

async function fetchRaw(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctl.signal,
      headers: { 'user-agent': config.userAgent, ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

/** Data age → provenance downgrade. One rule for every source. */
export function provenanceForAge(observedTs: number): 'live' | 'cached' | 'stale' {
  const age = Date.now() - observedTs;
  if (age <= config.freshMs) return 'live';
  if (age <= config.staleMs) return 'cached';
  return 'stale';
}
