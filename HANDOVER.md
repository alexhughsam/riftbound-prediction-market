# HANDOVER — Riftbound Terminal (RBT)

Written by the outgoing lead. You are picking this up cold; this document plus
the repo is everything. Read `PROMPT.md` on the `claude/riftbound-price-tracker-3bdvlo`
branch first (`git show origin/claude/riftbound-price-tracker-3bdvlo:PROMPT.md`) —
that is the client's brief, and every line of it is binding. This file tells you
what exists, why it's shaped this way, what I could not verify, and exactly what
to do next.

---

## 1. The mission, in one breath

A single-screen Bloomberg-style terminal for Riftbound (Riot's TCG) cards.
Four jobs in priority order: (1) surface cards moving *right now* with a
plain-language why, before the crowd; (2) competitive-play intelligence baked
into those why-reads; (3) cross-market quote search (TCGplayer + eBay, avg +
single best price, lists at once, slabs/promos included); (4) one in-terminal
feed of four X accounts: `@riftcubtcg @smertcollector @riftvesting @riftboundgg`.

The client trades real money off this screen. The cardinal sin — worse than any
crash — is a number that looks live but isn't. Everything else in the design
flows from that.

### Non-negotiables (client's House Rules, condensed)
- Must not read as AI-generated design. Bar: real trading terminal.
- Never display a price as real unless genuinely fetched; sample/stale/estimated
  data must be unmistakably labeled.
- Sources are pluggable adapters behind one interface; a dead source degrades
  visibly, never blanks or crashes.
- No per-card special cases. Generalize or don't build it.
- Respect the sources: rate limits, caching, honest UA, official APIs first.
- Everything in the one terminal; no tab-hopping.

### Agreed decisions (client signed off, don't relitigate)
- TCGplayer data: **TCGCSV daily dumps + gentle intraday top-ups** (not JustTCG).
- eBay: **official Browse API**; client will register the free dev account.
- Feed: **cheap third-party X API (twitterapi.io-class, pay-per-request)** with
  Nitter RSS fallback; client approved after asking for cheaper-than-$200/mo.
- Budget: **≤ $25/month** total for paid APIs. Stay inside it silently.
- Credentials live in gitignored `.env` at repo root; `.env.example` is the contract.
- Progress reporting: the client's brief asked for simplemarkdowneditor.com, but it
  has no API; we substituted a Claude Artifact build-log page (client-visible):
  https://claude.ai/code/artifact/f7c6c793-326e-45b1-a958-8bc8e01b221c
  Keep updating that page each iteration if you have the Artifact tool; otherwise
  screenshots + summaries in chat.

---

## 2. Where things stand (be honest with yourself about this)

**Built and self-tested (in SAMPLE mode):** the whole vertical slice.
Server (Fastify + better-sqlite3), adapters, poller, mover engine, quotes,
SSE, and the full terminal UI. All six "bar" tests below passed *my* checks;
adversarial verification by fresh agents was mid-flight when I left.

**The bar (from PROMPT.md) and status:**

| Test | Status when I left |
| --- | --- |
| Impostor (design reads as real terminal) | self-check pass; adversarial pass in flight |
| Early-signal (injected ~10% jump + volume spike top the board within one refresh, with why) | self-check pass — jump hit #2, spike hit #1, one cycle |
| Search (avg + best across venues, lists, slabs/promos, seconds) | self-check pass, <1s |
| Feed (4 accounts, one panel, newest-first) | self-check pass |
| Trust (every number traceable; nothing ambiguous) | self-check pass; audit in flight |
| Resilience (kill a source mid-use; graceful, labeled, alive) | self-check pass (eBay killed: status bar DOWN, last-known data aged, no crash) |

**The single most important caveat:** the build sandbox's egress proxy blocks
every market host (tcgcsv.com, tcgplayer.com, api.ebay.com, twitterapi.io,
nitter.*  → HTTP 403 CONNECT). Therefore **no real adapter has ever been run
against its real endpoint.** The terminal auto-fell-back to SAMPLE mode for all
development. The real-adapter code is written from documented/known API shapes
with defensive parsing, but treat every one of them as **unverified until you
run live-mode bring-up** (§6). This is the top of your worklist.

---

## 3. Repo map

```
PROMPT.md                     the brief (on the other branch — see §1)
README.md                     user-facing: setup, panels, commands, trust model
.env.example                  every knob, documented; the contract with the client
server/src/
  index.ts                    entry: Fastify, static hosting of web/dist, start poller
  config.ts                   all env parsing; defaults live here
  types.ts                    THE domain contracts: Provenance, SourceHealth,
                              MarketAdapter, FeedAdapter, Mover, CardQuote…
  db.ts                       sqlite schema + typed repos (cards, snapshots,
                              listings, feed, watchlist, kv)
  adapters/
    runtime.ts                SourceRuntime: pacing, circuit breaker, forced
                              states, health; fetchJson/fetchText; provenanceForAge
    tcgplayer.ts              TCGCSV catalog+daily prices; intraday mpapi top-up
    ebay.ts                   OAuth client-credentials + Browse search + poll
    feed.ts                   twitterapi.io → Nitter RSS fallback; parseRss
    sample.ts                 SAMPLE market simulator + scenario injection
  core/
    poller.ts                 heartbeat: mode selection, per-source polling,
                              kill switches, movers recompute, event emitter
    movers.ts                 signal math + why-generator (read this twice)
    quotes.ts                 cross-market quote/search assembly
  routes/api.ts               REST + SSE + demo endpoints
web/src/
  api.ts                      typed client, formatting, provenance labels/tooltips
  App.tsx                     the whole terminal UI (panels, keyboard, command line)
  styles.css                  the terminal look — see §7 design notes
data/rbt.sqlite               runtime state (gitignored; delete to reseed sample)
```

Branch: **`claude/prompt-md-review-l0lo2f`** — commit and push here, never
elsewhere. `main` only has the initial commit.

---

## 4. Concepts you must not break

### Provenance (the trust backbone)
Every price row carries one of `live | cached | stale | sample | synthetic`
(server `types.ts`). Rules:
- Real fetches are stored `live`; **age downgrades them at read time** via
  `provenanceForAge()` (fresh <30m → `live`, <24h → `cached`, else `stale`).
  Thresholds in `config.ts`.
- `sample` (simulator) and `synthetic` (operator-injected scenario) are
  preserved verbatim through every code path — see `quotes.ts`. If you add a
  new read path, you must preserve this or you've committed the cardinal sin.
- The UI renders a tag next to *every* price (`Prov` component in `App.tsx`)
  with an exact-timestamp tooltip; SAMPLE mode additionally shows a full-width
  banner. Legend lives in the status bar.

### Source health vs provenance
Health (`live/degraded/down/sample/disabled`) is about the *source right now*;
provenance is about *each datum*. A killed source keeps its last data visible
(aged provenance) while health says DOWN. Both are on screen at all times.
`SourceRuntime.force()` implements kill drills and sample labeling; forced
states must win over computed ones (there was a bug here — fixed — where
eBay's "not configured" check pre-empted the forced SAMPLE state; keep the
`rt.isForced` guards).

### Mover scoring (core/movers.ts)
Per card, per source, over 7d of snapshots:
- `pct24h`: strongest per-source move vs ~24h-ago reference (closest-before).
- `volumeZ`: z-score of latest activity vs the card's own trailing week, where
  activity = salesVolume + **listing-count drain** (supply drop = buying).
  Per-card self-normalization is what keeps cheap volatile cards from drowning
  slow expensive ones — do not replace with global thresholds.
- `spreadPct`: current cross-venue gap; credit starts above 4% (fees/noise)
  and is **capped at 20 points** (huge spreads are usually variant-matching
  errors, not alpha).
- `score = |pct24h| + 2.2·max(0,volumeZ) + 0.5·min(16, spread-4)`; floor 1.5.
  Weights are judgment, not physics — tune with data, but keep the shape:
  activity is weighted highest because "quietly accumulating" is the client's
  #1 use case.
- Why-generator: verb follows the **dominant** signal (a spike with flat price
  is "getting bought up", never "selling off"); feed correlation = substring
  match of the card's short name in last-48h feed items. It only states what
  was measured — never let it speculate.

### Sample mode (adapters/sample.ts)
- Mode selection in `poller.start()`: `RBT_MODE=sample` forces it; `auto`
  (default) tries `refreshCatalog()` once and falls back on failure; `live`
  never falls back.
- Deterministic PRNG (mulberry32, fixed seed) seeds 22 plausible cards
  (singles/slabs/promos/sealed incl. "overnumbered") with 14d of 3h-step
  history, and a sample feed. Card names are demo-plausible, not real data.
- Venue prices **mean-revert toward each other** (15% per seed step, 5% per
  tick). This was added after independent walks drifted to permanent ~30%
  spreads that pinned the movers board. Don't remove it.
- `inject(cardId, 'price_jump'|'volume_spike', pct)` queues a scenario applied
  on next tick with `synthetic` provenance + a `[SAMPLE·SCENARIO]` feed echo
  (so the why-engine has chatter to correlate — mirrors real life).
- Reseeding: `rm -rf data/` and restart. Seeding is guarded by kv key
  `sample_seeded`.

---

## 5. The real adapters — exactly what I assumed, so you can verify fast

None of these have touched their real endpoints (sandbox egress blocked).
Each assumption below is where live bring-up may bite you.

### TCGplayer via TCGCSV (`adapters/tcgplayer.ts`)
- Endpoints assumed: `GET {TCGCSV_BASE}/categories`, `/{cat}/groups`,
  `/{cat}/{group}/products`, `/{cat}/{group}/prices` with base
  `https://tcgcsv.com/tcgplayer`; responses `{results: [...]}` (code tolerates
  bare arrays too).
- Category autodiscovery: first category whose `name`/`displayName` matches
  `/riftbound/i`; cached in kv `tcg_category_id`. Riftbound launched on
  TCGplayer in 2025, so it should exist — **verify the category id and pin it
  in `.env` (`TCGPLAYER_CATEGORY_ID`) once known.**
- Price fields assumed per product: `marketPrice`/`midPrice`, `lowPrice`,
  keyed by `productId`; product extendedData carries `Number`/`Rarity`.
  TCGCSV publishes ~once daily (~20:00 UTC per their docs) — the poller
  re-pulls every cycle but data only changes daily; that's fine and honest
  (age tags show it).
- Intraday top-up: `GET https://mpapi.tcgplayer.com/v2/product/{id}/pricepoints`
  — **unofficial endpoint**, shape assumed `[{printingType, marketPrice, …}]`.
  Only for watchlisted cards, 15-min cache, ≥2.5s between requests, off via
  `TCGPLAYER_INTRADAY=0`. If it 403s or the shape differs, disable it and ship
  daily-only rather than fight it; it's a top-up, not a foundation.

### eBay Browse (`adapters/ebay.ts`)
- OAuth: `POST https://api.ebay.com/identity/v1/oauth2/token`, Basic auth,
  `grant_type=client_credentials`, scope `https://api.ebay.com/oauth/api_scope`.
  Token cached until 60s before expiry. This part is well-documented eBay
  behavior, low risk.
- Search: `GET /buy/browse/v1/item_summary/search?q=riftbound+<query>&limit=…&category_ids=2536`
  (2536 = Toys & Hobbies > CCG umbrella; I kept it broad deliberately —
  narrowing to 183454/261329 risks dropping slabs; relevance is filtered by
  title-word matching ≥60% instead). Fields used: `title`, `price.value`,
  `shippingOptions[0].shippingCost.value`, `condition`, `itemWebUrl`.
- Poll targets are bounded (watchlist + up-to-40 cards with data) — this is
  rate-limit respect; do not widen to the whole catalog.
- Averages = trimmed mean (drop top 20%) of active price+shipping; labeled
  as active-listing derived. Sold-history needs the restricted Marketplace
  Insights API — if the client ever gets access, add it as a new field, don't
  silently change the meaning of `avgPrice`.

### Feed (`adapters/feed.ts`)
- twitterapi.io: `GET https://api.twitterapi.io/twitter/user/last_tweets?userName=<h>`,
  header `x-api-key`. Response shape assumed `{data:{tweets:[...]}}` or
  `{tweets:[...]}` with `text`, `createdAt`, `author.name`, `url`/`id`. **Their
  docs were unreachable from the sandbox — verify against one real response
  before trusting timestamps.** Budget: polling 4 accounts every 5 min ≈
  35k requests/mo; at their advertised per-request pricing that's single-digit
  dollars. Check the real bill after week one.
- Nitter fallback: `GET {instance}/{user}/rss`, parsed by the minimal
  `parseRss()` (regex-based; fine for Nitter's flat items, not general XML).
  Public Nitter instances die regularly; the list is env-configurable.
- Dedupe is `UNIQUE(account, ts, text)` in sqlite with `INSERT OR IGNORE` —
  re-polls don't duplicate.

---

## 6. Your first day: live bring-up checklist (in order)

1. `npm install && npm run build && npm start` on a machine with open egress.
   Watch the log: `mode=live` means the TCGCSV catalog loaded; `SAMPLE mode:`
   + reason means it didn't — read the reason, it's the real error.
2. Verify catalog: `curl localhost:8787/api/status` → `cards` should be
   hundreds+ (the whole Riftbound catalog), not 22 (that's the sample count).
   Pin `TCGPLAYER_CATEGORY_ID` in `.env` from kv once discovered.
3. Client registers eBay keys (developer.ebay.com → App ID/Cert ID →
   `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`). Then `curl 'localhost:8787/api/search?q=jinx'`
   and confirm eBay rows appear with `provenance: live` and sane URLs.
4. Client gets a twitterapi.io key → `TWITTERAPI_IO_KEY`. Confirm `/api/feed`
   items carry real timestamps, newest-first, all four accounts.
5. Let it run ≥25h so age-downgrade paths execute; confirm TCGplayer prices
   show `CACH`→ fresh flip after the daily TCGCSV publish, not `STALE` forever.
6. Watch a few cards (`W` command) and confirm intraday top-ups appear
   (`tcgplayer` snapshots between daily publishes) without exceeding pacing
   (log any 403; kill switch is `TCGPLAYER_INTRADAY=0`).
7. Only after 1–6: re-run the full verification protocol (§8) against live data.

Known port/process facts: server listens on `8787` (UI is served from
`web/dist` by the same process). `npm run dev` gives hot-reload UI on `5173`
proxying `/api`.

---

## 7. UI notes (impostor-test discipline)

The look is deliberate: near-black blue-tinted grounds, 1px square borders,
amber section titles, green/red only for direction, cyan for venues, magenta
reserved exclusively for SYNTH. 12px mono everywhere, tabular numerals,
sticky table headers, zero border-radius, zero gradients-as-decoration, no
icons/emoji, no hero anything. If you add UI, match this or you will fail the
impostor test the client cares about most. Density > whitespace; every pixel
should earn its place. Keyboard-first: `/` focuses the command line; TAB
cycles panels; arrows+enter drive selection. The command grammar is in
README.md — extend the grammar rather than adding buttons.

The `SAMPLE DATA — SIMULATED MARKET` banner and the provenance legend are
load-bearing honesty features, not decoration. They stay.

---

## 8. Verification protocol (the client's rule: builders never grade themselves)

For every bar item, spawn a **fresh-context** agent whose only goal is to
prove the bar is NOT met, pointed at the running app. My prompts (reuse them):
impostor (screenshots + harsh design review vs real terminals), search
(API attack: lists, misspellings, nonsense, latency, independently re-derive
best/avg from `/api/card/:id`), trust (hunt any number lacking provenance in
API, UI pixels, and code paths), feed (ordering, dedupe, RSS parsing review),
house-rules gate (code review vs §1 rules), early-signal (inject via
`POST /api/demo/inject {cardId, kind:'price_jump'|'volume_spike', pct}` and
check `/api/movers` ranking within one cycle), resilience
(`POST /api/demo/kill {source, killed}` mid-use, incl. tcgplayer, then restore).

Screenshot tooling for agents: `scratchpad/shot.mjs` pattern — playwright-core
with `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`
(sandbox); **use `waitUntil: 'domcontentloaded'`, never `networkidle` — the
SSE stream keeps the connection open forever and networkidle deadlocks.**

Loop until every test survives a fresh adversarial pass. When I left, wave 1
(impostor, search, trust, feed, house-rules) was in flight and wave 2
(early-signal, resilience drills) was queued behind it. **Collect their
verdicts, fix findings, re-verify, and fold results into the Artifact page
and a commit.** Do not mark anything done on my say-so.

---

## 9. Footguns I actually hit (so you don't)

- **`pkill -f 'tsx server'` kills your own shell** in this harness (the wrapper's
  command line contains your pattern). Even the `[t]sx` bracket trick fails if
  the same literal string appears elsewhere in your compound command. Kill and
  restart in **separate** tool calls, or you'll "wipe" a DB that never got wiped
  and chase phantom +11% movers like I did.
- Playwright + SSE: see §8 — `networkidle` never fires.
- Sample DB persistence: injections persist in `data/rbt.sqlite` across
  restarts. Fresh baseline = delete the dir.
- `better-sqlite3` needs its native build; on Node 22 prebuilds exist. If a
  future Node bump breaks install, `npm rebuild better-sqlite3`.
- The sandbox proxy 403s all market hosts — don't burn an hour re-diagnosing
  adapter "bugs" that are just the proxy. `curl -sS "$HTTPS_PROXY/__agentproxy/status"`
  shows the denials.
- Web `fetch` in the server goes through `undici` and honors `HTTPS_PROXY`
  automatically in this environment; on the client's machine there is no proxy
  — nothing to do, just don't add proxy code.

---

## 10. Roadmap after live bring-up (my ordering, with reasoning)

1. **Wave-1/2 verification findings** — whatever the agents found outranks
   everything below.
2. **eBay↔card linking**: search listings are currently `cardId: null` unless
   polled per-card; tighten title→card matching (set number and grade
   extraction, generalized — no per-card rules) so eBay best-price attribution
   deep-links per card in search results (`bestUrl` for eBay is null today;
   the listing URLs exist in `listings` — surface them).
3. **Event context for why-reads**: a lightweight events table (set releases,
   ban lists, tournaments) fed from the feed itself — "moving after set
   announcement" beats "chatter from @x". Keep it measured-facts-only.
4. **Alerting**: the client asked to *see* moves; a threshold-crossing push
   (even just OS notification / a bell row in the terminal) is the natural
   next step of "catch the curve".
5. **Sold-price depth**: eBay Marketplace Insights if/when granted; TCGplayer
   `latestsales` (unofficial mpapi) as a cautious alternative — same respect
   rules as the intraday endpoint.
6. **Persistence hygiene**: snapshot table grows forever; add a compaction job
   (e.g., thin to hourly after 30d) before it matters. Not urgent.

Explicitly rejected (don't resurrect without new facts): official X API
($200/mo > budget), JustTCG (client chose free path), scraping eBay HTML
(official API exists), any per-card special-casing (house rule).

---

## 11. Working agreement with the client

- Autonomy: decide and act; only ask when it's money, irreversible, or a real
  product fork. They said "I'll tell you when it's done."
- Keep the Artifact build log current per iteration: bar table, screenshots,
  decisions, asks. They check it from their phone and steer via comments.
- Commit style: plain descriptive messages on the designated branch (see §3);
  push after each coherent milestone. Two commits exist: the v0.1 build and
  the README. This handover should be the third.
