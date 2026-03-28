/**
 * @file schemas/family.js
 *
 * Zod schemas for the scanner family row — the primary unit of data
 * consumed by the Snapback UI.
 *
 * A "family row" is the result of:
 *   1. Fetching raw events from the Gamma API
 *   2. Filtering to active, liquid markets (volume > $500)
 *   3. Classifying the family type (strike ladder / expiry curve / mutex set / nested)
 *   4. Computing the dislocation and status
 *   5. Optionally attaching sigma severity (Phase 2, requires CLOB history)
 *
 * These rows drive every panel in the terminal:
 *   • Scanner sidebar   — family name, severity badge, status pill
 *   • Hero header       — family title, constraint description, signal card
 *   • Strike chart      — heroFamily.markets + heroFamily.labels
 *   • Stats bar         — markets count, type, rawDislocation, status
 *   • Spread builder    — violatingPair for leg questions and token prices
 *
 * Schema dependency chain:
 *   GammaMarketSchema  (gamma.js)
 *     → MarketWithPriceSchema  (market.js)
 *     → DislocationSchema      (market.js)
 *     → FamilyTypeSchema       (market.js)
 *     → StatusSchema           (market.js)
 *     → ScannerRowSchema       (this file)
 *     → ScannerResponseSchema  (this file)
 *
 * Usage:
 *   import { ScannerRowSchema, ScannerResponseSchema } from "@/lib/schemas/family";
 *   const rows = ScannerResponseSchema.parse(apiJson);
 */

import { z } from "zod";
import { DislocationSchema, DislocationSeveritySchema, FamilyTypeSchema, MarketWithPriceSchema, StatusSchema } from "./market";

// ── CSS class token schemas ───────────────────────────────────────────────────
//
// The frontend attaches Tailwind class strings to each row so that child
// components never have to re-derive colours from the status/type strings.
// These are validated as non-empty strings; exact Tailwind tokens are not
// enforced because they may evolve independently of the data contract.

const TailwindClassString = z
  .string()
  .describe(
    "Tailwind utility class string applied by the UI layer.  " +
      "May be an empty string when no colour modifier applies (e.g. Normal status)."
  );

// ── Severity display token ────────────────────────────────────────────────────

/**
 * Human-readable severity string shown in the scanner sidebar and signal card.
 *
 * Current format (raw pp, pre-Phase-2):
 *   "4.2pp"   — rawDislocation formatted to one decimal place
 *   "—"       — seed / offline rows with no live data
 *
 * Phase-2 format (sigma-normalised):
 *   "2.3σ"    — sigma value formatted to one decimal place
 *
 * Downstream callers must not parse this string for computation — use
 * rawDislocation (decimal) or sigmaSeverity (sigma) for math.
 */
const SeverityDisplaySchema = z
  .string()
  .describe(
    "Display-only severity label.  " +
      "\"4.2pp\" (pre-Phase-2) or \"2.3σ\" (Phase-2).  " +
      "Use rawDislocation / sigmaSeverity for computation, not this string."
  );

// ── ScannerRowSchema ──────────────────────────────────────────────────────────

/**
 * One row in the dislocation scanner — the canonical family data structure.
 *
 * Produced by fetchFamilies() in gammaApi.js and stored in the scannerRows
 * React state.  The selected row is promoted to heroFamily and drives the
 * chart, stats bar, and spread builder.
 *
 * Seed rows (isSeed: true) are shown when the Gamma API is unavailable.
 * They satisfy this schema but carry placeholder/zeroed values and must
 * never be passed to the Spread Builder or Backtest evidence panels.
 */
export const ScannerRowSchema = z
  .object({

    // ── Identity ─────────────────────────────────────────────────────────

    /**
     * Display name for this family, shown as the scanner button label and
     * the hero panel heading.
     *
     * Sourced from event.title, falling back to event.slug or "Unknown".
     * Examples: "BTC price thresholds", "Fed rate hold by month"
     */
    family: z
      .string()
      .min(1)
      .describe("Human-readable event title used as the family display name."),

    /**
     * URL slug for the parent Polymarket event.
     * Used to build deep-links: polymarket.com/event/{eventSlug}
     * Absent on seed rows.
     */
    eventSlug: z
      .string()
      .optional()
      .describe(
        "Polymarket event URL slug.  " +
          "Used for deep-links and as a stable family identifier across refreshes."
      ),

    // ── Classification ────────────────────────────────────────────────────

    /**
     * Structural family type determined by question-text pattern matching.
     *
     * Controls:
     *   • Which constraint formula is applied (dislocation math)
     *   • How markets are sorted for the chart (strikes ASC / dates ASC / price DESC)
     *   • The type badge colour in the scanner sidebar
     */
    type: FamilyTypeSchema,

    /**
     * Tailwind class string for the type badge background and text colour.
     * Pre-computed so child components never branch on `type` for styling.
     *
     * Mapping (from TYPE_CLS in gammaApi.js):
     *   "Strike ladder" → "bg-violet-100 text-violet-800"
     *   "Expiry curve"  → "bg-emerald-100 text-emerald-900"
     *   "Mutex set"     → "bg-orange-100 text-orange-900"
     *   "Nested"        → (to be defined when nested classification is added)
     */
    typeCls: TailwindClassString,

    // ── Dislocation magnitude ─────────────────────────────────────────────

    /**
     * Raw constraint violation magnitude, expressed as a decimal in [0, 1].
     * Multiply by 100 for percentage points.
     *
     * Interpretation by type:
     *   Strike ladder : max over adjacent pairs of (price[i+1] − price[i])
     *   Expiry curve  : max over adjacent pairs of (price[i] − price[i+1])
     *   Mutex set     : max(0, Σ prices − 1.0)
     *   Nested        : max(0, specific.price − general.price)
     *
     * Scanner ranking is by this field, descending.
     * 0.00 means no violation detected — the family is internally consistent.
     */
    rawDislocation: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Raw constraint violation, decimal in [0, 1].  " +
          "Multiply by 100 for percentage points.  " +
          "Scanner rows are ranked by this field descending."
      ),

    /**
     * Display-only severity label rendered in the scanner sidebar badge
     * and the hero panel signal card.
     *
     * "4.2pp"  — raw percentage points (current implementation)
     * "2.3σ"   — sigma-normalised (Phase 2, requires CLOB history)
     * "—"      — seed/offline row with no live dislocation data
     */
    severity: SeverityDisplaySchema,

    /**
     * Tailwind class string for the severity number colour.
     * Pre-computed from the row's status.
     *
     * Mapping (from SEVERITY_CLS in gammaApi.js):
     *   Actionable → "text-emerald-600"
     *   Watchlist  → "text-amber-600"
     *   Normal     → "text-muted-foreground"
     */
    severityCls: TailwindClassString,

    // ── Sigma severity (Phase 2 — not yet wired in) ───────────────────────

    /**
     * Sigma-normalised severity derived from CLOB price history.
     * Null until Phase-2 CLOB integration is complete.
     *
     * Formula: sigmaSeverity = rawDislocation / trailingStd(30d)
     *
     * Phase-2 status thresholds replace the raw-pp thresholds:
     *   >= 2.0σ → Actionable
     *   >= 1.5σ → Watchlist
     *   <  1.5σ → Normal
     *
     * Never display this value as "live" until CLOB history is wired in.
     */
    sigmaSeverity: z
      .number()
      .min(0)
      .nullable()
      .optional()
      .describe(
        "Sigma-normalised severity.  Null until CLOB /prices-history is " +
          "integrated (Phase 2).  Never imply this is live before that."
      ),

    /**
     * Full sigma severity object including trailingStd, barCount, and
     * sigmaStatus.  Present only when CLOB history is available.
     */
    sigmaDetail: DislocationSeveritySchema.nullable()
      .optional()
      .describe(
        "Full sigma severity breakdown — Phase 2 only.  " +
          "Null until CLOB /prices-history is integrated."
      ),

    // ── Signal status ─────────────────────────────────────────────────────

    /**
     * Signal status derived from dislocation magnitude.
     *
     * Current thresholds (raw pp):
     *   Actionable : rawDislocation >= 0.04
     *   Watchlist  : rawDislocation >= 0.02
     *   Normal     : rawDislocation <  0.02
     *
     * Phase-2 thresholds (sigma):
     *   Actionable : sigmaSeverity >= 2.0
     *   Watchlist  : sigmaSeverity >= 1.5
     *   Normal     : sigmaSeverity <  1.5
     */
    status: StatusSchema,

    /**
     * Tailwind class string for the status pill.
     * Pre-computed from the row's status.
     *
     * Mapping (from STATUS_CLS in gammaApi.js):
     *   Actionable → "bg-emerald-100 text-emerald-800"
     *   Watchlist  → "bg-amber-100 text-amber-800"
     *   Normal     → ""  (no modifier — uses default slate styling)
     */
    statusCls: TailwindClassString,

    // ── Constraint description ────────────────────────────────────────────

    /**
     * One-line human-readable description of the violated constraint.
     * Shown as the hero panel subtitle below the family title.
     *
     * Examples:
     *   Strike ladder : "P($100k) ≤ … ≤ P($80k)"
     *   Expiry curve  : "P(by May) ≤ P(by Jul)"
     *   Mutex set     : "Σ outcomes ≈ 1.00 (current: 1.14)"
     *   Nested        : "P(Lakers win Finals) ≤ P(Lakers make Finals)"
     */
    constraint: z
      .string()
      .describe(
        "Human-readable constraint description for the hero panel subtitle.  " +
          "Must reflect the actual violated formula, not a generic placeholder."
      ),

    // ── Markets ───────────────────────────────────────────────────────────

    /**
     * Markets belonging to this family, sorted in constraint order.
     *
     * Order by type:
     *   Strike ladder : ascending strike value    (lowest threshold first)
     *   Expiry curve  : ascending month index     (earliest date first)
     *   Mutex set     : descending yes price      (most expensive outcome first)
     *   Nested        : [specific, general]
     *
     * This is the same array as dislocation.sorted — it is hoisted to the
     * top level so chart and stats components can access it without drilling
     * into the dislocation object.
     *
     * Each market carries its computed yesPrice; multiply by 100 for cents.
     *
     * Empty on seed rows (isSeed: true).
     */
    markets: z
      .array(MarketWithPriceSchema)
      .describe(
        "Active liquid markets in this family, sorted in constraint order.  " +
          "Used as the chart data source and for spread leg selection.  " +
          "Empty for seed/offline rows."
      ),

    /**
     * X-axis labels for the strike / expiry / mutex chart.
     * Parallel array to markets[] — labels[i] describes markets[i].
     *
     * Format by type:
     *   Strike ladder : ["$80k", "$90k", "$100k"]
     *   Expiry curve  : ["May", "Jun", "Jul"]
     *   Mutex set     : first 22 chars of each market question
     *   Nested        : short question labels
     */
    labels: z
      .array(z.string())
      .describe(
        "Chart x-axis labels, one per entry in markets[].  " +
          "Strike labels use formatStrike(); expiry labels use month abbreviations."
      ),

    // ── Dislocation detail ────────────────────────────────────────────────

    /**
     * Full dislocation computation result for this family.
     *
     * Consumers that need the violating pair for spread direction, the
     * sorted markets for chart rendering, or the constraintDesc for the
     * hero panel all read from this object.
     *
     * Absent on seed rows — check isSeed before accessing.
     */
    dislocation: DislocationSchema.optional().describe(
      "Full computed dislocation result.  " +
        "Absent on seed rows.  " +
        "Contains violatingPair (spread direction), sorted (chart data), " +
        "constraintDesc (hero panel), and rawDislocation."
    ),

    // ── Seed / offline flag ───────────────────────────────────────────────

    /**
     * True when this row was synthesised from SEED_ROWS fallback data
     * because the Gamma API was unavailable at fetch time.
     *
     * Seed rows:
     *   • Display zeroed severity ("—") and Normal status
     *   • Have empty markets[] and no dislocation object
     *   • Must never be passed to the Spread Builder
     *   • Clicking a seed row in the scanner sidebar is a no-op
     *
     * The FreshnessBadge shows "Offline · seed data" in red when any
     * seed row is present in the scanner.
     */
    isSeed: z
      .boolean()
      .optional()
      .describe(
        "True when this row uses hardcoded seed fallback data.  " +
          "Seed rows have empty markets[] and zeroed dislocation values."
      ),
  })
  .describe(
    "One scanner row representing a detected market family.  " +
      "Produced by fetchFamilies(), stored in scannerRows state, and " +
      "promoted to heroFamily when selected in the sidebar."
  );

// ── ScannerSummarySchema ──────────────────────────────────────────────────────

/**
 * Aggregate counts derived from the full scanner row array.
 *
 * Displayed in the top navigation bar:
 *   Families     — total number of detected family rows
 *   Dislocations — rows with rawDislocation > 0
 *   Actionable   — rows with status === "Actionable"
 *
 * These are derived values — not stored in state separately, but computed
 * inline from scannerRows in the render function.  This schema defines what
 * a backend endpoint returning pre-computed counts would look like.
 */
export const ScannerSummarySchema = z
  .object({
    /** Total number of family rows in the scanner (includes Normal rows). */
    totalFamilies: z
      .number()
      .int()
      .min(0)
      .describe("Total detected families including Normal-status rows."),

    /**
     * Families with rawDislocation > 0.
     * Count shown as "Dislocations N" in the nav bar.
     */
    dislocatedCount: z
      .number()
      .int()
      .min(0)
      .describe("Families with at least one constraint violation (rawDislocation > 0)."),

    /**
     * Families with status === "Actionable".
     * Shown in green in the nav bar when > 0.
     */
    actionableCount: z
      .number()
      .int()
      .min(0)
      .describe("Families meeting the Actionable threshold."),

    /**
     * Families with status === "Watchlist".
     */
    watchlistCount: z
      .number()
      .int()
      .min(0)
      .describe("Families meeting the Watchlist threshold but not Actionable."),

    /**
     * Whether any rows in this result set are seed/offline rows.
     * Drives the FreshnessBadge colour: true → red "Offline · seed data".
     */
    hasSeedRows: z
      .boolean()
      .describe(
        "True when at least one row is sourced from the seed fallback.  " +
          "Triggers the red offline badge in the nav bar."
      ),
  })
  .describe(
    "Aggregate counts for the nav bar summary row.  " +
      "Derivable from scannerRows[] but may be returned directly by the backend."
  );

// ── ScannerResponseSchema ─────────────────────────────────────────────────────

/**
 * The full response payload a backend /api/families endpoint would return.
 *
 * The `rows` array is sorted descending by rawDislocation — the scanner
 * renders them in this order without additional client-side sorting.
 *
 * `meta` carries freshness and source information consumed by FreshnessBadge
 * and the nav bar loading state.
 *
 * `defaultHeroIndex` lets the backend suggest which row to highlight on load
 * (matches the current client logic: first Strike ladder with rawDislocation > 0,
 * otherwise index 0).
 *
 * Example:
 * {
 *   "rows": [ { "family": "BTC price thresholds", ... }, ... ],
 *   "summary": { "totalFamilies": 12, "actionableCount": 3, ... },
 *   "defaultHeroIndex": 0,
 *   "meta": { "fetchedAt": 1712880000000, "isLive": true, "isSeed": false }
 * }
 */
export const ScannerResponseSchema = z
  .object({
    /**
     * Ranked family rows, sorted descending by rawDislocation.
     * May be an empty array if no families with 2+ liquid markets were found.
     * Will contain SEED_ROWS entries when the Gamma API is unavailable.
     */
    rows: z
      .array(ScannerRowSchema)
      .describe(
        "Scanner family rows ranked by rawDislocation descending.  " +
          "Empty array is valid — the UI falls back to seed rows on the client."
      ),

    /**
     * Pre-computed aggregate counts for the nav bar summary.
     */
    summary: ScannerSummarySchema,

    /**
     * Zero-based index into `rows` that the client should highlight as the
     * hero family on load.
     *
     * Backend selection logic (mirrors current client logic in gammaApi.js):
     *   1. First row where type === "Strike ladder" and rawDislocation > 0
     *   2. Otherwise rows[0]
     *   3. Null if rows is empty
     */
    defaultHeroIndex: z
      .number()
      .int()
      .min(0)
      .nullable()
      .describe(
        "Suggested heroFamily index on page load.  " +
          "Null when rows is empty.  Client may override on user interaction."
      ),

    /**
     * Metadata about this response's freshness and data source.
     */
    meta: z
      .object({
        /**
         * Unix timestamp in milliseconds when the underlying Gamma /events
         * fetch completed (not when the response was serialised).
         * Used by FreshnessBadge to compute "Xs ago" staleness.
         */
        fetchedAt: z
          .number()
          .describe("Gamma /events fetch completion timestamp, ms since epoch."),

        /**
         * True when rows contain freshly fetched live Gamma data.
         * False when the response was served from a cache or seed fallback.
         */
        isLive: z
          .boolean()
          .describe("True when data originates from a live Gamma API call."),

        /**
         * True when all rows are seed/offline fallback data.
         * Mutually exclusive with isLive === true.
         */
        isSeed: z
          .boolean()
          .describe(
            "True when the Gamma API was unreachable and seed data is returned."
          ),

        /**
         * Cache age in seconds when isLive is false.
         * Null when isLive is true or when no cache exists.
         */
        cacheAgeSeconds: z
          .number()
          .int()
          .min(0)
          .nullable()
          .describe(
            "Seconds since the cached response was originally fetched.  " +
              "Null for live responses.  " +
              "FreshnessBadge shows amber when 60–300, red when > 300."
          ),

        /**
         * Gamma API HTTP status from the most recent fetch attempt.
         * Null when no attempt was made (e.g. response was served from cache).
         */
        gammaStatus: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe(
            "HTTP status code from the most recent GET /events call.  " +
              "Null when the cache was served without a new fetch."
          ),
      })
      .describe("Response freshness metadata consumed by FreshnessBadge and the nav bar."),
  })
  .describe(
    "Full payload returned by GET /api/families.  " +
      "Rows are pre-sorted and pre-classified; the client renders them directly " +
      "without additional data shaping."
  );

// ── Convenience typedefs (JSDoc) ──────────────────────────────────────────────

/**
 * @typedef {z.infer<typeof ScannerRowSchema>} ScannerRow
 * One family row in the dislocation scanner.
 */

/**
 * @typedef {z.infer<typeof ScannerSummarySchema>} ScannerSummary
 * Aggregate counts for the nav bar summary.
 */

/**
 * @typedef {z.infer<typeof ScannerResponseSchema>} ScannerResponse
 * Full GET /api/families response payload.
 */
