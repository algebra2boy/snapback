# Snapback — Plain English Explainer

This doc explains what the app does and how it works, without assuming any trading or technical background.

---

## The One-Line Idea

Polymarket lets people bet on real-world outcomes. Sometimes, related bets have prices that are logically inconsistent with each other — and when that happens, there's a free money opportunity. Snapback finds those inconsistencies automatically.

---

## Why Inconsistencies Exist

Imagine betting on whether Bitcoin will be above $100k at the end of the year. There's also a separate bet on whether Bitcoin will be above $90k.

These two bets are related by logic: **if Bitcoin is above $100k, it must also be above $90k**. So the "$90k" bet should always be worth at least as much as the "$100k" bet — it's an easier bar to clear.

But on Polymarket, different people trade these bets independently. Sometimes one side gets out of whack with the other, and the "$100k" bet ends up priced *higher* than the "$90k" bet. That's mathematically impossible if markets were perfectly efficient.

That gap is what Snapback hunts for. It's not a prediction or an opinion — it's a mathematical violation.

---

## The Four Types of Inconsistencies

### 1. Strike Ladder
Related bets with different thresholds. The easier threshold must always be worth more.

> **Example:** "BTC above $80k" must be priced higher than "BTC above $90k", which must be higher than "BTC above $100k". If that order breaks, there's a dislocation.

### 2. Expiry Curve
Related bets with different deadlines. The longer deadline must always be worth more (more time = more chances for something to happen).

> **Example:** "Fed holds rates by May" must be cheaper than "Fed holds rates by July". July gives the Fed two extra months to act, so it's more likely. If May ends up priced higher than July, that's a violation.

### 3. Mutually Exclusive Set
Bets on different outcomes of the same event. The probabilities must add up to roughly 100%.

> **Example:** In a 3-candidate race, if "Candidate A wins" + "Candidate B wins" + "Candidate C wins" = 115%, that 15% is free money being left on the table. Someone is overpaying for at least one candidate.

### 4. Nested Events
A specific outcome can't be more likely than its parent outcome.

> **Example:** "Lakers win the NBA Finals" can't be more likely than "Lakers make the NBA Finals." You have to make it before you can win it. If the first is priced higher, that's wrong.

---

## How Snapback Measures How Bad a Violation Is

Not all violations are worth acting on. A tiny gap might just be noise. Snapback measures severity in **sigma (σ)** — basically, how unusual the gap is compared to its own history.

- If this pair has historically drifted by about 2¢, and today the gap is 10¢, that's unusual — high sigma.
- If the gap is always 10¢, then 10¢ today isn't notable — low sigma.

**Sigma thresholds:**
- **≥ 2σ** — Actionable (worth trading)
- **1.5–2σ** — Watchlist (keep an eye on it)
- **< 1.5σ** — Normal (ignore)

---

## What the Three Screens Do

### Screen 1: The Scanner
Shows all market families ranked by how severe the violation is. Think of it like a leaderboard of opportunities, sorted from most broken to least.

### Screen 2: The Visualizer
When you click on a family, this screen draws a chart showing what the prices *should* look like (a smooth curve) vs. what they *actually* look like. A violation shows up as a point that's higher than it should be — visually obvious in seconds.

### Screen 3: The Spread Builder
Once you can see the violation, this screen tells you exactly what to trade. Because the constraint is a logic rule, the trade direction is automatic:

- If the "$100k" bet is too expensive relative to "$90k" → buy the cheap side, sell the expensive side
- No judgment call needed. The math tells you which side is wrong.

It also shows:
- How much to trade on each side (sized so both sides risk the same dollar amount)
- Historical evidence of whether this type of gap has closed before
- P&L estimates under different fee scenarios

---

## Why Snapback Sometimes Refuses to Recommend a Trade

The app has a "no-trade" mode. It will refuse to show a spread recommendation if:

- There's not enough history to know if this gap usually closes (fewer than 5 past examples)
- Past examples of this gap mostly lost money
- The gap disappears once fees are factored in
- The gap is too small to be statistically meaningful (< 1.5σ)

When this happens, the app says: *"Structural anomaly detected. Insufficient evidence for spread. Watchlist only."*

This is intentional. Most tools always tell you to trade. Snapback explicitly tells you when *not* to.

---

## Why This Helps You Make Better Predictions

Most people on Polymarket treat each bet in isolation — they research the question, form an opinion, and place a trade. Snapback adds a different layer: it helps you reason about your own beliefs more consistently, and catch when the market itself is being inconsistent.

### It Forces You to Think Relationally

If you believe BTC has a 60% chance of being above $90k by year-end, then you are also implicitly saying it has *less than* 60% chance of being above $100k. Snapback makes that relationship explicit. When you look at the strike ladder visualizer, you can immediately see if your beliefs are internally consistent across all the related bets — or if you've accidentally been thinking about them in isolation.

This is how options traders think. They don't just pick a strike and bet — they look at the whole surface and ask: *does this shape make sense?*

### It Surfaces Information Hidden in Price Relationships

A single market price tells you one thing: what the crowd thinks about one outcome. But the *relationship* between prices tells you something deeper — where the crowd's attention is focused and where it isn't.

When a violation appears, it usually means one of two things:
1. One market in the family got new information first (e.g. a news event moved the $100k bet but traders haven't caught up on the $90k bet yet)
2. One market is thinly traded and its price has drifted on low volume

Either way, the violation is a signal pointing you toward which market is mispriced — and by extension, which one is the better bet right now.

### It Removes Narrative Bias from Your Trades

The biggest mistake prediction market traders make is trading on vibes. You feel strongly that the Fed will hold rates, so you buy every Fed-related market. But some of those markets might already have that view fully priced in, while others are lagging.

Snapback doesn't care about the narrative. It only cares about the math. If the expiry curve is inverted, the near-term contract is overpriced *relative to* the far-term contract regardless of what you think the Fed will do. That gives you a trade that profits from the structural gap closing — not from being right about the Fed.

This is a fundamentally different kind of edge: **you don't need to be right about the outcome, you just need to be right that the prices will re-align.**

### It Keeps You Honest About Uncertainty

When Snapback is in watchlist mode (1.5–2σ), it's telling you: *this looks slightly off, but it's within normal noise range*. That's useful calibration. It stops you from convincing yourself there's an opportunity when the gap might just be random variation.

When it refuses to recommend a trade entirely (no-trade gate), it's telling you: *this pattern hasn't been reliable enough historically to bet on*. That's discipline most tools don't enforce.

### It Helps You Time Entries Better

Because Snapback shows the 30-day history of the dislocation — not just today's snapshot — you can see whether a gap is widening (getting worse, potentially more opportunity) or narrowing (already correcting, may be too late). A gap that's been widening for 3 days is a different situation from one that peaked yesterday and is already closing.

### It Separates Two Questions That Most Traders Conflate

| Question | What most traders do | What Snapback helps with |
|---|---|---|
| "What will happen?" | Form an opinion, place a bet | Not directly — that's still on you |
| "Which bet is mispriced right now?" | Ignored entirely | This is exactly what Snapback solves |

You still need your own views on what will happen. But Snapback tells you *which contract* best expresses that view at the current prices — and which ones are overpriced relative to their logical siblings.

---

## The APIs (In Plain English)

Snapback talks to Polymarket's servers to get data. It uses four specific data feeds:

### Gamma API — the "what's available" feed

**`/events`**
This gives back a list of all active events on Polymarket, with all the markets grouped under each event. Snapback uses this to discover families automatically — if an event has multiple markets with numeric thresholds in their titles, that's a strike ladder. If they have dates in their titles, that's an expiry curve. Etc.

**`/markets`**
This gives the current prices for every market — what people are willing to pay right now. Snapback uses this to measure the current size of any violation.

---

### CLOB API — the "deep data" feed

CLOB stands for "Central Limit Order Book" — it's the actual trading engine that matches buyers and sellers.

**`/prices-history`**
This gives the price of a market over the past 30 days, day by day. Snapback uses this to:
- Compute how unusual the current gap is (the sigma calculation)
- Run a historical backtest: "how many times has a gap like this appeared before, and did it close?"

**`/book`**
This gives the live order book — every buy and sell order sitting in the queue right now, and at what price. Snapback uses this to estimate how much it would cost in fees and slippage to actually execute a trade (so the P&L estimate is realistic, not theoretical).

---

## API Optimization — Why It Matters

Polymarket's API has rate limits (you can only ask for data so many times per minute). And some calls are slow. So Snapback is designed to be efficient:

| Strategy | What it means in plain English |
|---|---|
| Bulk-fetch via `/events` | Get family groupings AND prices in one call instead of two |
| Aggressive caching | Don't re-fetch data that hasn't changed. Market IDs never change. Prices change every 30s. History only needs refreshing once an hour. |
| Stagger history calls | Don't ask for 50 markets' history all at once — ask in small groups so the server isn't overwhelmed |
| Lazy-load order book | Only fetch the live order book when the user actually opens the Spread Builder, not upfront |
| Pre-filter illiquid markets | Don't bother fetching history for markets nobody trades — filter them out early using just the basic market data |
| Fallback seed data | If the API goes down, show pre-cached data for 3 known families so the app keeps working |
| Freshness badge | A colored dot tells you if you're seeing live data (green), slightly stale data (amber), or offline fallback data (red) |

---

## Glossary

| Term | Plain English meaning |
|---|---|
| Dislocation | A price that's in the wrong place relative to a logically related price |
| Strike | A threshold value in a bet (e.g. "$90k" is the strike in "BTC above $90k") |
| Spread | A two-sided trade — you buy one thing and sell/short a related thing at the same time |
| Sigma (σ) | A measure of how unusual something is. 1σ = mildly unusual. 2σ = pretty rare. 3σ = very rare. |
| PIT (Point-in-Time) | The backtest only uses information that was available at the time — no cheating by using future data |
| LOO (Leave-One-Out) | A validation method: test the strategy on all episodes except one, to make sure results aren't just luck |
| Friction | The cost of trading — fees, bid/ask spread, slippage. The "tax" on every trade. |
| Severity | How big the violation is, measured in sigma relative to that pair's own history |
| Family | A group of related markets that share a logical constraint |
| CLOB | The actual order book engine that matches buyers and sellers on Polymarket |
| Gamma API | Polymarket's metadata API — market info, prices, event groupings |
| No-trade gate | A rule that suppresses the spread recommendation when evidence is too weak |
| EV (Expected Value) | The average amount you'd expect to make per dollar risked, if you ran this trade many times |
