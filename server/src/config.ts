import 'dotenv/config';

function num(name: string, dflt: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

export const config = {
  port: num('PORT', 8787),
  dbPath: process.env.RBT_DB_PATH ?? 'data/rbt.sqlite',

  // TCGplayer via TCGCSV daily dumps (free, ToS-clean) + gentle intraday
  // top-ups for watched cards via TCGplayer's public endpoints.
  tcgcsvBase: process.env.TCGCSV_BASE ?? 'https://tcgcsv.com/tcgplayer',
  tcgplayerCategoryId: num('TCGPLAYER_CATEGORY_ID', 0), // 0 = autodiscover "Riftbound"
  tcgplayerIntradayEnabled: process.env.TCGPLAYER_INTRADAY !== '0',
  tcgplayerMinRequestIntervalMs: num('TCGPLAYER_MIN_INTERVAL_MS', 2500),

  // eBay official Browse API (client-credentials grant).
  ebayClientId: process.env.EBAY_CLIENT_ID ?? '',
  ebayClientSecret: process.env.EBAY_CLIENT_SECRET ?? '',
  ebayMinRequestIntervalMs: num('EBAY_MIN_INTERVAL_MS', 1200),

  // Feed: twitterapi.io key (pay-per-request), Nitter RSS as free fallback.
  twitterApiIoKey: process.env.TWITTERAPI_IO_KEY ?? '',
  nitterInstances: (process.env.NITTER_INSTANCES ?? 'https://nitter.net,https://nitter.poast.org')
    .split(',').map((s) => s.trim()).filter(Boolean),
  feedAccounts: (process.env.FEED_ACCOUNTS ?? 'riftcubtcg,smertcollector,riftvesting,riftboundgg')
    .split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean),

  // Cadences (ms)
  pollIntervalMs: num('RBT_POLL_INTERVAL_MS', 60_000), // main refresh cycle
  catalogRefreshMs: num('RBT_CATALOG_REFRESH_MS', 6 * 3600_000),
  feedPollMs: num('RBT_FEED_POLL_MS', 5 * 60_000),

  // Push notifications for fired alerts via https://ntfy.sh (free).
  // Set to any hard-to-guess topic string and subscribe to it in the ntfy app.
  ntfyTopic: process.env.NTFY_TOPIC ?? '',
  ntfyServer: process.env.NTFY_SERVER ?? 'https://ntfy.sh',

  // Freshness thresholds for provenance downgrades (per-source data age)
  freshMs: num('RBT_FRESH_MS', 30 * 60_000), // <30m => live
  staleMs: num('RBT_STALE_MS', 24 * 3600_000), // >24h => stale

  // SAMPLE mode: simulated market for demo/offline use. Forced on when no
  // real source is reachable/configured, or explicitly via RBT_MODE=sample.
  mode: (process.env.RBT_MODE ?? 'auto') as 'auto' | 'sample' | 'live',

  userAgent:
    process.env.RBT_USER_AGENT ??
    'riftbound-terminal/0.1 (personal price tracker; contact: set RBT_USER_AGENT)',
};
