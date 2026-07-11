# Gap Analysis: What You Were Missing (and what's still missing)

*The question: "starting from scratch on Riftbound TCG investments, what am I missing to get up to speed properly and quickly?" Answer below, July 2026.*

## What this repo now covers

| Need | Status | Where |
|---|---|---|
| Daily price data (all Riftbound singles + sealed, TCGplayer) | ✅ Built | `tracker/fetch_prices.py` + daily GitHub Action |
| Price history accumulation | ✅ Built (starts accruing from first run) | `data/snapshots/` |
| Movers report (gainers/losers) | ✅ Built | `tracker/report.py` |
| Watchlist with buy/sell trigger alerts | ✅ Built | `tracker/report.py` + `config/watchlist.csv` |
| Portfolio cost-basis and P&L tracking | ✅ Built | `tracker/portfolio.py` |
| Per-product price history query | ✅ Built | `tracker/history.py` |
| Market structure knowledge (sets, products, rarities, print policy) | ✅ Documented | `docs/market-primer.md` |
| Data-source map (free APIs, paid APIs, dead ends) | ✅ Documented | `docs/data-sources.md` |
| Strategy framework + comparable-launch analysis + risk factors | ✅ Documented | `docs/strategy-playbook.md` |

## Still missing — ranked by value, with concrete next steps

### High value

1. **Historical price backfill.** Your snapshots start today. Fix: download tcgcsv's daily archive dumps (published on tcgcsv.com) to backfill category 89 back to Origins launch, or pull Scrydex's price-history endpoint (free tier, 5k credits/mo). Without history you can't compute baselines, seasonality around set releases, or reprint-impact curves.
2. **Sold-price data (what things actually trade at, not asks).** TCGplayer market price is a proxy; graded cards and sealed lots clear on eBay. Fix: PriceCharting subscription (~$6/mo entry) — its API serves eBay-sold-derived prices per grade, plus Riftbound pop pages. This is the single best paid upgrade.
3. **Event-driven awareness.** Prices move on announcements (bans, reprints, State of the Game), not on schedule. Fix: follow the Riot announcements feed + @RiftboundReport; consider a small scraper on playriftbound.com/en-us/news/announcements/ that alerts on new posts. Ban lists have a demonstrated ~day-scale price impact; reprint announcements have a week-scale impact.
4. **Restock/drop alerts for buying at MSRP.** The entire sealed edge is buying at MSRP, not street. Fix: Restockd (restockd.app/brands/riftbound), Riot merch store drawing entries (per-Riot-ID limits), LGS preorder relationships via the UVS store locator.

### Medium value

5. **Tournament/meta feed → singles positioning.** Regional top-8s move singles within days. riftdecks.com has the structured data (1,991 tournaments logged) but no public API — scraping it or manually reviewing weekly is the gap. Note the China-preview edge dies July 31, 2026 (global simultaneous releases).
6. **Condition/graded granularity.** tcgcsv gives one market price per product+finish. JustTCG free tier adds NM/LP/MP/HP splits; PSA pop tracking (GemRate or PriceCharting pop pages) tells you when a chase card's graded population is inflecting.
7. **EU price signal.** CardTrader API (free) gives EUR minimums incl. CN-language variants — useful for the CN-discount arbitrage and for spotting regional divergence.

### Lower value / later

8. **Population-report time series** — scrape PSA pop pages weekly for the ~50 chase cards; pop growth rate vs price is the classic graded-market signal.
9. **eBay Browse API polling** for live asks on `riftbound psa 10` and sealed lots (free, 5k calls/day) — catches mispriced listings.
10. **Modeling** — once ≥90 days of snapshots accrue: reprint-impact curves, set-release seasonality, EV-per-box calculators using pull rates (1:360 signatures, 1:1000+ Ultimates) × current singles prices.

## Information gaps no tool can close (judgment calls)

- **Does Riftbound retain players through Worlds 2027?** Player base is the price floor (MetaZoo lesson). Watch: tournament attendance, ICv2 retailer surveys, TCGplayer bestseller rank.
- **When does the digital client land?** Riot says "not if, but when." Biggest single repricing event on the calendar.
- **Will Riot ever stop reprinting a set?** The first set Riot lets go out of print becomes the One Piece OP-01 analog. No signal yet — current policy is the opposite.

## The core strategic insight from the research

Riftbound has **One Piece-level demand and Lorcana-level supply policy**. Riot reprints to demand, doesn't differentiate first prints, sells direct with ID limits, and promo-prints any spiking staple to zero (Flash, April 2026). The market rewards: MSRP-only sealed buying, non-reprintable scarcity (signatures, event promos, Worlds bundles), early grading of low-pop chases, and meta-driven singles timing — and punishes warehouse-scale sealed speculation at street prices.
