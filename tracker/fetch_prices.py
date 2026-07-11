"""Snapshot every Riftbound product's TCGplayer market price to a dated CSV.

Usage:
    python -m tracker.fetch_prices [--out-dir data/snapshots]

Each run writes data/snapshots/YYYY-MM-DD.csv (one row per product+finish) and
refreshes data/catalog.csv with the full product catalog (names, rarity,
card number, set). Run daily — via cron, the GitHub Action in
.github/workflows/daily-prices.yml, or by hand — to build price history.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import sys
from pathlib import Path

from . import tcgcsv

SNAPSHOT_FIELDS = [
    "date",
    "product_id",
    "sub_type",  # Normal / Foil
    "group_id",
    "group_name",
    "product_name",
    "market_price",
    "low_price",
    "mid_price",
    "high_price",
    "direct_low_price",
]

CATALOG_FIELDS = [
    "product_id",
    "group_id",
    "group_name",
    "product_name",
    "clean_name",
    "rarity",
    "number",
    "is_sealed",
    "url",
]


def _extended(product: dict, key: str) -> str:
    for item in product.get("extendedData") or []:
        if item.get("name", "").lower() == key.lower():
            return str(item.get("value", ""))
    return ""


def snapshot(out_dir: Path, catalog_path: Path) -> tuple[Path, int]:
    category_id = tcgcsv.get_category_id()
    groups = tcgcsv.get_groups(category_id)
    today = dt.date.today().isoformat()

    price_rows: list[dict] = []
    catalog_rows: list[dict] = []

    for group in groups:
        gid, gname = group["groupId"], group["name"]
        products = {p["productId"]: p for p in tcgcsv.get_products(category_id, gid)}
        for product in products.values():
            rarity = _extended(product, "Rarity")
            number = _extended(product, "Number")
            catalog_rows.append(
                {
                    "product_id": product["productId"],
                    "group_id": gid,
                    "group_name": gname,
                    "product_name": product["name"],
                    "clean_name": product.get("cleanName", ""),
                    "rarity": rarity,
                    "number": number,
                    # No rarity/number extended data => sealed product or deck
                    "is_sealed": not rarity and not number,
                    "url": product.get("url", ""),
                }
            )
        for price in tcgcsv.get_prices(category_id, gid):
            product = products.get(price["productId"], {})
            price_rows.append(
                {
                    "date": today,
                    "product_id": price["productId"],
                    "sub_type": price.get("subTypeName", ""),
                    "group_id": gid,
                    "group_name": gname,
                    "product_name": product.get("name", ""),
                    "market_price": price.get("marketPrice"),
                    "low_price": price.get("lowPrice"),
                    "mid_price": price.get("midPrice"),
                    "high_price": price.get("highPrice"),
                    "direct_low_price": price.get("directLowPrice"),
                }
            )

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{today}.csv"
    with out_path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=SNAPSHOT_FIELDS)
        writer.writeheader()
        writer.writerows(price_rows)

    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    with catalog_path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CATALOG_FIELDS)
        writer.writeheader()
        writer.writerows(catalog_rows)

    return out_path, len(price_rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", default="data/snapshots", type=Path)
    parser.add_argument("--catalog", default="data/catalog.csv", type=Path)
    args = parser.parse_args()

    out_path, count = snapshot(args.out_dir, args.catalog)
    print(f"Wrote {count} price rows to {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
