"""Value your Riftbound holdings against the latest price snapshot.

Maintain config/portfolio.csv (see config/portfolio.example.csv), then:

    python -m tracker.portfolio

Prints per-position and total cost basis, current market value, and P&L.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from .report import load_snapshot


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snap-dir", default="data/snapshots", type=Path)
    parser.add_argument("--portfolio", default="config/portfolio.csv", type=Path)
    args = parser.parse_args()

    snaps = sorted(args.snap_dir.glob("*.csv"))
    if not snaps:
        raise SystemExit(f"No snapshots in {args.snap_dir}; run fetch_prices first.")
    latest = load_snapshot(snaps[-1])

    if not args.portfolio.exists():
        raise SystemExit(
            f"{args.portfolio} not found. Copy config/portfolio.example.csv "
            f"to config/portfolio.csv and fill in your positions."
        )

    total_cost = total_value = 0.0
    print(f"# Portfolio valuation @ {snaps[-1].stem}\n")
    header = f"{'qty':>4}  {'cost':>10}  {'value':>10}  {'P&L':>10}  {'%':>7}  position"
    print(header)
    print("-" * len(header))

    with args.portfolio.open(newline="") as fh:
        for pos in csv.DictReader(fh):
            qty = int(pos["quantity"])
            cost = float(pos["unit_cost"]) * qty
            key = (pos["product_id"], pos.get("sub_type") or "Normal")
            row = latest.get(key)
            name = row["product_name"] if row else pos.get("note", f"product {key[0]}")
            price = float(row["market_price"] or 0) if row else 0.0
            value = price * qty
            pnl = value - cost
            pct = (pnl / cost * 100) if cost else 0.0
            total_cost += cost
            total_value += value
            print(
                f"{qty:>4}  {cost:>10.2f}  {value:>10.2f}  {pnl:>+10.2f}  "
                f"{pct:>+6.1f}%  {name} [{key[1]}]"
            )

    pnl = total_value - total_cost
    pct = (pnl / total_cost * 100) if total_cost else 0.0
    print("-" * len(header))
    print(f"TOTAL cost ${total_cost:,.2f}  value ${total_value:,.2f}  P&L ${pnl:+,.2f} ({pct:+.1f}%)")


if __name__ == "__main__":
    main()
