"""Thin client for tcgcsv.com — a free, no-auth daily mirror of the TCGplayer
catalog and market prices (refreshed ~daily around 20:00 UTC).

The Riftbound category is discovered by name rather than hardcoded so the
tooling keeps working if IDs shift.
"""

from __future__ import annotations

import time

import requests

BASE = "https://tcgcsv.com/tcgplayer"
CATEGORY_NAME = "Riftbound"

_session = requests.Session()
_session.headers["User-Agent"] = "riftbound-prediction-market/1.0"


def _get(path: str, retries: int = 4) -> dict:
    url = f"{BASE}/{path}"
    delay = 2.0
    for attempt in range(retries + 1):
        try:
            resp = _session.get(url, timeout=30)
            resp.raise_for_status()
            payload = resp.json()
            if not payload.get("success", True):
                raise RuntimeError(f"tcgcsv error for {url}: {payload.get('errors')}")
            return payload
        except (requests.RequestException, ValueError):
            if attempt == retries:
                raise
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


def get_category_id(name: str = CATEGORY_NAME) -> int:
    cats = _get("categories")["results"]
    for cat in cats:
        if cat["name"].strip().lower() == name.strip().lower():
            return cat["categoryId"]
    available = ", ".join(sorted(c["name"] for c in cats))
    raise KeyError(f"Category {name!r} not found on tcgcsv. Available: {available}")


def get_groups(category_id: int) -> list[dict]:
    """Sets/products groups for a category (e.g. Origins, promos, decks)."""
    return _get(f"{category_id}/groups")["results"]


def get_products(category_id: int, group_id: int) -> list[dict]:
    return _get(f"{category_id}/{group_id}/products")["results"]


def get_prices(category_id: int, group_id: int) -> list[dict]:
    """Price rows keyed by productId + subTypeName (Normal/Foil).

    Fields: lowPrice, midPrice, highPrice, marketPrice, directLowPrice.
    """
    return _get(f"{category_id}/{group_id}/prices")["results"]
