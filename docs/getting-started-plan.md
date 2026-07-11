# Getting Started: A Concrete First-Investment Plan

*Written July 2026 for someone starting from zero. This is a framework, not financial advice — collectibles are illiquid, spreads are ~13%, and this game is 9 months old.*

## Position sizing: the only rule that matters

TCGs are a high-risk, illiquid alternative asset. The standard framing serious TCG investors use:

- **Only money you can lose 100% of without it mattering.** MetaZoo went from $9,000 boxes to bankruptcy in under 3 years.
- **Cap it at ~5% of your investable net worth** (the common alternative-assets ceiling), and within that, treat Riftbound as ONE position in a risky asset class — not a diversified portfolio.
- **Enter in stages, never all at once.** The market hands you multiple entry windows per year (set releases, reprint waves, post-hype cooldowns). The Origins box arc ($337 March → $183 May) shows what buying the top costs you: -45% in 9 weeks.

A sane starter structure: decide a total budget `B`, deploy ~1/3 now, ~1/3 at the next catalyst window (Vendetta launch July 31 / T1 drawing August), hold ~1/3 in reserve for the dips that reprint announcements create.

## A model starter allocation (adapt to your budget)

| Bucket | % | What | Why |
|---|---|---|---|
| Non-reprintable scarcity | 40% | T1 Signature Edition (enter the August drawing at $360 — serialized /2025, fixed print 10,125/language), event promos, Worlds Bundle-type items | The only structurally supply-capped assets in this game. The T1 set is the first serialized retail product Riftbound has ever had |
| MSRP-only sealed | 25% | Vendetta/Radiance displays at $119.99 via Riot drawings, LGS preorders, retail drops. **Never above MSRP** | Downside bounded near MSRP; you're not fighting Riot's printer if you never pay the scalper premium |
| Graded chase singles | 20% | PSA 10s of signature overnumbereds while populations are double-digit; or grade raw pulls/buys yourself (only cards worth >$150 raw given $80 grading cost) | Pop-report first-mover edge is still open; this is where the +60-70% moves happened |
| Meta singles (trading, not holding) | 10% | Buy meta-relevant staples ahead of RQ results (Barcelona/LA Sep, Singapore Oct, Convergence Fest Dec), sell into spikes | Short holding periods; remember Riot promo-prints spiking staples (Flash) — take profits fast |
| Cash reserve | 5%+ | — | Reprint-announcement dips are recurring buying opportunities |

## What NOT to do with a first investment

1. **Don't buy street-priced sealed of old sets.** Origins at $183+ is still under active reprint pressure and Riot has said more is coming.
2. **Don't hold playable staples long.** Flash: $72 → ~$40 after Riot mailed free copies to every store.
3. **Don't pay today's hype price for T1 product on the secondary market.** Enter the Riot drawing at $360; if you lose the lottery, wait — One Piece/Lorcana precedent says limited products spike at release then retrace 20-40% within months before the long climb (if any).
4. **Don't skip the exit math.** ~13% all-in fees on TCGplayer, 13.25% on eBay. A card must rise ~15% just to break even. This kills small-position trading of cheap cards.

## The catalyst calendar (next 8 months — your entry/exit map)

| Date | Event | Playbook |
|---|---|---|
| Jul 31, 2026 | Vendetta (first global-parity set; Akali completes 4/5 K/DA) | Buy at MSRP only; singles market inefficient in week 1 |
| Aug 2026 | **T1 Worlds Champion Collection drawing** ($360 Signature Edition, 10,125/language, serialized /2025; $70 Player Bundle later) | Enter the drawing with your Riot ID. The highest-conviction single action available right now |
| Sep 2026 | Korean-language Origins launch | New demand pool for OGN chase cards |
| Sep 21-27, 2026 | Barcelona + Los Angeles Regional Qualifiers | Meta singles positioning before, sell into results |
| Oct 4-6, 2026 | Singapore RQ | Same |
| Oct 23, 2026 | **Radiance** — the de-facto K/DA set (Seraphine/Evelynn/Ekko, music theme) | The K/DA thesis event. Chase supply unknown until pull rates confirmed — don't pre-pay the rumor premium |
| Dec 11-13, 2026 | Convergence Fest, Las Vegas — NA Regional Championship + TFT (exclusive attendee promo card) | Event promos = fixed supply; attendance is a player-base health read |
| 2027 | **First Riftbound Worlds** (date/location TBA) | The macro milestone the whole bull case builds toward |

## How to "see how it works out" — measure, don't vibe

This repo is the measurement system:

1. **Log every buy** in `config/portfolio.csv` (product_id, qty, unit_cost) the day you buy.
2. **Let the daily snapshot workflow run** — after merging to main, price history accrues automatically.
3. **Check `python -m tracker.portfolio` weekly**, not daily. Illiquid assets need weekly/monthly cadence.
4. **Set review checkpoints**: after Radiance (Nov 2026) and after Convergence Fest (Jan 2027), compare your P&L per bucket. Scale up only the buckets that are working, after fees.
5. **Predefine exits**: for meta singles, sell into event spikes; for the T1 set and graded cards, decide now whether the target is Worlds 2027 hype or a multi-year hold — and write it in the `note` column of your portfolio so future-you remembers the thesis.

## Reconciling the bull and bear cases (read both, size accordingly)

**The bull case is real**: confirmed T1 collab with the game's first serialized cards, a near-certain K/DA set in October, Korean market opening, growing tournament attendance (Hartford RQ hit 1,954 players in June), Worlds 2027, and TCGplayer top-5 sales rank two quarters running. Chase signatures did appreciate meaningfully in 2026 (Kai'Sa signature roughly $1,465 → $2,356-2,524).

**The bear case is also real**: Riot reprints sealed aggressively (-45% on Origins boxes in 9 weeks), promo-prints spiking staples, and the "high-end doubled/tripled in 3-4 months" narrative is overstated — verified moves on named cards are more like +20% to +70%, and the Lorcana analog (Enchanted Elsa: $250 → $1,100 → back to ~$700) shows first-set chase cards can round-trip when supply and graded populations catch up.

Both cases point to the same portfolio: **concentrate on what Riot cannot reprint, buy everything else only at MSRP, trade the event calendar, and keep the position small enough that a MetaZoo outcome doesn't hurt.**
