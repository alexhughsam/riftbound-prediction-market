import type { Card } from '../types.js';

/**
 * Card art resolution — no keys, no scraping, no per-card rules.
 *
 * Candidates in priority order; the browser walks the chain on load error:
 *  1. Piltover Archive CDN (Riot's official Riftbound site):
 *       https://cdn.piltoverarchive.com/cards/{CODE}.webp   e.g. OGN-045
 *     Used when a set-style code is derivable from the card's collector
 *     number (works for singles/promos; not sealed).
 *  2. TCGplayer product image by productId (covers everything TCGCSV
 *     ingested, including sealed):
 *       https://product-images.tcgplayer.com/fit-in/437x437/{productId}.jpg
 *
 * SAMPLE-mode cards are fictional, so they get no candidates at all — the UI
 * renders a labeled placeholder instead. Real art must never be attached to
 * a demo card.
 */

const CODE_RE = /\b([A-Z]{2,4})[-\s]?(\d{1,3}[a-z]?)\b/;

export function cardCode(card: Card): string | null {
  const fields = [card.number ?? '', card.name];
  for (const f of fields) {
    const m = CODE_RE.exec(f);
    if (m) return `${m[1]}-${m[2].padStart(3, '0')}`;
  }
  return null;
}

export function imageCandidates(card: Card, sampleMode: boolean): string[] {
  if (sampleMode) return [];
  const out: string[] = [];
  const code = cardCode(card);
  if (code && card.kind !== 'sealed') {
    out.push(`https://cdn.piltoverarchive.com/cards/${code}.webp`);
  }
  if (card.tcgplayerProductId) {
    out.push(`https://product-images.tcgplayer.com/fit-in/437x437/${card.tcgplayerProductId}.jpg`);
  }
  return out;
}
