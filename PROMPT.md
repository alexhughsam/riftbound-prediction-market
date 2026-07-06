# Build me the Riftbound Terminal

> A prompt written in the style of *How I Prompt Fable* — goal over steps, hard house
> rules, a bar you can't talk your way out of, and a loop that runs until it's actually there.
> Hand this whole file to your agent and let it go.

---

## The goal

Build me a single terminal — one screen, everything in one place — for trading and
tracking **Riftbound** (Riot's TCG) cards. Think Bloomberg terminal for Riftbound, not a
dashboard. It exists so I can see what the market is doing before everyone else does and act
on it.

It serves four jobs, in roughly this order of importance:

1. **Catch the curve early.** Surface cards that are moving *right now* — a card that jumped
   ~10% from yesterday to today, unusual buying volume, a sudden spread between markets. I
   want to see the move while it's forming, understand what's driving it, and buy in before
   the crowd. This is the whole point: get me early to what people are quietly accumulating,
   whether it's reacting to an announcement or someone found the next tech for competitive play.
2. **Competitive-play intelligence.** I play the actual TCG. When a card starts getting bought
   up because of a set announcement, a tournament result, or a deck people think is secretly
   busted, I want the terminal to notice and tell me *why* it thinks the card is moving.
3. **Cross-market price search.** A card database I can query by card (or a list of cards) and
   instantly see average price and the best available price across **TCGplayer and eBay** side
   by side — for buying singles and for the expensive stuff: graded slabs, overnumbered
   cards, the Teemo promo, chase Riftbound slabs.
4. **A feed.** Aggregate the Riftbound-focused voices I follow (primarily specific Twitter/X
   accounts) into one in-terminal feed so I'm not tab-hopping to know what's being talked about.

Primary data sources are **TCGplayer and eBay**. That's where the signal is.

I'm handing you the goal, not the recipe. You decide the architecture, the stack, the data
model, how you detect a "move," how you rank movers, how the panels are laid out. Where you
see a better way than anything implied here, take it — your judgment on the *how* is the point.

## House rules (never cross these, however you build)

- **It must not read as generic-AI-generated design.** The bar is a professional trading
  terminal — dense, information-first, monospaced, keyboard-driven, dark, fast. Purple
  gradients, rounded card-grids, chatbot vibes, and centered hero sections are an automatic
  fail. When in doubt, look at a real Bloomberg/trading terminal and move toward that.
- **Never invent or display a price as if it were real.** Every number on screen is either
  genuinely fetched or unmistakably labeled as sample/demo data. A stale or estimated price is
  labeled stale/estimated. I will make money decisions off this — a fabricated price that looks
  live is the worst possible bug.
- **Data sources are pluggable adapters behind one interface.** TCGplayer, eBay, and the feed
  each sit behind a swappable adapter. Adding a source, or switching one from scrape to
  official API, must not ripple through the app. If a source is down, the rest keeps working
  and that source is shown as degraded — never a blank screen, never a crash.
- **Don't hard-code special cases.** No per-card hacks, no magic regex to make one card behave.
  Describe the behavior you want generally and let the logic handle the cases. If you're
  tempted to special-case a card or a set, that's a smell — generalize it.
- **Respect the sources.** Rate-limit, cache, identify honestly, and stay within each site's
  terms. Prefer official APIs where they exist; scrape only as a fallback, gently. Getting my
  IP or keys banned is a failure.
- **One place.** Everything lives in the one terminal. If I have to leave it to get an answer
  it's supposed to give me, that's a miss.

## The bar for "done"

Don't stop at your idea of good enough — stop when it clears these, each of which you can
check yourself against the actual running app:

- **The impostor test.** A stranger who trades cards for a living, shown the screen for ten
  seconds, believes it's a real professional trading terminal — not something an AI generated.
  If they clock it as generic, it's not done.
- **The early-signal test.** Feed the system a card whose price is made to jump ~10% overnight
  (and one with a volume spike). The mover surfaces to the top of the terminal, unmissable,
  within one refresh cycle — with a plain-language read on what's driving it. If I'd have to go
  hunting to find that move, you failed the core job.
- **The search test.** For any card I name, the terminal returns average price and the single
  best price across TCGplayer and eBay, correctly sourced and clearly attributed, in a couple
  of seconds — and it works for a list of cards at once, including slabs/promos.
- **The feed test.** The accounts I follow show up in one in-terminal feed, newest-first,
  readable without leaving the terminal.
- **The trust test.** Every price on screen can be traced to where and when it came from. No
  number is ambiguous about whether it's live, cached, estimated, or sample.
- **The resilience test.** Kill a data source mid-use; the terminal degrades gracefully, says
  so, and keeps running.

If you can't measure something I asked for, invent the measuring stick yourself and show me
what you chose — the way you'd figure out how to prove the render matches the photo.

## How to verify (the builder never grades its own work)

Whatever agent builds a piece does **not** get to declare it done. For each item on the bar,
spin up a **separate sub-agent with a fresh context window**, point it at the *real thing* —
the actual running terminal, the actual pixels, the actual API responses — and task it with
**trying to prove the bar is NOT met.** It hunts for the fabricated-looking price, the move
that didn't surface, the search that returned the wrong best-price, the design tell that gives
away "AI-generated." Only when a fresh adversarial pass genuinely can't break a criterion does
that criterion count as passed. Before anything is committed, one sub-agent's only job is to
check the work against the House Rules above and block it if anything crosses them.

## Run it as a loop

Put yourself on a loop against the bar: build, check yourself against the real app, find the
single biggest gap, close it, go again. You don't get to decide you're finished — there's
always a next gap. Keep looping until every test above survives a fresh adversarial pass, or
until you genuinely can't find anything left to improve. I'll tell you when it's done.

## Get out of your own way

- Make your own calls. Only come back to me if you're truly blocked or it's a decision only I
  can make (spending real money, anything irreversible, a genuine fork in product direction).
- **Plan first — this is a big, foundational build.** Before writing real code, give me the
  plan and ask me everything you're unsure about up front: which markets/APIs to prioritize,
  whether to start from official APIs or scraping, exactly which Twitter/X accounts feed the
  feed, my rough budget for any paid API, and where credentials will live. Get all of that
  settled in one pass. Once the plan is agreed, run without stopping.
- Credentials and keys: I'll put them where you tell me to (an `.env` / secrets file you
  specify). Tell me exactly what you need — TCGplayer API access, eBay app keys, a
  Twitter/X or Nitter path for the feed — and assume nothing is set up yet.
- If a real service costs money to hit, propose a budget and stay inside it rather than asking
  me to approve each call.

## Build on what you learn

Once you've nailed one hard piece — say the mover-detection that actually catches the curve —
treat it as the reference for the next. Reuse the pattern, point later work at it as the
quality bar to match and beat, and read back over your own earlier traces to pick up what
worked instead of re-deriving it.

## Keep me in the loop while you run

As you work, post progress to Simple Markdown Editor (simplemarkdowneditor.com) — screenshots
of the terminal as it comes together, what's passing the bar, what's still failing, and any
decisions you made. Keep that doc live so I can glance at my phone, see exactly where things
stand, and drop comments to steer you without stopping the run.

---

*Start with the plan and your questions. Then loop until it clears the bar.*
