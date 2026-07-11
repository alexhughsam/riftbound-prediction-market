# riftbound-prediction-market

Tools and intelligence for tracking and investing in the Riftbound TCG (Riot's League of Legends trading card game).

## Start here

| Doc | What it answers |
|---|---|
| [docs/gap-analysis.md](docs/gap-analysis.md) | **"What am I missing?"** — what's covered, what's not, ranked next steps |
| [docs/market-primer.md](docs/market-primer.md) | Sets, products, MSRPs, chase cards, print policy, grading — the market as of July 2026 |
| [docs/data-sources.md](docs/data-sources.md) | Every usable price API (free and paid), verified endpoints, dead ends |
| [docs/strategy-playbook.md](docs/strategy-playbook.md) | Investment thesis, comparable-launch analysis, signals to track, buy/sell mechanics |

## Tooling

Daily TCGplayer prices for every Riftbound product (singles + sealed) via the free [tcgcsv.com](https://tcgcsv.com) mirror — no API key needed.

```bash
pip install -r requirements.txt

# Snapshot today's prices -> data/snapshots/YYYY-MM-DD.csv (+ data/catalog.csv)
python -m tracker.fetch_prices

# Biggest gainers/losers between snapshots, plus watchlist buy/sell alerts
python -m tracker.report

# Price history for any product across your snapshots
python -m tracker.history "booster display"

# Portfolio P&L against latest prices
cp config/portfolio.example.csv config/portfolio.csv   # then add positions
python -m tracker.portfolio
```

`.github/workflows/daily-prices.yml` runs the snapshot automatically every day at 21:00 UTC (after tcgcsv's ~20:00 refresh) and commits the results — price history accrues hands-free once this repo's default branch has the workflow.

### Config

- `config/watchlist.csv` — product_id, sub_type, buy_below, sell_above (product IDs are in `data/catalog.csv`)
- `config/portfolio.csv` — product_id, sub_type, quantity, unit_cost

Both are gitignored (copy from the `.example.csv` files).

## The thesis in one line

Riftbound has One Piece-level demand and Lorcana-level supply policy — buy scarcity Riot can't reprint (signatures, event promos, MSRP sealed), never chase street-priced sealed, and read [the playbook](docs/strategy-playbook.md) before putting money in.
