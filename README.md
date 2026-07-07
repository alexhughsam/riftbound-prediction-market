# RBT▮ Riftbound Terminal

One screen for trading and tracking **Riftbound** (Riot's TCG) cards — a
Bloomberg-style terminal, not a dashboard. It watches TCGplayer and eBay,
surfaces cards that are moving *right now* with a plain-language read on why,
quotes average + best price across both venues for any card (or list of
cards, including slabs and promos), and pulls the Riftbound voices you follow
into one in-terminal wire.

```
npm install
npm run build     # typecheck + build the UI
npm start         # serves http://localhost:8787
```

With no keys configured it runs a clearly-labeled **SAMPLE** market so every
panel works out of the box. Copy `.env.example` to `.env` and add keys to go
live — the mode is chosen automatically at startup.

## Panels

| Panel | What it does |
| --- | --- |
| **MOVERS — EARLY SIGNAL** | Cards ranked by a composite of 24h momentum, activity anomaly (z-score vs the card's own trailing week), and cross-market spread. Each mover carries a plain-language "why" correlated against feed chatter. |
| **BOARD / SEARCH** | `S jinx` or `S teemo promo, ahri overnumbered, origins booster` — blended average and single best price across venues, attributed and aged. Defaults to the highest-value board. |
| **CARD DETAIL** | Per-venue avg/best/listings/age/state, 14-day two-venue sparkline, Δ24H/Δ7D, and the signal read if the card is moving. |
| **WIRE** | The X accounts you follow, one feed, newest-first. |
| **Status bar** | Per-source health (LIVE/DEGRADED/DOWN/SAMPLE/DISABLED) and the provenance legend. |

## Command line (bottom of screen, `/` to focus)

```
S <name>[, <name>…]   search / quote a list of cards
W <row> / UW <row>    watch / unwatch (watched cards get intraday top-ups)
O <row>               open a search row in CARD DETAIL
K tcg|ebay|feed       kill a source (resilience drill)   R … restores
INJECT <row> JUMP|VOL [pct]   SAMPLE mode only: inject a demo scenario
MV / FD               focus movers / feed   ·   TAB cycles panels
```

`↑`/`↓` select rows, `⏎` opens detail.

## Trust model

Every number on screen carries a provenance tag and hover attribution
(source + exact observation time):

- `LIVE` fetched within the freshness window · `CACH` aged · `STALE` old and
  loudly marked
- `SMPL` simulated demo data · `SYNTH` operator-injected scenario

Sample/synthetic values can never masquerade as real ones, and real values
downgrade by age automatically. eBay "averages" are derived from active
listings (eBay's sold-history API is restricted) and labeled as such.

## Sources & respect

All sources sit behind one `MarketAdapter` interface
(`server/src/adapters/`): swap or add a source without touching the app.
Every adapter is rate-limited, cached, circuit-breakered, and identifies
itself honestly (`RBT_USER_AGENT`). A down source degrades visibly — the
terminal never blanks and never crashes.

- **TCGplayer** — catalog + daily market prices from [TCGCSV](https://tcgcsv.com)
  (free mirrors of TCGplayer's own data); optional gentle intraday top-ups for
  watchlisted cards (1 req/2.5s, 15-min cache; `TCGPLAYER_INTRADAY=0` disables).
- **eBay** — official Browse API (free developer account; see `.env.example`).
- **X wire** — [twitterapi.io](https://twitterapi.io) (pay-per-request) with
  Nitter RSS fallback.

## Development

```
npm run dev         # server (tsx watch) + Vite dev server on :5173
npm run typecheck
```

Server: Fastify + better-sqlite3 (`server/src/`) — adapters, poller,
mover engine, REST + SSE. UI: React + Vite (`web/src/`), no UI framework.
State lives in `data/rbt.sqlite` (delete it to reseed the sample market).
