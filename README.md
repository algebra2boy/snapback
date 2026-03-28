# Snapback — Polymarket Relative Value Terminal

A relative-value terminal for prediction markets. Scans structurally linked market families for dislocations that violate logical constraints, visualizes the opportunity, and builds the spread.

> **Thesis:** We turned Polymarket into something traders can reason about like an options desk. Same underlying, different strikes, different expiries — and we show you when the surface is broken.

---

## What It Does

Snapback detects *structural dislocations* — cases where Polymarket prices violate constraints that are true **by definition**, not by estimation. No heuristic weights. No macro correlations. The constraint IS the market structure.

| Family type | Constraint | Example |
|---|---|---|
| Strike ladder | Monotonic: P(above $100k) ≤ P(above $90k) ≤ P(above $80k) | BTC price threshold markets |
| Expiry curve | Term structure: near-expiry ≤ far-expiry | "Fed holds by May" / "by June" / "by July" |
| Mutually exclusive set | Sum to ~100%: P(A) + P(B) + P(C) ≈ 1.00 | "Who wins?" outcome markets |
| Nested events | Implication: P(specific) ≤ P(general) | "Lakers win finals" ≤ "Lakers make finals" |

When a constraint is violated, the direction of the corrective trade is **logically forced** — no judgment call, no convergence mode analysis needed.

---

## Tech Stack

- **React 18** + **Vite** — UI and build
- **Tailwind CSS v4** + **shadcn/ui** — component library
- **Chart.js** — probability curve and P&L visualizations

---

## Polymarket APIs

The application requires **four confirmed endpoints** across two Polymarket API surfaces: the **Gamma API** (market metadata) and the **CLOB API** (order book and price history).

### 1. Gamma API — `gamma-api.polymarket.com`

The Gamma API is the primary source for market discovery and current pricing.

#### `GET /markets`

**Purpose:** Fetch all active markets with current prices, volume, and bid/ask spread.

**Used for:** Building the strike ladder, computing current dislocation magnitude, populating the scanner table.

```
GET https://gamma-api.polymarket.com/markets
```

Key response fields:
- `conditionId` — unique market identifier (links to CLOB)
- `outcomePrices` — current YES/NO prices (mid-market)
- `volume` — total traded volume (use to filter illiquid markets)
- `spread` — current bid/ask spread (use as friction proxy)
- `active`, `closed` — filter to active only
- `slug` — URL path for execution links (`polymarket.com/event/[slug]`)

#### `GET /events`

**Purpose:** Fetch event groupings. This is what surfaces market families automatically.

**Used for:** Grouping markets by event so strike ladders, expiry curves, and mutex sets can be detected without hardcoding.

```
GET https://gamma-api.polymarket.com/events
```

Key response fields:
- `id` — event identifier
- `title` — event title (parse this to classify family type)
- `markets[]` — array of market objects belonging to this event

**Family classification logic from event titles:**
- Numeric thresholds in same event → **strike ladder** (e.g. `>$80k`, `>$90k`, `>$100k`)
- Date-varying markets for same outcome → **expiry curve** (e.g. `by May`, `by June`, `by July`)
- Multiple named outcomes under one question → **mutually exclusive**
- Specific/general pairs → **nested**

---

### 2. CLOB API — `clob.polymarket.com`

The CLOB (Central Limit Order Book) API provides real-time order book depth and historical price data.

#### `GET /prices-history`

**Purpose:** Fetch historical price data for a market.

**Used for:** Computing the 30-day trailing standard deviation of the structural spread (dislocation severity denominator), running the PIT backtest, and rendering the 30-day dislocation history chart.

```
GET https://clob.polymarket.com/prices-history?market={conditionId}&startTs={unix}&endTs={unix}&fidelity={minutes}
```

Parameters:
- `market` — the `conditionId` from Gamma API
- `startTs` / `endTs` — Unix timestamps (use 30d window for severity, full history for backtest)
- `fidelity` — resolution in minutes (`1440` = daily bars, `60` = hourly)

**Minimum history gate:** Suppress any family with fewer than 20 prior daily bars. This prevents severity scores from being computed on noise.

#### `GET /book`

**Purpose:** Fetch the current order book (bid/ask ladder) for a market.

**Used for:** Market depth analysis in the Spread Builder — spread %, available depth at each level, and slippage estimates for sizing.

```
GET https://clob.polymarket.com/book?token_id={tokenId}
```

Parameters:
- `token_id` — the YES token ID for the market (derived from Gamma market data)

Key response fields:
- `bids[]` / `asks[]` — price and size at each level
- Use top-of-book spread as the friction proxy for P&L calculations

---

## Data Flow

```
Gamma /events
    └─► Group markets into families
            └─► Classify family type (strike / expiry / mutex / nested)

Gamma /markets
    └─► Current prices for each market in family
            └─► Compute raw dislocation per constraint type

CLOB /prices-history (30d, daily)
    └─► Historical structural spread
            └─► Severity = |dislocation| / std(spread, trailing 30d, PIT)
            └─► Episode detection (trigger: >2σ, close: <0.5σ within 7d)
            └─► PIT backtest with LOO validation

CLOB /book
    └─► Real-time bid/ask depth
            └─► Spread Builder: sizing, slippage, friction scenarios
```

---

## Core Math

### Dislocation Detection

```
# Strike ladder
dislocation = price(M_higher_strike) - price(M_lower_strike)   # positive = violation

# Expiry curve
dislocation = price(M_near) - price(M_far)                     # positive = violation

# Mutually exclusive
overpricing  = Σ price(M_i) - 1.00                             # positive = violation

# Nested events
dislocation  = price(specific) - price(general)                # positive = violation
```

### Dislocation Severity

```
severity = |dislocation| / historical_std_of_dislocation(trailing 30d, PIT)
```

Severity bands:
- **≥ 2σ** → Actionable
- **1.5–2σ** → Watchlist
- **< 1.5σ** → Normal

### Sizing — Equal Dollar-at-Risk

```
shares_i = target_risk_per_leg / token_price_i
```

Binary tokens have no continuous vol — equal dollar-at-risk is the simplest defensible baseline.

### Expected Value

```
EV_leg   = shares × (my_prob_wins - token_price)
EV_pair  = Σ EV_leg - friction
EV_per_$ = EV_pair / total_max_loss
```

### Token Economics

```
cost      = token_price × shares
max_loss  = cost
max_gain  = (1 - token_price) × shares
NO price  = 1 - YES price
```

---

## Auto-Generated Spread Direction

The corrective spread direction is structurally implied — no heuristic needed:

| Dislocation type | Spread |
|---|---|
| Strike violation: P($100k) > P($90k) | Buy NO on $100k, Buy YES on $90k |
| Expiry inversion: P(May) > P(July) | Buy NO on May, Buy YES on July |
| Mutex overpricing: sum > 1.00 | Buy NO on the most overpriced outcome |
| Nested violation: P(child) > P(parent) | Buy NO on child, Buy YES on parent |

---

## No-Trade Gates

Suppress any spread recommendation if ANY condition is true:

1. Evidence confidence < Moderate (fewer than 5 episodes)
2. Median backtest P&L < 0 under base friction
3. 25th percentile P&L < -25% of risk under base friction
4. Severity < 1.5σ (normal range)
5. Signal collapses under harsh friction (1.5× spread proxy)
6. Insufficient history (< 20 trailing daily bars)

Output when suppressed: `"Structural anomaly detected. Insufficient evidence for spread. Watchlist only."`

---

## API Optimization

### Request Strategy

**Problem:** The scanner needs current prices for all active markets across all families on every refresh. Naively calling `/markets` per market is too slow and will get rate-limited.

**Solutions:**

#### 1. Bulk-fetch from `/events`, not `/markets`

The `/events` endpoint returns markets nested inside each event. One call surfaces both the family groupings AND the market data needed to classify them — avoiding a separate `/markets` call for discovery.

```js
// One call surfaces families + prices
const events = await fetch('https://gamma-api.polymarket.com/events?active=true&limit=100')

// Filter to events with 2+ markets (potential families)
const candidates = events.filter(e => e.markets.length >= 2)
```

#### 2. Cache market metadata aggressively, poll prices lightly

Market metadata (slug, conditionId, token IDs) is stable. Only `outcomePrices` and `spread` change frequently.

```
Cache policy:
  - conditionId, slug, tokenId     → cache indefinitely (never changes)
  - outcomePrices, spread, volume  → poll every 30s
  - /prices-history (30d daily)    → cache 1 hour, refresh on page load
  - /book depth                    → fetch on demand (only when Spread Builder opens)
```

#### 3. Stagger CLOB history fetches

When the scanner loads, you have N families × M markets each needing 30d history. Fetch sequentially or in small batches (3–5 concurrent) to avoid overwhelming the CLOB API.

```js
// Batch history fetches — don't fire all at once
const results = []
for (const chunk of chunkArray(conditionIds, 4)) {
  const batch = await Promise.all(chunk.map(id => fetchHistory(id)))
  results.push(...batch)
}
```

#### 4. Pre-compute severity on the server / in a worker

Severity computation (std dev over 30d history) is CPU-bound but runs on static data. Move it to a Web Worker or pre-compute at fetch time so the UI never blocks:

```js
// In a Web Worker
const severity = computeSeverity(pricesHistory, currentDislocation)
postMessage({ familyId, severity })
```

#### 5. Fallback to cached snapshots on API failure

Per the design spec: the app must **never break**. Keep hardcoded seed data for the 3 pre-verified families (BTC strikes, Fed expiry, political mutex) as a fallback. Display a green/amber/red badge indicating data freshness.

```
green  = live data (< 60s old)
amber  = cached (60s–5min old)
red    = fallback seed data
```

#### 6. Only fetch `/book` depth on demand

Order book depth is only needed when the user opens the Spread Builder for a specific family. Don't prefetch it for all families — fetch it lazily when Screen 3 opens.

#### 7. Filter before fetching history

Before paying the cost of a `/prices-history` call, pre-filter families using only Gamma data:

- Skip any market with `volume < $500` (illiquid, no spread possible)
- Skip families with only 1 active market (can't form a spread)
- Skip already-resolved markets (`closed: true`)

This can cut CLOB API calls by 60–80% in practice.

---

## Endpoint Summary

| Endpoint | Purpose | Confirmed | Cache TTL |
|---|---|---|---|
| `GET gamma-api.polymarket.com/markets` | Prices, volume, spread | Yes | 30s |
| `GET gamma-api.polymarket.com/events` | Family grouping | Yes | 5min |
| `GET clob.polymarket.com/prices-history` | History, severity, backtest | Yes | 1hr |
| `GET clob.polymarket.com/book` | Bid/ask depth for sizing | Yes | On demand |

---

## Current Status

The UI is fully implemented as a prototype with hardcoded seed data. The next build phase is wiring in live data:

| Feature | Status |
|---|---|
| Dislocation Scanner UI | Complete |
| Strike Ladder Visualizer | Complete |
| Spread Builder + P&L model | Complete |
| Gamma `/events` integration | Not implemented |
| CLOB `/prices-history` integration | Not implemented |
| CLOB `/book` depth integration | Not implemented |
| WebSocket live updates | Not implemented |

---

## Disclaimer

Informational and educational only. Not financial advice. Structural constraints are definitional but market microstructure (fees, slippage, timing) affects realized P&L. Backtest uses point-in-time triggers and leave-one-out validation with a conservative friction proxy. Small samples. Past ≠ future. Tool suppresses recommendations when evidence is insufficient.
