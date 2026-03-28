/**
 * @file schemas/clob.js
 *
 * Zod schemas for the raw Polymarket CLOB (Central Limit Order Book) API
 * responses.
 *
 * Endpoints covered:
 *   GET https://clob.polymarket.com/prices-history
 *         ?market={conditionId}&startTs={unix}&endTs={unix}&fidelity={minutes}
 *
 *   GET https://clob.polymarket.com/book
 *         ?token_id={tokenId}
 *
 * These schemas describe the wire format before any downstream computation
 * (sigma normalisation, episode detection, spread sizing) is applied.
 *
 * Phase-2 integration notes
 * ──────────────────────────
 * Neither endpoint is wired into the Snapback UI yet.  These schemas define
 * the contract that the Phase-2 implementation must satisfy:
 *
 *   • /prices-history  → DislocationSeverity, BacktestEvidence, history chart
 *   • /book            → SpreadBuilder friction estimate, depth visualisation
 *
 * Usage:
 *   import { PriceHistoryResponseSchema, OrderBookResponseSchema }
 *     from "@/lib/schemas/clob";
 *
 *   const history = PriceHistoryResponseSchema.parse(rawJson);
 *   const book    = OrderBookResponseSchema.parse(rawJson);
 */

import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

/**
 * The CLOB API represents prices and sizes as decimal strings to avoid
 * floating-point serialisation drift.  This coerces them to JS numbers
 * while preserving the original string form in error messages.
 */
const decimalString = z
  .string()
  .refine((s) => !isNaN(parseFloat(s)) && isFinite(parseFloat(s)), {
    message: "Expected a decimal-string number (e.g. \"0.62\" or \"435.5\")",
  })
  .transform((s) => parseFloat(s));

/**
 * Unix timestamp in seconds.  The CLOB API uses second-precision integers.
 */
const unixSeconds = z
  .number()
  .int()
  .positive()
  .describe("Unix timestamp in seconds (second-precision).");

// ── /prices-history ───────────────────────────────────────────────────────────

/**
 * A single bar in a market's price history.
 *
 * The CLOB API returns one object per bar at the requested fidelity
 * (e.g. fidelity=1440 → daily bars, fidelity=60 → hourly bars).
 *
 * Field names observed in production responses:
 *   { t: 1712880000, p: 0.62 }
 *
 * `t` is the bar-open timestamp; `p` is the mid-market YES price at that
 * timestamp (a decimal in the range [0, 1]).
 */
export const PricePointSchema = z
  .object({
    /**
     * Bar-open Unix timestamp in seconds.
     * Convert to milliseconds before constructing a JS Date:
     *   new Date(point.t * 1000)
     */
    t: unixSeconds.describe("Bar-open timestamp (Unix seconds)."),

    /**
     * Mid-market YES-outcome price at the bar open.
     * Range: [0, 1].  Multiply by 100 to get cents / percentage points.
     */
    p: z
      .number()
      .min(0)
      .max(1)
      .describe("YES price at bar-open, decimal in [0, 1]."),
  })
  .describe("One OHLC-less price bar from /prices-history.");

/**
 * Full response from GET /prices-history.
 *
 * Query parameters:
 *   market   — conditionId from the Gamma API
 *   startTs  — window start (Unix seconds)
 *   endTs    — window end   (Unix seconds); omit for "now"
 *   fidelity — bar width in minutes (1440 = daily, 60 = hourly, 1 = per-min)
 *
 * Recommended call for Snapback severity computation:
 *   startTs = now - 30*24*3600   (30-day trailing window)
 *   fidelity = 1440               (daily bars)
 *
 * Minimum history gate: suppress any family with fewer than 20 daily bars.
 *
 * Example response:
 * {
 *   "history": [
 *     { "t": 1712880000, "p": 0.61 },
 *     { "t": 1712966400, "p": 0.63 },
 *     ...
 *   ]
 * }
 */
export const PriceHistoryResponseSchema = z
  .object({
    /**
     * Chronologically ordered array of price bars.
     * The array may be empty if the market has no trading history in the
     * requested window.
     */
    history: z
      .array(PricePointSchema)
      .describe(
        "Chronological price bars for the requested conditionId and window."
      ),
  })
  .describe(
    "GET clob.polymarket.com/prices-history response.  " +
      "Used to compute trailing standard deviation and run the PIT backtest."
  );

// ── /book (order book) ────────────────────────────────────────────────────────

/**
 * A single price level in the order book.
 *
 * Both `price` and `size` arrive as decimal strings from the CLOB API.
 * After parsing they are coerced to numbers.
 *
 * Example:
 *   { "price": "0.62", "size": "1500.00" }
 */
export const OrderBookLevelSchema = z
  .object({
    /**
     * Price of this resting order, expressed as a decimal in [0, 1].
     * Multiply by 100 for cents.
     */
    price: decimalString.describe("Resting order price, decimal in [0, 1]."),

    /**
     * Total quantity available at this price level, in shares (not USD).
     * Multiply by price to get USD notional.
     */
    size: decimalString.describe(
      "Shares available at this price level (not USD notional)."
    ),
  })
  .describe("One level in the CLOB order book.");

/**
 * Full response from GET /book.
 *
 * Query parameter:
 *   token_id — the YES-token ID from clobTokenIds[0] on the Gamma market.
 *              The NO token's book is the mirror image (bids ↔ asks,
 *              prices inverted: 1 − p).
 *
 * Snapback uses this endpoint exclusively on demand — only when the user
 * opens the Spread Builder for a specific family.  Never prefetch for all
 * families simultaneously.
 *
 * Usage in Spread Builder:
 *   • Top-of-book spread  = best ask − best bid
 *     → Used as the friction proxy for P&L calculations.
 *   • Available size at best ask / best bid
 *     → Used to verify a given share count is fillable without large slippage.
 *   • Depth-weighted average price (DWAP) for target share count
 *     → Realistic fill estimate vs. mid-market price.
 *
 * Example response:
 * {
 *   "bids": [
 *     { "price": "0.61", "size": "1200.00" },
 *     { "price": "0.60", "size": "3400.00" }
 *   ],
 *   "asks": [
 *     { "price": "0.63", "size":  "800.00" },
 *     { "price": "0.64", "size": "2100.00" }
 *   ]
 * }
 */
export const OrderBookResponseSchema = z
  .object({
    /**
     * Resting buy orders, sorted descending by price (best bid first).
     * An empty array means no buyers at any price — do not trade this leg.
     */
    bids: z
      .array(OrderBookLevelSchema)
      .describe("Resting bids, best (highest) price first."),

    /**
     * Resting sell orders, sorted ascending by price (best ask first).
     * An empty array means no sellers at any price — do not trade this leg.
     */
    asks: z
      .array(OrderBookLevelSchema)
      .describe("Resting asks, best (lowest) price first."),
  })
  .describe(
    "GET clob.polymarket.com/book response for a single YES token.  " +
      "Fetch on demand only — never prefetch for all families."
  );

// ── Derived / computed shapes from CLOB data ──────────────────────────────────
//
// These are not wire formats — they are the results of processing raw CLOB
// responses in the backend / lib layer.  They live here (rather than in
// family.js or spread.js) because they are direct derivatives of CLOB inputs.

/**
 * Summary statistics computed from a single market's /prices-history response.
 *
 * Produced once per market per refresh cycle and cached for up to 1 hour.
 * The `trailingStd` field is the denominator in the sigma severity formula:
 *
 *   severity_σ = |rawDislocation| / trailingStd
 *
 * Minimum-bar gate: when barCount < 20, set hasMinimumBars = false and
 * suppress sigma computation (show "Watchlist – insufficient history" instead).
 */
export const PriceHistorySummarySchema = z
  .object({
    /** The market's conditionId this summary was computed for. */
    conditionId: z.string(),

    /** Number of daily bars available in the 30-day trailing window. */
    barCount: z
      .number()
      .int()
      .min(0)
      .describe("Daily bars available in the 30-day trailing window."),

    /**
     * Whether there are enough bars to compute a reliable sigma.
     * False when barCount < 20 — the no-trade gate applies.
     */
    hasMinimumBars: z
      .boolean()
      .describe("True only when barCount >= 20 (minimum history gate)."),

    /**
     * Population standard deviation of the YES price over the trailing window.
     * Used as the denominator in sigma severity calculations.
     * Null when hasMinimumBars is false.
     */
    trailingStd: z
      .number()
      .min(0)
      .nullable()
      .describe(
        "Trailing 30-day population std dev of YES price.  " +
          "Null when fewer than 20 bars exist."
      ),

    /**
     * Unix timestamp (ms) when this summary was computed.
     * Summaries older than 3600 seconds should be re-fetched.
     */
    computedAt: z
      .number()
      .describe("Computation timestamp, milliseconds since epoch."),
  })
  .describe(
    "Statistics derived from /prices-history for one market.  " +
      "Used as input to sigma-severity calculation (Phase 2)."
  );

/**
 * Derived order-book snapshot for one YES token, enriched with Snapback-
 * specific metrics computed from the raw bids/asks arrays.
 *
 * Produced from OrderBookResponseSchema after fetch, stored transiently
 * (never cached — always fetched on demand per Spread Builder open).
 */
export const OrderBookSnapshotSchema = z
  .object({
    /** The market's conditionId. */
    conditionId: z.string(),

    /** The YES token ID used in the /book query. */
    tokenId: z.string(),

    // ── Raw levels ────────────────────────────────────────────────────────

    /** Resting bids (best price first), coerced to numbers. */
    bids: z.array(OrderBookLevelSchema),

    /** Resting asks (best price first), coerced to numbers. */
    asks: z.array(OrderBookLevelSchema),

    // ── Derived top-of-book metrics ───────────────────────────────────────

    /**
     * Best bid price (highest resting buy), decimal in [0, 1].
     * Null if the book has no bids.
     */
    bestBid: z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .describe("Highest resting bid price.  Null if no bids."),

    /**
     * Best ask price (lowest resting sell), decimal in [0, 1].
     * Null if the book has no asks.
     */
    bestAsk: z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .describe("Lowest resting ask price.  Null if no asks."),

    /**
     * Mid-market price = (bestBid + bestAsk) / 2.
     * Null if either side of the book is empty.
     */
    midPrice: z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .describe("Mid-market price, decimal in [0, 1].  Null if book is one-sided."),

    /**
     * Top-of-book spread = bestAsk − bestBid.
     * This is the primary friction proxy used in the Spread Builder P&L model.
     * Expressed as a decimal (e.g. 0.02 = 2pp spread).
     * Null if either side of the book is empty.
     */
    topOfBookSpread: z
      .number()
      .min(0)
      .nullable()
      .describe(
        "bestAsk − bestBid.  Primary friction proxy for P&L calculations.  " +
          "Null when book is one-sided."
      ),

    /**
     * Total USD notional available on the bid side within 5pp of best bid.
     * Used to gauge whether the target position is fillable without moving
     * the market.
     */
    bidDepthUsd: z
      .number()
      .min(0)
      .describe("USD notional within 5pp of best bid."),

    /**
     * Total USD notional available on the ask side within 5pp of best ask.
     */
    askDepthUsd: z
      .number()
      .min(0)
      .describe("USD notional within 5pp of best ask."),

    /**
     * Unix timestamp in milliseconds when this snapshot was fetched.
     * Order book snapshots are never cached and should be re-fetched each
     * time the Spread Builder is opened.
     */
    fetchedAt: z
      .number()
      .describe("Fetch timestamp, milliseconds since epoch."),
  })
  .describe(
    "Enriched order-book snapshot for one YES token, derived from " +
      "/book and used by the Spread Builder for friction estimation."
  );

// ── Convenience typedefs (JSDoc) ──────────────────────────────────────────────

/**
 * @typedef {z.infer<typeof PricePointSchema>} PricePoint
 * A single price bar from /prices-history.
 */

/**
 * @typedef {z.infer<typeof PriceHistoryResponseSchema>} PriceHistoryResponse
 * Full GET /prices-history response.
 */

/**
 * @typedef {z.infer<typeof OrderBookLevelSchema>} OrderBookLevel
 * One price level in the CLOB order book.
 */

/**
 * @typedef {z.infer<typeof OrderBookResponseSchema>} OrderBookResponse
 * Full GET /book response for a single YES token.
 */

/**
 * @typedef {z.infer<typeof PriceHistorySummarySchema>} PriceHistorySummary
 * Computed statistics from one market's price history.
 */

/**
 * @typedef {z.infer<typeof OrderBookSnapshotSchema>} OrderBookSnapshot
 * Enriched order-book snapshot with derived friction metrics.
 */
