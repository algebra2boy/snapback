/**
 * @file schemas/spread.js
 *
 * Zod schemas for the Spread Builder panel — the third major section of the
 * Snapback terminal.
 *
 * The Spread Builder takes the violating pair from a ScannerRow and produces:
 *   1. Two spread legs (Leg A: Buy YES on the underpriced side,
 *                       Leg B: Buy NO on the overpriced side)
 *   2. A summary of combined cost, friction, break-even, and edge
 *   3. Historical backtest evidence (PIT / LOO validation)
 *   4. A P&L curve across repair-amount scenarios
 *   5. Order-book depth for each leg (Phase 2 — lazy-loaded)
 *
 * Implementation status
 * ─────────────────────
 * Leg questions and token prices are live (sourced from violatingPair).
 * All other fields (shares, cost, maxGain, summary, evidence, pnlCurve)
 * are static placeholder values until CLOB integration is complete.
 * The `isPlaceholder` flag on SpreadBuilderSchema marks this clearly.
 *
 * Schema dependency chain:
 *   MarketWithPriceSchema  (market.js)
 *     → SpreadLegSchema           (this file)
 *     → SpreadSummarySchema       (this file)
 *     → BacktestEpisodeSchema     (this file)
 *     → BacktestEvidenceSchema    (this file)
 *     → PnlPointSchema            (this file)
 *     → LegDepthSchema            (this file)
 *     → SpreadBuilderSchema       (this file)
 *     → SpreadResponseSchema      (this file)
 *
 * Usage:
 *   import { SpreadBuilderSchema, SpreadResponseSchema } from "@/lib/schemas/spread";
 *   const spread = SpreadResponseSchema.parse(apiJson);
 */

import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

/**
 * A monetary value in USD, expressed as a number (not a string).
 * Positive = inflow / gain.  Negative = outflow / loss.
 * Rounded to cents for display but stored as full float for computation.
 */
const usdAmount = z
  .number()
  .describe("USD monetary amount.  Positive = gain/inflow, negative = loss/outflow.");

/**
 * A probability / price, decimal in [0, 1].
 * Multiply by 100 for cents (percentage points).
 */
const probability = z.number().min(0).max(1);

/**
 * A percentage-point value expressed as a decimal fraction.
 * e.g. 0.012 = 1.2pp   |   0.04 = 4pp
 */
const ppDecimal = z
  .number()
  .min(0)
  .describe(
    "Percentage-point value as a decimal fraction (0.012 = 1.2pp).  " +
      "Multiply by 100 to display with the 'pp' suffix."
  );

// ── SpreadLegSchema ───────────────────────────────────────────────────────────

/**
 * The outcome token side purchased on a single leg of the spread.
 *
 *   YES — buy the YES token (profits if the market resolves YES)
 *   NO  — buy the NO token  (profits if the market resolves NO)
 *          equivalent to selling YES at (1 − yesPrice)
 */
export const LegSideSchema = z
  .enum(["YES", "NO"])
  .describe(
    "Token side purchased on this leg.  " +
      "YES = buy YES token.  NO = buy NO token (= sell YES equivalent)."
  );

/**
 * Direction of this leg relative to the structural trade.
 *
 *   BUY_YES_ON_CHEAP  — buy the underpriced leg (Leg A)
 *   BUY_NO_ON_DEAR    — buy NO on the overpriced leg (Leg B)
 */
export const LegDirectionSchema = z
  .enum(["BUY_YES_ON_CHEAP", "BUY_NO_ON_DEAR"])
  .describe(
    "Structural role of this leg.  " +
      "BUY_YES_ON_CHEAP = Leg A (underpriced side).  " +
      "BUY_NO_ON_DEAR  = Leg B (overpriced side)."
  );

/**
 * One leg of the two-leg corrective spread.
 *
 * Sizing uses equal dollar-at-risk across both legs:
 *   shares = targetRiskPerLeg / tokenPrice
 *
 * Binary token economics:
 *   cost    = tokenPrice × shares
 *   maxLoss = cost               (token goes to zero)
 *   maxGain = (1 − tokenPrice) × shares
 *
 * Leg A is always the structurally underpriced market (Buy YES).
 * Leg B is always the structurally overpriced market  (Buy NO).
 * Direction is forced by constraint math — not discretionary.
 *
 * Fields marked placeholder: shares, cost, maxGain.
 * These will be live once CLOB /book depth drives the sizing model.
 */
export const SpreadLegSchema = z
  .object({

    // ── Identity ──────────────────────────────────────────────────────────

    /**
     * Stable unique identifier of the market this leg is placed on.
     * Links to the CLOB API for order routing and /book depth queries.
     */
    conditionId: z
      .string()
      .describe(
        "Gamma conditionId for this leg's market.  " +
          "Used to fetch order-book depth and route CLOB orders."
      ),

    /**
     * YES-token ID for this market.
     * Required for GET /book?token_id={tokenId} depth queries.
     * Sourced from clobTokenIds[0] on the Gamma market object.
     * Null when clobTokenIds is absent from the Gamma response.
     */
    tokenId: z
      .string()
      .nullable()
      .describe(
        "YES-token ID for CLOB /book queries.  " +
          "Null when clobTokenIds is absent from the Gamma market object."
      ),

    // ── Question display ──────────────────────────────────────────────────

    /**
     * Full market question text sourced from getQuestion(market).
     * Displayed as the leg title in the Spread Builder card.
     * Truncated to ~50 characters in the UI but stored in full here.
     */
    question: z
      .string()
      .min(1)
      .describe(
        "Full market question text.  " +
          "UI truncates to 50 chars; store the full string for accessibility."
      ),

    // ── Token side ────────────────────────────────────────────────────────

    /**
     * The outcome token being purchased on this leg.
     *   Leg A: "YES" — buying the underpriced YES token
     *   Leg B: "NO"  — buying the NO token on the overpriced market
     *                   (equivalent to selling YES at noPrice = 1 − yesPrice)
     */
    side: LegSideSchema,

    /** Structural role of this leg in the spread. */
    direction: LegDirectionSchema,

    // ── Pricing ───────────────────────────────────────────────────────────

    /**
     * Mid-market price of the token being purchased, decimal in (0, 1).
     *
     * For YES legs  : yesPrice  (from outcomePrices[0])
     * For NO legs   : 1 − yesPrice
     *
     * This is the price used for sizing computation.  The actual fill
     * price will differ by half the bid/ask spread; that slippage is
     * captured in SpreadSummary.allInFriction.
     */
    tokenPrice: probability.describe(
      "Mid-market price of the purchased token, decimal in (0, 1).  " +
        "YES leg: outcomePrices[0].  NO leg: 1 − outcomePrices[0]."
    ),

    /**
     * The underlying YES price of this market, regardless of which token
     * side is being purchased.  Used to display alongside the NO token
     * trade ("NO @ $0.58 implies YES @ $0.42").
     */
    yesPrice: probability.describe(
      "Underlying YES-outcome price from the Gamma API, decimal in (0, 1).  " +
        "Always outcomePrices[0], regardless of which token side is traded."
    ),

    // ── Sizing (placeholder until CLOB depth is wired in) ─────────────────

    /**
     * Number of shares (tokens) purchased on this leg.
     *
     * Current value: static placeholder derived from a $100 risk-per-leg
     * target at a hardcoded example price.
     *
     * Phase-2 formula:
     *   shares = targetRiskPerLeg / tokenPrice
     *
     * where targetRiskPerLeg is configurable (default $100).
     *
     * IMPORTANT: Do not display shares as a live-computed value until CLOB
     * depth confirms that this quantity is fillable without large slippage.
     */
    shares: z
      .number()
      .positive()
      .describe(
        "Shares (tokens) to purchase on this leg.  " +
          "Placeholder until CLOB /book depth drives sizing.  " +
          "Formula: targetRiskPerLeg / tokenPrice."
      ),

    /**
     * Total upfront cost of this leg in USD.
     *
     * Formula: tokenPrice × shares
     * This is the maximum possible loss if the token goes to zero.
     *
     * Placeholder until shares is live-computed.
     */
    cost: usdAmount
      .min(0)
      .describe(
        "Total cost of this leg in USD (= tokenPrice × shares).  " +
          "Maximum possible loss on this leg alone."
      ),

    /**
     * Maximum possible gain on this leg in USD.
     *
     * Formula: (1 − tokenPrice) × shares
     * Realised when the token resolves to 1.00 (i.e. wins).
     *
     * Placeholder until shares is live-computed.
     */
    maxGain: usdAmount.describe(
      "Maximum gain on this leg in USD (= (1 − tokenPrice) × shares).  " +
        "Realised when this token resolves YES."
    ),

    // ── Friction contribution (Phase 2) ───────────────────────────────────

    /**
     * Estimated half-spread friction cost attributable to this leg alone.
     * Null until /book top-of-book spread is available.
     *
     * Formula: (topOfBookSpread / 2) × shares
     */
    frictionUsd: usdAmount
      .nullable()
      .optional()
      .describe(
        "Friction cost for this leg only, USD.  " +
          "Null until CLOB /book data is available.  " +
          "Formula: (topOfBookSpread / 2) × shares."
      ),

    /**
     * Whether a live /book depth query confirmed this share count is
     * fillable at the quoted price without excessive slippage.
     * Null until Phase-2 depth integration.
     */
    isFillable: z
      .boolean()
      .nullable()
      .optional()
      .describe(
        "True when /book depth confirms the target share count is available " +
          "within 5pp of best ask/bid.  Null until CLOB depth is wired in."
      ),
  })
  .describe(
    "One leg of the two-leg corrective spread.  " +
      "Leg A buys YES on the underpriced market; Leg B buys NO on the overpriced market.  " +
      "Spread direction is structurally implied — not discretionary."
  );

// ── SpreadSummarySchema ───────────────────────────────────────────────────────

/**
 * Aggregate economics of the combined two-leg spread.
 *
 * Current status:
 *   netCost       — live (sum of live leg costs once legs are live)
 *   allInFriction — placeholder proxy until CLOB /book is wired in
 *   breakEven     — placeholder calculation
 *   edge          — placeholder calculation
 *
 * Phase-2 friction model:
 *   friction = Σ (topOfBookSpread_i / 2) × shares_i   for each leg i
 *
 * The UI currently shows these under the label "Illustrative until
 * CLOB-backed spread economics replace the placeholder curve."
 */
export const SpreadSummarySchema = z
  .object({

    // ── Combined cost ─────────────────────────────────────────────────────

    /**
     * Total upfront spend across both legs in USD.
     *
     * Formula: legA.cost + legB.cost
     * This is the maximum possible loss if both tokens go to zero.
     *
     * Example: $99.94 + $99.76 = $199.70
     */
    netCost: usdAmount
      .min(0)
      .describe(
        "Total upfront cost across both legs in USD.  " +
          "= legA.cost + legB.cost.  Maximum possible loss."
      ),

    // ── Friction ──────────────────────────────────────────────────────────

    /**
     * Estimated total transaction cost in USD across both legs.
     *
     * Covers:
     *   • Bid/ask spread crossing (half-spread per leg)
     *   • Platform fee (currently 0 on Polymarket)
     *   • Slippage on larger orders (approximated from book depth)
     *
     * Phase-2 formula:
     *   allInFriction = Σ (topOfBookSpread_i / 2) × shares_i
     *
     * Pre-Phase-2: static proxy based on a conservative 1.2pp spread
     * assumption.  Do not display as "live-computed" until CLOB is wired.
     *
     * Example: $4.82
     */
    allInFriction: usdAmount
      .min(0)
      .describe(
        "Total estimated transaction cost across both legs in USD.  " +
          "Placeholder until CLOB /book drives the friction model."
      ),

    /**
     * The friction multiplier scenario used for this summary.
     *
     *   1.0 → Base case      (conservative half-spread proxy)
     *   1.5 → Harsh case     (used in no-trade gate evaluation)
     *
     * The no-trade gate checks whether the spread is profitable under
     * the 1.5× scenario — if not, the spread recommendation is suppressed.
     */
    frictionMultiplier: z
      .number()
      .min(1)
      .describe(
        "Friction scenario multiplier.  " +
          "1.0 = base (displayed in UI).  1.5 = harsh (used in no-trade gate)."
      ),

    /**
     * Brief human-readable note describing the friction assumption.
     * Displayed under the summary stats as a caveat.
     *
     * Examples:
     *   "Conservative proxy — CLOB depth not yet integrated."
     *   "Based on live top-of-book spread (Phase 2)."
     */
    frictionNote: z
      .string()
      .describe(
        "Short human-readable description of the friction assumption.  " +
          "Displayed in the Spread Builder summary section."
      ),

    // ── Break-even and edge ───────────────────────────────────────────────

    /**
     * The minimum dislocation repair (in percentage-point decimals) required
     * for this spread to break even after friction.
     *
     * Formula:
     *   breakEvenRepair = allInFriction / (legA.shares + legB.shares)
     *   ... expressed as a decimal in pp units.
     *
     * Displayed with the "pp" suffix, e.g. "1.2pp".
     * The P&L curve crosses zero at this repair amount.
     *
     * Example: 0.012 (= 1.2pp)
     */
    breakEvenRepair: ppDecimal.describe(
      "Minimum repair (pp decimal) for the spread to cover friction costs.  " +
        "The P&L curve crosses zero at this point.  " +
        "Displayed as \"1.2pp\" in the UI."
    ),

    /**
     * Net opportunity remaining after subtracting break-even repair from the
     * current raw dislocation.
     *
     * Formula:
     *   edgeAfterSpread = rawDislocation − breakEvenRepair
     *
     * Displayed with the "pp" suffix, e.g. "2.8pp".  Shown in green.
     * Negative values indicate the friction exceeds the dislocation —
     * the no-trade gate should suppress the spread recommendation in that case.
     *
     * Example: 0.028 (= 2.8pp)
     */
    edgeAfterSpread: z
      .number()
      .describe(
        "Net edge after friction, pp decimal.  " +
          "= rawDislocation − breakEvenRepair.  " +
          "Negative means friction exceeds the opportunity — no-trade gate applies."
      ),

    /**
     * Expected value per $100 risked, in USD.
     *
     * Formula:
     *   evPer100 = (EV_legA + EV_legB − allInFriction) / netCost × 100
     *
     * Placeholder until leg EVs are computed from live prices and CLOB depth.
     * Null until Phase-2.
     */
    evPer100: usdAmount
      .nullable()
      .optional()
      .describe(
        "Expected value per $100 risked, USD.  " +
          "Null until live EV computation is wired in (Phase 2)."
      ),

    // ── Sizing parameters (for display / audit) ───────────────────────────

    /**
     * Target dollar-at-risk per leg used in the sizing formula.
     *
     * Both legs are sized to risk this amount so that neither leg
     * dominates the combined P&L:
     *   shares_i = targetRiskPerLeg / tokenPrice_i
     *
     * Default: 100 (= $100 per leg, $200 combined).
     */
    targetRiskPerLeg: usdAmount
      .min(0)
      .describe(
        "Target USD risk per leg.  " +
          "shares = targetRiskPerLeg / tokenPrice.  Default $100."
      ),
  })
  .describe(
    "Combined economics of the two-leg corrective spread.  " +
      "Most fields are placeholders until CLOB /book integration (Phase 2).  " +
      "Check SpreadBuilderSchema.isPlaceholder before presenting as live analytics."
  );

// ── BacktestEpisodeSchema ─────────────────────────────────────────────────────

/**
 * A single historical episode of a dislocation-then-repair event.
 *
 * An episode begins when the structural spread exceeds the trigger threshold
 * (> 2σ using PIT data) and ends when it closes back below the release
 * threshold (< 0.5σ within 7 calendar days).
 *
 * Episodes are detected and stored server-side using /prices-history data.
 * This schema is Phase-2 — not computed until CLOB history is wired in.
 */
export const BacktestEpisodeSchema = z
  .object({

    /** Unique identifier for this episode (e.g. slug + ISO date string). */
    episodeId: z
      .string()
      .describe("Stable unique key for this episode, e.g. \"btc-thresholds-2024-03-15\"."),

    /** Dislocation magnitude at the episode trigger, decimal in [0, 1]. */
    entryDislocation: ppDecimal.describe(
      "Dislocation magnitude when the episode triggered (> threshold), decimal."
    ),

    /**
     * Unix timestamp in seconds when the episode trigger fired.
     * Based on the daily bar whose price crossed the trigger threshold.
     */
    entryTs: z
      .number()
      .int()
      .positive()
      .describe("Episode entry timestamp, Unix seconds."),

    /**
     * Dislocation magnitude at episode close, decimal in [0, 1].
     * Null if the episode has not yet closed (still open / timed out).
     */
    closeDislocation: ppDecimal.nullable().describe(
      "Dislocation magnitude when the episode closed, decimal.  " +
        "Null if the episode timed out without closing."
    ),

    /**
     * Unix timestamp in seconds when the episode closed.
     * Null if the episode has not yet closed.
     */
    closeTs: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe("Episode close timestamp, Unix seconds.  Null if still open."),

    /**
     * Number of calendar days from entry to close.
     * Null if the episode has not closed.
     * Episodes that exceed 7 days without closing are marked as timed out.
     */
    durationDays: z
      .number()
      .min(0)
      .nullable()
      .describe(
        "Days from entry to close.  Null if not yet closed.  " +
          "Episodes > 7 days without closing are classified as timed-out."
      ),

    /**
     * Simulated P&L for this episode per $100 risked (USD), using the
     * entry price, close price, and base friction scenario.
     *
     * Formula:
     *   pnlPer100 = (entryDislocation − closeDislocation − friction) / netCost × 100
     *
     * Positive = profitable episode.
     * Null if the episode has not closed (cannot compute final P&L).
     */
    pnlPer100: usdAmount
      .nullable()
      .describe(
        "Simulated net P&L per $100 risked for this episode, USD.  " +
          "Null for unclosed episodes.  Positive = episode was profitable."
      ),

    /**
     * Whether this episode was profitable (pnlPer100 > 0) under the base
     * friction scenario.
     * Null for unclosed episodes.
     */
    isWin: z
      .boolean()
      .nullable()
      .describe(
        "True when pnlPer100 > 0 under base friction.  " +
          "Null for unclosed episodes."
      ),

    /**
     * Whether this episode was a LOO (leave-one-out) validation episode.
     * LOO episodes are excluded from the model that predicted them, providing
     * an unbiased estimate of out-of-sample performance.
     */
    isLoo: z
      .boolean()
      .describe(
        "True when this episode was held out in the LOO validation pass.  " +
          "LOO win rate is the headline accuracy metric."
      ),

    /**
     * P&L for this episode under the harsh friction scenario (1.5× base).
     * Used by the no-trade gate: if P75 of harsh P&L < −25% of risk, suppress.
     * Null for unclosed episodes.
     */
    pnlPer100Harsh: usdAmount
      .nullable()
      .optional()
      .describe(
        "Simulated P&L per $100 under 1.5× friction.  " +
          "Null for unclosed episodes.  Used in no-trade gate evaluation."
      ),
  })
  .describe(
    "One historical dislocation episode — a period when the structural spread " +
      "exceeded the trigger threshold and subsequently closed.  " +
      "Phase-2 only — requires CLOB /prices-history integration."
  );

// ── BacktestEvidenceSchema ────────────────────────────────────────────────────

/**
 * Aggregate backtest statistics across all historical episodes for this family.
 *
 * Displayed in the "Evidence · PIT leave-one-out" section of the Spread Builder.
 * Currently rendered with static placeholder values in the UI.
 *
 * The no-trade gate reads from this object and suppresses spread recommendations
 * when any of the following conditions hold:
 *   1. confidence === "Insufficient" (episodes < 5)
 *   2. medianPnlPer100 < 0 under base friction
 *   3. p25PnlPer100 < −25 under base friction
 *   4. The signal collapses under the harsh friction scenario (1.5×)
 *
 * When noTradeGate is true the UI shows:
 *   "Structural anomaly detected. Insufficient evidence for spread. Watchlist only."
 */
export const BacktestEvidenceSchema = z
  .object({

    // ── Episode counts ────────────────────────────────────────────────────

    /**
     * Total number of historical episodes detected for this family.
     * An episode = a period where dislocation exceeded the trigger threshold
     * and closed within 7 days.
     *
     * Fewer than 5 episodes → confidence = "Insufficient" → no-trade gate.
     */
    episodes: z
      .number()
      .int()
      .min(0)
      .describe(
        "Total historical episodes detected.  " +
          "< 5 triggers confidence = \"Insufficient\" and the no-trade gate."
      ),

    /**
     * Number of episodes in the LOO (leave-one-out) validation set.
     * Always <= episodes.  Typically the same as episodes when the full
     * dataset is used as the LOO set.
     */
    looTotal: z
      .number()
      .int()
      .min(0)
      .describe("Total episodes included in the LOO validation set."),

    /**
     * Number of LOO episodes that were profitable (pnlPer100 > 0).
     * Win rate = looWins / looTotal.
     */
    looWins: z
      .number()
      .int()
      .min(0)
      .describe("LOO episodes that were profitable under base friction."),

    /**
     * LOO win rate as a decimal in [0, 1].
     * Derived from looWins / looTotal; stored explicitly for display.
     * Null when looTotal === 0.
     */
    winRate: z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .describe(
        "LOO win rate, decimal in [0, 1].  " +
          "= looWins / looTotal.  Null when looTotal = 0."
      ),

    // ── P&L distribution ──────────────────────────────────────────────────

    /**
     * Median P&L per $100 risked across all closed episodes, USD.
     * Positive means the spread was profitable in a typical episode.
     *
     * No-trade gate: suppress if medianPnlPer100 < 0.
     *
     * Example: +8.40 (= +$8.40 per $100 risked)
     */
    medianPnlPer100: usdAmount.describe(
      "Median net P&L per $100 risked across closed episodes, USD.  " +
        "No-trade gate applies when this is negative."
    ),

    /**
     * 25th-percentile P&L per $100 risked, USD.
     * Measures downside risk: 75% of episodes did better than this.
     *
     * No-trade gate: suppress if p25PnlPer100 < −25 (= −25% of risk).
     *
     * Example: −4.20 (= −$4.20 per $100 risked)
     */
    p25PnlPer100: usdAmount.describe(
      "25th-percentile P&L per $100 risked, USD.  " +
        "No-trade gate applies when this is below −25 (= −25% of risk)."
    ),

    /**
     * Worst single-episode P&L per $100 risked (most negative value), USD.
     * Shown in red as a tail-risk indicator.
     *
     * Example: −18.50 (= −$18.50 per $100 risked)
     */
    worstLoss: usdAmount.describe(
      "Worst single-episode P&L per $100, USD.  " +
        "Most negative observed outcome — displayed in red as a tail-risk warning."
    ),

    /**
     * Best single-episode P&L per $100 risked, USD.
     * Shown as the upper bound of the return distribution.
     */
    bestGain: usdAmount
      .optional()
      .describe(
        "Best single-episode P&L per $100, USD.  " +
          "Upper bound of observed returns."
      ),

    // ── Friction scenario used in this evidence summary ───────────────────

    /**
     * The friction multiplier scenario under which this evidence was computed.
     *   1.0 → Base case (headline metrics)
     *   1.5 → Harsh case (no-trade gate evaluation)
     *
     * The UI displays base metrics and uses harsh metrics silently in the gate.
     */
    frictionMultiplier: z
      .number()
      .min(1)
      .describe(
        "Friction multiplier for this evidence summary.  " +
          "1.0 = base (displayed).  1.5 = harsh (used in no-trade gate silently)."
      ),

    /**
     * Human-readable friction label shown in the Evidence panel.
     *
     * Examples: "Base (1.0×)"  |  "Harsh (1.5×)"
     */
    frictionLabel: z
      .string()
      .describe(
        "Display label for the friction scenario.  " +
          "Shown in the Friction row of the Evidence card grid."
      ),

    // ── Confidence and no-trade gate ──────────────────────────────────────

    /**
     * Qualitative confidence level based on episode count and P&L distribution.
     *
     *   "High"         : episodes >= 10 AND medianPnlPer100 > 0 AND p25 > −25
     *   "Moderate"     : episodes >= 5  AND medianPnlPer100 > 0 AND p25 > −25
     *   "Low"          : episodes >= 5  but P&L distribution is weak
     *   "Insufficient" : episodes < 5   (no-trade gate always fires)
     */
    confidence: z
      .enum(["High", "Moderate", "Low", "Insufficient"])
      .describe(
        "Qualitative confidence level.  " +
          "\"Insufficient\" (episodes < 5) always triggers the no-trade gate.  " +
          "\"High\" / \"Moderate\" confidence required for a spread recommendation."
      ),

    /**
     * True when the no-trade gate is active — the spread recommendation
     * should be suppressed and replaced with the watchlist-only message.
     *
     * Gate conditions (any one triggers suppression):
     *   1. confidence === "Insufficient" (episodes < 5)
     *   2. medianPnlPer100 < 0
     *   3. p25PnlPer100 < −25
     *   4. edgeAfterSpread < 0 (friction exceeds dislocation)
     *   5. Spread collapses under 1.5× harsh friction
     *   6. sigmaSeverity < 1.5 (still Normal range)
     *   7. barCount < 20 (insufficient history)
     */
    noTradeGate: z
      .boolean()
      .describe(
        "True when at least one no-trade gate condition is met.  " +
          "Suppresses the spread recommendation and shows the watchlist-only message."
      ),

    /**
     * Human-readable explanation of why the no-trade gate fired.
     * Null when noTradeGate is false.
     *
     * Examples:
     *   "Insufficient history — fewer than 5 prior episodes detected."
     *   "Median backtest P&L is negative under base friction."
     *   "25th-percentile P&L exceeds −25% of risk."
     *   "Spread disappears under 1.5× harsh friction scenario."
     */
    noTradeReason: z
      .string()
      .nullable()
      .describe(
        "Explanation of the first no-trade gate condition that triggered.  " +
          "Null when noTradeGate is false.  Displayed in the watchlist-only alert."
      ),

    // ── Data provenance ───────────────────────────────────────────────────

    /**
     * True when this evidence object contains live values computed from
     * CLOB /prices-history data.  False when it is a static placeholder.
     *
     * The UI must not imply the evidence is live when this is false.
     */
    isLive: z
      .boolean()
      .describe(
        "True when evidence is computed from live CLOB /prices-history data.  " +
          "False for placeholder/demo values — the UI must label these as such."
      ),

    /**
     * ISO 8601 datetime string for the end of the history window used in
     * this backtest.  Null when isLive is false.
     */
    historyWindowEnd: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .optional()
      .describe(
        "ISO 8601 end of the price-history window used in the backtest.  " +
          "Null for placeholder evidence."
      ),

    /**
     * Minimum daily bar count across all markets used in this backtest.
     * < 20 bars → hasMinimumBars = false → noTradeGate fires.
     * Null when isLive is false.
     */
    barCount: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe(
        "Minimum daily bar count across all family markets in the history window.  " +
          "< 20 triggers the insufficient-history no-trade gate.  Null for placeholders."
      ),

    /**
     * Individual episode records.  Present when the full backtest is computed;
     * may be omitted when only aggregate statistics are returned (e.g. in the
     * scanner response where episode-level detail would be too large).
     */
    episodes_detail: z
      .array(BacktestEpisodeSchema)
      .optional()
      .describe(
        "Individual episode records.  Optional — omit in scanner responses.  " +
          "Include when the Spread Builder panel requests full episode history."
      ),
  })
  .describe(
    "Aggregate PIT/LOO backtest evidence for one market family.  " +
      "Drives the Evidence card grid and the no-trade gate logic.  " +
      "Phase-2 only — placeholder values are used until CLOB is wired in."
  );

// ── PnlPointSchema ────────────────────────────────────────────────────────────

/**
 * A single point on the Spread Builder P&L curve.
 *
 * The P&L curve plots net profit / loss (Y axis) against the hypothetical
 * repair amount — how many percentage points the dislocation closes before
 * the spread is unwound (X axis).
 *
 * The curve typically spans 0–4pp of repair.  The break-even point is where
 * netPnl crosses zero.  A second dataset (the break-even reference line) is
 * plotted at netPnl = 0 across all repairPct values.
 *
 * Current implementation:
 *   REPAIR_PCTS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]
 *   netPnl = (legA.shares × repairPct/100 + legB.shares × repairPct/100) − friction
 *
 * This is illustrative / static until CLOB-backed sizing is live.
 */
export const PnlPointSchema = z
  .object({
    /**
     * Hypothetical dislocation repair amount in percentage points (not decimal).
     * The X-axis value of the P&L chart.
     *
     * Range: typically 0–4pp in 0.5pp increments.
     * 0pp = no repair (worst case, full loss of friction).
     * 4pp = full repair (dislocation fully closes).
     *
     * Example: 1.5  (= 1.5pp repair)
     */
    repairPct: z
      .number()
      .min(0)
      .describe(
        "Hypothetical repair in percentage points (not decimal).  " +
          "X-axis of the P&L chart.  Range typically 0–4 in 0.5pp steps."
      ),

    /**
     * Net P&L across both legs at this repair amount, in USD.
     * The Y-axis value of the P&L chart.
     *
     * Formula (simplified):
     *   netPnl = (legA.shares + legB.shares) × (repairPct / 100) − allInFriction
     *
     * Negative below break-even, positive above.
     *
     * Example: −4.82 at 0pp, +4.28 at 2pp, +16.00 at 4pp
     */
    netPnl: usdAmount.describe(
      "Net P&L across both legs at this repair amount, USD.  " +
        "Y-axis of the P&L chart.  Negative below break-even."
    ),

    /**
     * P&L under the harsh friction scenario (1.5× allInFriction).
     * Plotted as a secondary dataset or used only in the no-trade gate.
     * Null when isPlaceholder is true.
     */
    netPnlHarsh: usdAmount
      .nullable()
      .optional()
      .describe(
        "P&L under 1.5× friction at this repair amount.  " +
          "Null for placeholder curves."
      ),
  })
  .describe(
    "One point on the Spread Builder P&L vs. repair-amount curve.  " +
      "The curve crosses zero at the break-even repair amount."
  );

// ── LegDepthSchema ────────────────────────────────────────────────────────────

/**
 * Order-book depth summary for a single spread leg.
 *
 * Phase-2 only — fetched lazily when the user opens the Spread Builder,
 * never prefetched for all families simultaneously.
 *
 * Used to:
 *   • Verify that the target share count is fillable without large slippage
 *   • Compute realistic friction (DWAP vs. mid-market price)
 *   • Display depth bars under the leg cards (planned Phase-2 UI)
 */
export const LegDepthSchema = z
  .object({
    /** The conditionId this depth snapshot belongs to. */
    conditionId: z.string(),

    /** The YES-token ID used in the /book query. */
    tokenId: z.string(),

    /**
     * Which token side this depth snapshot represents.
     * For YES legs: the ask side of the YES token book.
     * For NO legs: the bid side of the YES token book (inverted).
     */
    side: z.enum(["YES", "NO"]),

    // ── Top-of-book ───────────────────────────────────────────────────────

    /** Best price available for the target token (best ask for YES, best bid-inverted for NO). */
    bestPrice: probability.nullable().describe(
      "Best available price for the target token side.  " +
        "Null if the book is empty on this side."
    ),

    /**
     * Top-of-book full spread (bestAsk − bestBid on the YES token book).
     * The primary friction input for the Spread Builder.
     */
    topOfBookSpread: z
      .number()
      .min(0)
      .nullable()
      .describe(
        "Top-of-book bid/ask spread on the YES token.  Null if book is one-sided."
      ),

    // ── Fillability ───────────────────────────────────────────────────────

    /**
     * Total shares available within 5pp of the best price on the target side.
     * If availableShares < leg.shares, the order will move the market.
     */
    availableShares: z
      .number()
      .min(0)
      .describe(
        "Shares available within 5pp of best price.  " +
          "Compare to leg.shares to assess fillability."
      ),

    /**
     * Depth-weighted average price (DWAP) for filling exactly leg.shares.
     * Null if availableShares < leg.shares (order cannot be fully filled).
     */
    dwapPrice: probability
      .nullable()
      .describe(
        "Depth-weighted average fill price for leg.shares.  " +
          "Null when full fill is not available within 5pp."
      ),

    /**
     * Estimated slippage = dwapPrice − bestPrice.
     * Null when dwapPrice is null.
     */
    slippage: z
      .number()
      .nullable()
      .describe(
        "Estimated slippage cost in decimal pp (dwapPrice − bestPrice).  " +
          "Null when DWAP cannot be computed."
      ),

    /** Unix timestamp in milliseconds when this snapshot was fetched. */
    fetchedAt: z
      .number()
      .describe("Depth snapshot fetch timestamp, ms since epoch."),
  })
  .describe(
    "Order-book depth summary for one spread leg.  " +
      "Phase-2 only — fetched on demand when the Spread Builder panel opens."
  );

// ── SpreadBuilderSchema ───────────────────────────────────────────────────────

/**
 * Full Spread Builder payload for one market family.
 *
 * This is the complete data object rendered by the Spread Builder section
 * of the terminal.  It is keyed to a specific family via `familySlug` and
 * becomes stale when the family's dislocation changes significantly.
 *
 * Current implementation status:
 *   legA.question, legA.yesPrice, legB.question, legB.yesPrice  — LIVE
 *   legA.shares, legA.cost, legA.maxGain                        — PLACEHOLDER
 *   legB.shares, legB.cost, legB.maxGain                        — PLACEHOLDER
 *   summary.*                                                    — PLACEHOLDER
 *   evidence.*                                                   — PLACEHOLDER
 *   pnlCurve.*                                                   — PLACEHOLDER
 *   depth.*                                                      — NOT FETCHED
 *
 * The `isPlaceholder` flag is true until all fields are live-computed.
 * The UI must not imply any placeholder field is analytically computed.
 */
export const SpreadBuilderSchema = z
  .object({

    // ── Identity ──────────────────────────────────────────────────────────

    /**
     * Polymarket event slug for the family this spread belongs to.
     * Used as the stable key to associate a spread with its scanner row.
     */
    familySlug: z
      .string()
      .describe(
        "Event slug of the parent market family.  " +
          "Links this spread back to its ScannerRow."
      ),

    // ── Legs ──────────────────────────────────────────────────────────────

    /**
     * Leg A — Buy YES on the structurally underpriced market.
     *
     * For a strike ladder violation where P($100k) > P($90k):
     *   Leg A = Buy YES on the "$90k" market (should be more expensive)
     *
     * For an expiry curve inversion where P(May) > P(July):
     *   Leg A = Buy YES on the "July" market (should be more expensive)
     *
     * For a mutex overpricing:
     *   Leg A = Buy NO on the most overpriced outcome (spread is single-legged
     *           or multi-legged — handled separately in mutex logic)
     */
    legA: SpreadLegSchema.describe(
      "Leg A: Buy YES on the underpriced market.  " +
        "Direction is structurally implied — do not allow user to override."
    ),

    /**
     * Leg B — Buy NO on the structurally overpriced market.
     *
     * For a strike ladder violation where P($100k) > P($90k):
     *   Leg B = Buy NO on the "$100k" market (should be less expensive)
     */
    legB: SpreadLegSchema.describe(
      "Leg B: Buy NO on the overpriced market.  " +
        "Direction is structurally implied — do not allow user to override."
    ),

    // ── Summary economics ─────────────────────────────────────────────────

    /** Combined spread economics across both legs. */
    summary: SpreadSummarySchema,

    // ── Backtest evidence ─────────────────────────────────────────────────

    /**
     * Historical backtest evidence from PIT/LOO analysis.
     * Contains the no-trade gate decision and all evidence card metrics.
     */
    evidence: BacktestEvidenceSchema,

    // ── P&L curve ─────────────────────────────────────────────────────────

    /**
     * Data points for the P&L vs. repair-amount chart.
     * Rendered by the pnlChartRef Chart.js canvas in the Spread Builder.
     *
     * Must contain at least 2 points to render a line.
     * Typically 9 points: 0pp through 4pp in 0.5pp steps.
     */
    pnlCurve: z
      .array(PnlPointSchema)
      .min(2)
      .describe(
        "P&L chart data points — one per repair-amount step.  " +
          "Typically 9 points from 0 to 4pp in 0.5pp increments."
      ),

    // ── Order-book depth (Phase 2, on demand) ─────────────────────────────

    /**
     * Order-book depth snapshots for each leg.
     * Null until the user opens the Spread Builder and the /book fetch completes.
     * Never prefetch — only fetch when this panel is visible.
     */
    depth: z
      .object({
        legA: LegDepthSchema,
        legB: LegDepthSchema,
      })
      .nullable()
      .optional()
      .describe(
        "Live order-book depth for both legs.  " +
          "Null until lazily fetched when the Spread Builder panel is opened."
      ),

    // ── Placeholder / live status flags ───────────────────────────────────

    /**
     * True when any material field in this object is a static placeholder
     * rather than a live-computed value.
     *
     * Currently true for: shares, cost, maxGain, summary.*, evidence.*, pnlCurve.*
     * Will become false incrementally as Phase-2 integration completes.
     *
     * When true, the UI must show the disclaimer:
     *   "Illustrative until CLOB-backed spread economics replace the placeholder curve."
     */
    isPlaceholder: z
      .boolean()
      .describe(
        "True when any material field uses placeholder/demo values.  " +
          "The UI must display a disclaimer when this is true."
      ),

    /**
     * Bitmask-style record of which specific sections are still placeholder.
     * Allows the UI to label individual sections precisely as they are
     * progressively wired in during Phase-2.
     */
    placeholderSections: z
      .object({
        /** Leg sizing (shares, cost, maxGain) is placeholder. */
        sizing: z.boolean(),
        /** Summary economics (netCost, friction, breakEven, edge) is placeholder. */
        summary: z.boolean(),
        /** Backtest evidence (episodes, LOO, P&L distribution) is placeholder. */
        evidence: z.boolean(),
        /** P&L curve is placeholder. */
        pnlCurve: z.boolean(),
        /** Order-book depth has not been fetched yet. */
        depth: z.boolean(),
      })
      .optional()
      .describe(
        "Granular breakdown of which sections are still placeholder.  " +
          "Allows progressive UI labelling as Phase-2 integration proceeds."
      ),

    /** Unix timestamp in milliseconds when this spread was computed. */
    computedAt: z
      .number()
      .describe("Spread computation timestamp, ms since epoch."),
  })
  .describe(
    "Full Spread Builder payload for one market family.  " +
      "Leg questions and token prices are live; all other fields are " +
      "placeholder until CLOB integration is complete (Phase 2).  " +
      "Check isPlaceholder before presenting any field as analytically live."
  );

// ── SpreadResponseSchema ──────────────────────────────────────────────────────

/**
 * API response envelope for GET /api/spread/{familySlug}.
 *
 * Returned when the client requests Spread Builder data for a specific family.
 * Distinct from the scanner response (which contains only the scanner row
 * without full spread economics).
 *
 * The backend should:
 *   1. Look up the ScannerRow for `familySlug`
 *   2. Identify the violating pair from the row's dislocation
 *   3. Build legs from the violating pair's markets
 *   4. Compute summary from leg prices (placeholder sizing for now)
 *   5. Return placeholder evidence and P&L curve until Phase-2 is wired in
 *   6. Set depth: null (fetched separately by GET /api/depth/{conditionId})
 */
export const SpreadResponseSchema = z
  .object({
    /** The Spread Builder payload. */
    data: SpreadBuilderSchema,

    /** Response metadata. */
    meta: z
      .object({
        /** Unix timestamp in milliseconds when this response was generated. */
        generatedAt: z
          .number()
          .describe("Response generation timestamp, ms since epoch."),

        /**
         * The dislocation rawDislocation value that was current when this
         * spread was computed.  If the client's cached ScannerRow shows a
         * significantly different value, the spread should be re-fetched.
         */
        dislocationAtCompute: ppDecimal.describe(
          "rawDislocation (decimal) of the family when this spread was computed.  " +
            "Used to detect stale spread data on the client."
        ),

        /**
         * Suggested re-fetch interval for this spread in seconds.
         * Spread economics change slowly; 30s is appropriate.
         */
        ttlSeconds: z
          .number()
          .int()
          .min(0)
          .describe(
            "Suggested client-side cache TTL for this spread, in seconds.  " +
              "Spread Builder data is less time-sensitive than scanner prices."
          ),
      })
      .describe("Response metadata for cache management."),
  })
  .describe(
    "GET /api/spread/{familySlug} response.  " +
      "Contains full Spread Builder data for one family, keyed by event slug."
  );

// ── DepthResponseSchema ───────────────────────────────────────────────────────

/**
 * API response envelope for GET /api/depth/{conditionId}.
 *
 * Fetched lazily (on demand) when the Spread Builder panel is opened.
 * Never prefetched for all families — only for the currently selected family.
 *
 * The backend fetches clob.polymarket.com/book?token_id={tokenId} and
 * enriches the raw response with derived metrics (topOfBookSpread, DWAP, etc.).
 *
 * Cache policy: do NOT cache — always fetch fresh when this endpoint is called.
 */
export const DepthResponseSchema = z
  .object({
    /**
     * Depth snapshots for both legs of the spread for this conditionId.
     * Both legs are returned in a single call to avoid a second round-trip.
     */
    data: z
      .object({
        legA: LegDepthSchema,
        legB: LegDepthSchema,
      })
      .describe("Depth snapshots for both spread legs."),

    meta: z
      .object({
        /** Unix timestamp in milliseconds when /book was fetched from CLOB. */
        fetchedAt: z
          .number()
          .describe("CLOB /book fetch timestamp, ms since epoch."),

        /** The YES-token IDs that were queried. */
        tokenIds: z
          .object({
            legA: z.string(),
            legB: z.string(),
          })
          .describe("YES-token IDs used in the /book queries."),

        /** HTTP status codes from the CLOB /book calls. */
        clobStatus: z
          .object({
            legA: z.number().int(),
            legB: z.number().int(),
          })
          .optional()
          .describe("HTTP status codes from the CLOB /book calls."),
      })
      .describe("Depth response metadata."),
  })
  .describe(
    "GET /api/depth/{conditionId} response.  " +
      "Fetched on demand when the Spread Builder panel opens.  " +
      "Never cache — always fetch fresh."
  );

// ── Convenience typedefs (JSDoc) ──────────────────────────────────────────────

/**
 * @typedef {z.infer<typeof LegSideSchema>} LegSide
 * "YES" | "NO"
 */

/**
 * @typedef {z.infer<typeof LegDirectionSchema>} LegDirection
 * "BUY_YES_ON_CHEAP" | "BUY_NO_ON_DEAR"
 */

/**
 * @typedef {z.infer<typeof SpreadLegSchema>} SpreadLeg
 * One leg of the corrective spread.
 */

/**
 * @typedef {z.infer<typeof SpreadSummarySchema>} SpreadSummary
 * Combined spread economics across both legs.
 */

/**
 * @typedef {z.infer<typeof BacktestEpisodeSchema>} BacktestEpisode
 * One historical dislocation episode.
 */

/**
 * @typedef {z.infer<typeof BacktestEvidenceSchema>} BacktestEvidence
 * Aggregate PIT/LOO backtest statistics.
 */

/**
 * @typedef {z.infer<typeof PnlPointSchema>} PnlPoint
 * One point on the P&L vs. repair-amount chart.
 */

/**
 * @typedef {z.infer<typeof LegDepthSchema>} LegDepth
 * Order-book depth snapshot for one spread leg.
 */

/**
 * @typedef {z.infer<typeof SpreadBuilderSchema>} SpreadBuilder
 * Full Spread Builder payload for one family.
 */

/**
 * @typedef {z.infer<typeof SpreadResponseSchema>} SpreadResponse
 * GET /api/spread/{familySlug} response.
 */

/**
 * @typedef {z.infer<typeof DepthResponseSchema>} DepthResponse
 * GET /api/depth/{conditionId} response.
 */
