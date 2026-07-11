"""Daily movers report: compare the two most recent snapshots (or any span)
and print the biggest gainers/losers, plus watchlist alerts.

Usage:
    python -m tracker.report                    # latest vs previous snapshot
    python -m tracker.report --days 7           # latest vs ~7 days back
    python -m tracker.report --min-price 5      # ignore bulk under $5
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


def load_snapshot(path: Path) -> dict[tuple[str, str], dict]:
    rows = {}
    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            rows[(row["product_id"], row["sub_type"])] = row
    return rows


def pick_snapshots(snap_dir: Path, days: int) -> tuple[Path, Path]:
    snaps = sorted(snap_dir.glob("*.csv"))
    if len(snaps) < 2:
        raise SystemExit(
            f"Need at least 2 snapshots in {snap_dir} to compare "
            f"(found {len(snaps)}). Run fetch_prices daily to build history."
        )
    latest = snaps[-1]
    baseline = snaps[max(0, len(snaps) - 1 - days)]
    return baseline, latest


def load_watchlist(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="") as fh:
        return list(csv.DictReader(fh))


def fmt_row(name: str, sub: str, old: float, new: float) -> str:
    pct = (new - old) / old * 100 if old else 0.0
    return f"  {pct:+7.1f}%  ${old:>8.2f} -> ${new:>8.2f}  {name} [{sub}]"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snap-dir", default="data/snapshots", type=Path)
    parser.add_argument("--watchlist", default="config/watchlist.csv", type=Path)
    parser.add_argument("--days", default=1, type=int, help="lookback span in snapshots")
    parser.add_argument("--top", default=15, type=int)
    parser.add_argument("--min-price", default=2.0, type=float)
    args = parser.parse_args()

    baseline_path, latest_path = pick_snapshots(args.snap_dir, args.days)
    baseline = load_snapshot(baseline_path)
    latest = load_snapshot(latest_path)

    changes = []
    for key, row in latest.items():
        old_row = baseline.get(key)
        if not old_row:
            continue
        try:
            old = float(old_row["market_price"])
            new = float(row["market_price"])
        except (TypeError, ValueError):
            continue
        if max(old, new) < args.min_price or old == 0:
            continue
        changes.append((new / old - 1, old, new, row))

    changes.sort(key=lambda item: item[0])

    gainers = [c for c in changes if c[0] > 0]
    losers = [c for c in changes if c[0] < 0]

    print(f"# Riftbound movers: {baseline_path.stem} -> {latest_path.stem}")
    print(f"\n## Top {args.top} gainers")
    for pct, old, new, row in reversed(gainers[-args.top:]):
        print(fmt_row(row["product_name"], row["sub_type"], old, new))
    print(f"\n## Top {args.top} losers")
    for pct, old, new, row in losers[: args.top]:
        print(fmt_row(row["product_name"], row["sub_type"], old, new))

    watchlist = load_watchlist(args.watchlist)
    if watchlist:
        print("\n## Watchlist")
        for entry in watchlist:
            key = (entry["product_id"], entry.get("sub_type", "Normal"))
            row = latest.get(key)
            if not row:
                print(f"  (no data) product {key[0]} [{key[1]}]")
                continue
            price = float(row["market_price"] or 0)
            line = f"  ${price:>8.2f}  {row['product_name']} [{row['sub_type']}]"
            buy_below = float(entry["buy_below"]) if entry.get("buy_below") else None
            sell_above = float(entry["sell_above"]) if entry.get("sell_above") else None
            if buy_below and price <= buy_below:
                line += f"  <<< BUY signal (target {buy_below})"
            if sell_above and price >= sell_above:
                line += f"  <<< SELL signal (target {sell_above})"
            print(line)


if __name__ == "__main__":
    main()
