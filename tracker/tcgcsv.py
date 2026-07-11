"""Thin client for tcgcsv.com — a free, no-auth daily mirror of the TCGplayer
catalog and market prices (refreshed ~daily around 20:00 UTC).

The Riftbound category is discovered by name rather than hardcoded so the
tooling keeps working if IDs shift.
"""

from __future__ import annotations

import time

import requests

BASE = "https://tcgcsv.com/tcgplayer"
# "Riftbound League of Legends Trading Card Game", verified July 2026;
# auto-discovery below is the source of truth if this drifts.
FALLBACK_CATEGORY_ID = 89

_session = requests.Session()
_session.headers["User-Agent"] = (
    "riftbound-prediction-market/1.0 (github.com/alexhughsam/riftbound-prediction-market)"
)


def _get(path: str, retries: int = 4) -> dict:
    url = f"{BASE}/{path}"
    delay = 2.0
    for attempt in range(retries + 1):
        try:
            # tcgcsv etiquette: >=100ms between requests
            time.sleep(0.15)
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


def get_last_updated() -> str:
    """Daily refresh stamp (~20:00 UTC). Only re-sync when this changes."""
    resp = _session.get("https://tcgcsv.com/last-updated.txt", timeout=30)
    resp.raise_for_status()
    return resp.text.strip()


def get_category_id() -> int:
    for cat in _get("categories")["results"]:
        if "riftbound" in cat["name"].lower():
            return cat["categoryId"]
    return FALLBACK_CATEGORY_ID


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
