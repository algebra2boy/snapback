/**
 * @file schemas/market.js
 *
 * Zod schemas for enriched market objects and computed dislocation shapes.
 *
 * These schemas sit one layer above the raw Gamma API shapes defined in
 * gamma.js.  They describe the data structures that exist after the lib
 * layer (gammaApi.js) has parsed, filtered, and enriched raw API responses.
 *
 * Dependency chain:
 *   GammaMarketSchema (gamma.js)
 *     → MarketWithPriceSchema          (raw market + computed yesPrice)
 *     → DislocationSchema              (constraint violation math)
 *     → DislocationSeveritySchema      (sigma normalisation — Phase 2)
 *     → NoArbEnvelopeResultSchema      (chart envelope computation)
 *
 * Usage:
 *   import {
 *     MarketWithPriceSchema,
 *     DislocationSchema,
 *     FamilyTypeSchema,
 *     StatusSchema,
 *   } from "@/lib/schemas/market";
 */

import { z } from "zod";
import { GammaMarketSchema } from "./gamma";

// ── Enumerations ──────────────────────────────────────────────────────────────

/**
 * The four structural family types Snapback can detect.
 *
 * Classification is heuristic — driven by question-text pattern matching —
 * until a more authoritative signal is available from the Gamma taxonomy.
 *
 * | Type          | Constraint                                      |
 * |---------------|-------------------------------------------------|
 * | Strike ladder | P(higher strike) ≤ P(lower strike) — monotonic  |
 * | Expiry curve  | P(near date) ≤ P(far date) — term structure     |
 * | Mutex set     | Σ P(outcomes) ≈ 1.00                            |
 * | Nested        | P(specific) ≤ P(general) — implication          |
 */
export const FamilyTypeSchema = z
  .enum(["Strike ladder", "Expiry curve", "Mutex set", "Nested"])
  .describe(
    "Structural relationship type of the market family.  " +
      "Determines which constraint formula is applied in dislocation math."
  );

/**
 * Signal status derived from dislocation magnitude.
 *
 * Current thresholds (raw pp, pre-Phase-2):
 *   Actionable : rawDislocation >= 0.04  (4 percentage points)
 *   Watchlist  : rawDislocation >= 0.02  (2 percentage points)
 *   Normal     : rawDislocation <  0.02
 *
 * Phase-2 thresholds (sigma-normalised):
 *   Actionable : sigma >= 2.0
 *   Watchlist  : sigma >= 1.5
 *   Normal     : sigma <  1.5
 */
export const StatusSchema = z
  .enum(["Actionable", "Watchlist", "Normal"])
  .describe(
    "Signal status for a family.  " +
      "Thresholds are raw pp until CLOB history enables sigma normalisation."
  );

// ── MarketWithPriceSchema ─────────────────────────────────────────────────────

/**
 * A Gamma market enriched with a computed `yesPrice` field.
 *
 * `yesPrice` is derived from `outcomePrices[0]` by parseYesPrice() in
 * gammaApi.js and is the canonical price representation used throughout
 * the app:
 *   • Chart axis values  — yesPrice * 100 (convert to percent)
 *   • Dislocation math   — compare yesPrice values across markets
 *   • Spread builder     — token price for leg sizing
 *
 * Markets with yesPrice ≤ 0.01 or ≥ 0.99 are treated as effectively
 * resolved and excluded from family classification.
 */
export const MarketWithPriceSchema = GammaMarketSchema.extend({
  /**
   * Computed YES-outcome probability, a decimal in (0, 1).
   *
   * Derived from outcomePrices[0].  Guaranteed to be a finite number
   * in the range [0, 1] — invalid or missing source values produce 0.
   */
  yesPrice: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Computed YES price, decimal in [0, 1].  " +
        "Sourced from outcomePrices[0].  Multiply by 100 for percentage points."
    ),
}).describe(
  "Raw Gamma market enriched with a computed yesPrice.  " +
    "The canonical market representation used for all dislocation math, " +
    "chart rendering, and spread sizing."
);

// ── DislocationSchema ─────────────────────────────────────────────────────────

/**
 * A pair of markets that maximally violate the family's structural constraint.
 *
 * For strike ladders and expiry curves the pair is always [low, high] where
 * the constraint direction determines which is "wrong":
 *   • Strike ladder : high.yesPrice > low.yesPrice  ← violation
 *   • Expiry curve  : low.yesPrice  > high.yesPrice ← violation
 *
 * For mutex sets there is no single violating pair — the overpricing is
 * distributed across all legs — so violatingPair is null.
 */
export const ViolatingPairSchema = z
  .tuple([MarketWithPriceSchema, MarketWithPriceSchema])
  .describe(
    "The pair of markets [low, high] that produces the maximum constraint " +
      "violation.  low = lower strike / nearer expiry / smaller value.  " +
      "Null for mutex sets where overpricing is distributed."
  );

/**
 * The result of running computeDislocation() on a market family.
 *
 * Produced once per family per data refresh and attached to ScannerRow
 * as the `dislocation` field.  All downstream display and chart logic
 * reads from this object rather than re-computing from raw markets.
 *
 * Family-specific fields
 * ──────────────────────
 * Strike ladder / expiry curve:
 *   sorted          — markets in constraint order (strike ASC / date ASC)
 *   labels          — x-axis labels matching sorted (e.g. ["$80k","$90k","$100k"])
 *   violatingPair   — the [low, high] pair with the largest violation
 *   rawDislocation  — max single-pair violation in percentage-point decimals
 *
 * Mutex set:
 *   sorted          — markets in descending-price order
 *   labels          — first 22 chars of each market question
 *   sum             — total of all yes prices (> 1.0 = overpricing)
 *   rawDislocation  — max(0, sum − 1.0)
 *   violatingPair   — null (no single pair responsible)
 *
 * Nested:
 *   sorted          — [specific, general] markets
 *   labels          — short question labels
 *   violatingPair   — [general, specific] when specific > general
 *   rawDislocation  — specific.yesPrice − general.yesPrice
 */
export const DislocationSchema = z
  .object({
    // ── Core metric ───────────────────────────────────────────────────────

    /**
     * Magnitude of the largest constraint violation, expressed as a decimal
     * in [0, 1].  Multiply by 100 to get percentage points.
     *
     * Interpretation by family type:
     *   Strike ladder : max(price[i+1] − price[i]) for all adjacent pairs
     *   Expiry curve  : max(price[i] − price[i+1]) for all adjacent pairs
     *   Mutex set     : max(0, Σ prices − 1.0)
     *   Nested        : max(0, specific.price − general.price)
     *
     * 0 means no violation was found; the family is internally consistent.
     */
    rawDislocation: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Maximum constraint violation as a decimal.  " +
          "0 = no violation.  Multiply by 100 for percentage points."
      ),

    // ── Sorted markets + chart labels ─────────────────────────────────────

    /**
     * Markets sorted in constraint order — the order that should produce a
     * monotonically non-increasing (strike) or non-decreasing (expiry) curve.
     *
     * For strike ladders : ascending strike value
     * For expiry curves  : ascending month index
     * For mutex sets     : descending yes price
     * For nested         : [specific, general]
     */
    sorted: z
      .array(MarketWithPriceSchema)
      .min(2)
      .describe("Markets in constraint order, used as chart data source."),

    /**
     * Human-readable x-axis labels matching the sorted array position-for-
     * position.
     *
     * Strike ladder : ["$80k", "$90k", "$100k"]
     * Expiry curve  : ["May", "Jun", "Jul"]
     * Mutex set     : ["Candidate A (22ch…", ...]
     * Nested        : ["Lakers win Finals", "Lakers make Finals"]
     */
    labels: z
      .array(z.string())
      .describe("Chart x-axis labels, one per entry in sorted[]."),

    // ── Violation detail ──────────────────────────────────────────────────

    /**
     * The specific pair of markets responsible for the maximum violation.
     * Null for mutex sets (overpricing is aggregate, not pair-wise).
     *
     * [0] = the market that should be MORE expensive (lower strike / far date)
     * [1] = the market that should be LESS expensive (higher strike / near date)
     *
     * When this pair is non-null, the Spread Builder direction is forced:
     *   Buy YES on [0], Buy NO on [1]
     */
    violatingPair: ViolatingPairSchema.nullable().describe(
      "The [low, high] market pair with the maximum violation.  " +
        "Null for mutex sets.  Drives auto-generated spread direction."
    ),

    // ── Human-readable constraint description ─────────────────────────────

    /**
     * One-line description of the violated constraint shown in the hero panel.
     *
     * Examples:
     *   Strike ladder : "P($100k) ≤ … ≤ P($80k)"
     *   Expiry curve  : "P(by May) ≤ P(by Jul)"
     *   Mutex set     : "Σ outcomes ≈ 1.00 (current: 1.14)"
     *   Nested        : "P(Lakers win Finals) ≤ P(Lakers make Finals)"
     */
    constraintDesc: z
      .string()
      .describe(
        "Human-readable constraint description for the hero panel subtitle."
      ),

    // ── Mutex-specific ────────────────────────────────────────────────────

    /**
     * Sum of all yes prices across the mutex set.
     * Only meaningful for Mutex set families — undefined otherwise.
     *
     * When sum > 1.0, the overpricing is sum − 1.0 (= rawDislocation).
     * When sum < 1.0, the underpricing is 1.0 − sum (display as a warning,
     * not a violation — there is no arbitrage-free corrective trade direction
     * in an underpriced mutex set without selling all legs simultaneously).
     */
    sum: z
      .number()
      .min(0)
      .optional()
      .describe(
        "Σ yes prices for mutex-set families.  " +
          "Absent for strike ladder, expiry curve, and nested families."
      ),
  })
  .describe(
    "Result of computeDislocation() for one market family.  " +
      "Attached to ScannerRow and consumed by the chart, hero panel, " +
      "and spread builder."
  );

// ── DislocationSeveritySchema (Phase 2) ───────────────────────────────────────

/**
 * Sigma-normalised severity computed from CLOB /prices-history data.
 *
 * STATUS: Not yet wired in.  This schema defines the Phase-2 contract.
 *
 * Formula:
 *   severity_σ = |rawDislocation| / trailingStd
 *
 * where trailingStd is the population standard deviation of the structural
 * spread (the difference between the two most-constrained market prices)
 * over the trailing 30-day window, computed using only point-in-time data.
 *
 * Minimum history gate:
 *   When barCount < 20, sigma cannot be reliably computed.
 *   In that case sigma is null and status is forced to "Watchlist" regardless
 *   of rawDislocation magnitude.
 */
export const DislocationSeveritySchema = z
  .object({
    /**
     * Sigma value: rawDislocation / trailingStd.
     * Null when barCount < 20 (minimum history gate).
     *
     * Thresholds:
     *   >= 2.0 → Actionable
     *   >= 1.5 → Watchlist
     *   <  1.5 → Normal
     */
    sigma: z
      .number()
      .min(0)
      .nullable()
      .describe(
        "Normalised severity in standard deviations.  " +
          "Null when fewer than 20 daily bars are available."
      ),

    /**
     * Trailing 30-day population standard deviation of the structural spread.
     * Null when barCount < 20.
     */
    trailingStd: z
      .number()
      .min(0)
      .nullable()
      .describe(
        "Population std dev of the dislocation spread over the trailing 30d window."
      ),

    /**
     * Number of daily price bars available in the trailing 30-day window
     * for the worst-data-quality market in this family.
     * (Using the minimum across legs ensures both legs have adequate history.)
     */
    barCount: z
      .number()
      .int()
      .min(0)
      .describe(
        "Minimum daily bar count across all markets in the family (trailing 30d)."
      ),

    /**
     * Whether barCount meets the 20-bar minimum required for sigma computation.
     * False → sigma is null → status cannot be Actionable.
     */
    hasMinimumBars: z
      .boolean()
      .describe("True only when barCount >= 20 (minimum history gate met)."),

    /**
     * Status derived from sigma (overrides the raw-pp status once Phase 2
     * is active).  Null when sigma is null.
     */
    sigmaStatus: StatusSchema.nullable().describe(
      "Status derived from sigma thresholds.  Null until barCount >= 20."
    ),
  })
  .describe(
    "Sigma-normalised dislocation severity — Phase 2, not yet wired in.  " +
      "Requires CLOB /prices-history integration."
  );

// ── NoArbEnvelopeResultSchema ─────────────────────────────────────────────────

/**
 * Result of computeNoArbEnvelope() applied to a sorted market price array.
 *
 * The no-arb envelope is the upper-bound constraint surface: at each position
 * i the envelope value is the minimum of all prices at positions j < i.
 * A market price that exceeds the envelope at its position is a violation point
 * and is coloured red on the strike chart.
 *
 * Example (strike ladder, 3 markets):
 *   prices   = [62, 58, 65]   (cents, ascending strike)
 *   envelope = [62, 62, 58]   (running minimum from left)
 *   colors   = ["blue", "blue", "red"]  (prices[2]=65 > envelope[2]=58)
 */
export const NoArbEnvelopeResultSchema = z
  .object({
    /**
     * Raw yes prices in cents (yesPrice × 100), one per sorted market.
     * Length matches sorted[] in DislocationSchema.
     */
    prices: z
      .array(z.number().min(0).max(100))
      .min(2)
      .describe("YES prices in cents (× 100), in constraint order."),

    /**
     * No-arbitrage upper bound at each position.
     * envelope[i] = min(prices[0 .. i-1]), with envelope[0] = prices[0].
     *
     * Chart renders this as a shaded area/dashed line.
     * Points where prices[i] > envelope[i] are violations.
     */
    envelope: z
      .array(z.number().min(0).max(100))
      .min(2)
      .describe("No-arb envelope values in cents.  envelope[0] = prices[0]."),

    /**
     * Per-point colour indicator used by Chart.js pointBackgroundColor.
     *   "#378ADD" — compliant point (price ≤ envelope)
     *   "#FF5000" — violation point (price > envelope)
     */
    colors: z
      .array(z.enum(["#378ADD", "#FF5000"]))
      .min(2)
      .describe(
        "Point colours for the Chart.js scatter layer.  " +
          "#FF5000 marks violations; #378ADD marks compliant points."
      ),

    /**
     * Count of violation points (prices[i] > envelope[i]).
     * 0 = no constraint violations in the chart data.
     */
    violationCount: z
      .number()
      .int()
      .min(0)
      .describe("Number of markets whose price exceeds the no-arb envelope."),
  })
  .describe(
    "Output of computeNoArbEnvelope() — the data structure fed directly " +
      "into the Chart.js strike/expiry chart datasets."
  );

// ── Convenience typedefs (JSDoc) ──────────────────────────────────────────────

/**
 * @typedef {z.infer<typeof FamilyTypeSchema>} FamilyType
 * Union of the four structural family type strings.
 */

/**
 * @typedef {z.infer<typeof StatusSchema>} Status
 * Signal status: "Actionable" | "Watchlist" | "Normal".
 */

/**
 * @typedef {z.infer<typeof MarketWithPriceSchema>} MarketWithPrice
 * Raw Gamma market extended with computed yesPrice.
 */

/**
 * @typedef {z.infer<typeof ViolatingPairSchema>} ViolatingPair
 * Tuple [low, high] of the two markets producing the maximum violation.
 */

/**
 * @typedef {z.infer<typeof DislocationSchema>} Dislocation
 * Full computed dislocation result for one market family.
 */

/**
 * @typedef {z.infer<typeof DislocationSeveritySchema>} DislocationSeverity
 * Sigma-normalised severity (Phase 2).
 */

/**
 * @typedef {z.infer<typeof NoArbEnvelopeResultSchema>} NoArbEnvelopeResult
 * Chart envelope computation result.
 */
