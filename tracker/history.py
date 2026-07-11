"""Print the price history of products matching a name substring, across all
accumulated snapshots.

Usage:
    python -m tracker.history "booster box"
    python -m tracker.history jinx --sub-type Foil
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="case-insensitive substring of product name")
    parser.add_argument("--snap-dir", default="data/snapshots", type=Path)
    parser.add_argument("--sub-type", default=None, help="Normal or Foil")
    args = parser.parse_args()

    snaps = sorted(args.snap_dir.glob("*.csv"))
    if not snaps:
        raise SystemExit(f"No snapshots in {args.snap_dir}; run fetch_prices first.")

    # series[(product_name, sub_type)] = [(date, market_price), ...]
    series: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    query = args.query.lower()
    for snap in snaps:
        with snap.open(newline="") as fh:
            for row in csv.DictReader(fh):
                if query not in row["product_name"].lower():
                    continue
                if args.sub_type and row["sub_type"] != args.sub_type:
                    continue
                key = (row["product_name"], row["sub_type"])
                series[key].append((row["date"], row["market_price"]))

    if not series:
        raise SystemExit(f"No products matching {args.query!r}")

    for (name, sub), points in sorted(series.items()):
        print(f"\n# {name} [{sub}]")
        for date, price in points:
            print(f"  {date}  ${price}")


if __name__ == "__main__":
    main()
