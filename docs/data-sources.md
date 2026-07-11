# Riftbound Price Data Sources

*Verified July 2026. Ranked by usefulness-per-dollar for an individual investor.*

## Tier 1: use these (free, working today)

### tcgcsv.com — TCGplayer prices, singles + sealed (THE backbone; what `tracker/` uses)

Free daily mirror of the full TCGplayer catalog and market prices. No auth, no key.

- **Riftbound category ID: `89`**
- Groups (sets) as of July 2026:

| groupId | Set |
|---|---|
| 24344 | Origins (OGN) |
| 24439 | Origins: Proving Grounds (OGS) |
| 24519 | Spiritforged (SFD) |
| 24560 | Unleashed (UNL) |
| 24502 | Worlds Bundle 2025 |
| 24343 | Promotional Cards |
| 24528 | Organized Play Promotional Cards |
| 24552 | Judge Promotional Cards |

- Endpoints:
  - `https://tcgcsv.com/tcgplayer/categories`
  - `https://tcgcsv.com/tcgplayer/89/groups`
  - `https://tcgcsv.com/tcgplayer/89/{groupId}/products`
  - `https://tcgcsv.com/tcgplayer/89/{groupId}/prices`
  - `https://tcgcsv.com/last-updated.txt` — poll this; only re-sync when it changes
- Price rows: `{productId, subTypeName: "Normal"|"Foil", lowPrice, midPrice, highPrice, marketPrice, directLowPrice}`
- Refreshes once daily ~20:00 UTC. Etiquette: ≤10k req/day, ≥100ms between requests, descriptive User-Agent, backend only (no CORS).
- Historical daily dumps are published as downloadable archives on the site — useful for backfilling history you missed.

### api.riftcodex.com — card catalog + join keys (free, no auth)

Community card database with clean REST API. Critical feature: cards carry `tcgplayer_id`, and `/sets` returns TCGplayer `groupId`s — **exact joins to tcgcsv prices, no fuzzy name matching**.

- `GET https://api.riftcodex.com/cards?set_id=ogn&limit=50&page=1` → `{items: [...]}`
- Lookup by ID, name, or `tcgplayer_id`. Docs: riftcodex.com/docs. Server-side only (no CORS).

### eBay Browse API — current asks on sealed/graded (free, 5k calls/day)

Free developer account → OAuth2 client-credentials. **Active listings only — no sold data** (Marketplace Insights is partner-only; Finding API dead since Feb 2025). Good for tracking live asks on `riftbound psa 10` and sealed lots.

### PSA Public API — cert verification (free, 100 calls/day)

`api.psacard.com/publicapi` — cert-number lookup only (grade + images). **No pop-report endpoint.** Pop data: scrape psacard.com/pop, or use PriceCharting's pop pages (below).

## Tier 2: cheap paid, high value

### PriceCharting API — graded prices + eBay-sold comps + sealed (paid sub, ~$6/mo entry)

The only realistic sold-comps source for an individual, since eBay locked sold data behind partner-only APIs. Covers Riftbound per set (`/console/riftbound-origins`, `-spiritforged`, `-unleashed`, `-origins-proving-grounds`) with Ungraded/PSA-graded/sealed prices derived from eBay solds. Also publishes **PSA+CGC population pages** for Riftbound (`pricecharting.com/pop/item/riftbound-origins/...`).

- API: any paid sub → 40-char token → `GET /api/product?t={token}&q={name}` (prices in pennies). No historical data via API; full-catalog CSV only on top tier.

### JustTCG — condition-graded prices + change stats (free tier: 1k calls/mo; $19/mo: 10k)

Covers Riftbound singles + sealed with **per-condition pricing (NM/LP/MP/HP)** and 7d/30d/90d change stats — things tcgcsv doesn't have. REST + `X-API-Key`; npm SDK `justtcg-js`.

### Scrydex — price history API (free tier: 5k credits/mo)

Dedicated Riftbound module including a **price-history endpoint** (3 credits/call) — the easiest way to get historical curves you didn't collect yourself.

## Tier 3: EU signal

- **CardTrader API** — open API, free token, 200 req/10s, carries Riftbound with per-language (EN/CN) minimums: `api.cardtrader.com/api/v2`. Best free EU source.
- **Cardmarket** — lists Riftbound (EUR trend prices) but the official API is closed to new applicants. Only via paid third-party scrapers (Apify actor "Cardmarket Riftbound Trend Scraper") — ToS/reliability caution.

## Dead ends (don't waste time)

| Source | Status |
|---|---|
| TCGplayer official API | Closed to new developers since late 2024 (post-eBay acquisition). tcgcsv is the public mirror. |
| eBay Marketplace Insights (sold data) | Limited Release, business partners only; individuals denied |
| eBay Finding API | Shut down Feb 2025 |
| Cardmarket official API | Not accepting applications since ~2023 |
| Riot official API (`developer.riotgames.com/docs/riftbound`) | Real, but card data only — **no prices** — and key approval reportedly takes 5–6+ months |
| Terapeak | Free in Seller Hub but manual UI only, no API |

## Reference repos worth cribbing from

- `novaoc/rarebox` — production daily-CI tcgcsv→JSON price pipeline for Riftbound
- `openriftapp/openrift` — typed tcgcsv ingestion + marketplace snapshots
- `SbrakkDev/rift_vault` — CardTrader (EU) daily Riftbound sync, joined via RiftCodex
- `lifihuang/tcg-pricing` — hedonic price modeling over the tcgcsv Riftbound dump
- `Piltover-Archive/RiftboundDeckCodes` — official deck-code library (TypeScript)

## Recommended architecture (implemented in this repo)

1. **Daily snapshot** (free): tcgcsv cat 89 → `data/snapshots/YYYY-MM-DD.csv` via GitHub Actions (`.github/workflows/daily-prices.yml`). ~18 requests/day.
2. **Catalog**: refreshed to `data/catalog.csv` each run; enrich with riftcodex if you need card metadata beyond rarity/number.
3. **Next upgrades** (not yet built): PriceCharting sub for graded/sold comps; JustTCG or Scrydex free tier for condition data and history backfill; eBay Browse API for live graded asks.
