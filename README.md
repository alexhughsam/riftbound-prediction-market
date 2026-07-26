# riftbound-prediction-market

All the tools necessary to track Riftbound prices.

## Riftbound Match Tracker (Chrome extension)

A Manifest V3 Chrome extension in [`extension/`](extension/) for logging Riftbound TCG match results.

### Features

- **Match result submission** — record win / loss / draw for each game.
- **Chosen champion** — track which champion you played (and optionally your opponent's).
- **Battlefield** — record the battlefield the match was played on.
- **Mulligan** — a yes/no toggle for whether you mulliganed your opening hand.
- **Cards & format** — capture your deck / key cards and the format played (1v1, 2v2, Free-for-All, Draft, Sealed, Casual).
- **Persistence** — matches are saved with `chrome.storage.local`, so history, stats, and your last-used format/champion/deck/battlefield survive closing the popup and restarting the browser.
- **History & stats** — running win rate, per-match detail, per-match delete, clear-all, and JSON export.
- Autocomplete suggestions for champions, decks, and battlefields based on what you've previously entered.

### Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` directory.
4. Pin the extension and click its icon to open the tracker.

### Development

No build step — plain HTML/CSS/JS. The popup also runs as a normal page
(`extension/popup.html`) outside Chrome's extension context, falling back to
`localStorage` for persistence.
