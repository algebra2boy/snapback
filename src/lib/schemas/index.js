/**
 * @file schemas/index.js
 *
 * Central barrel export for all Snapback Zod schemas.
 *
 * Import any schema directly from this file instead of drilling into
 * individual modules:
 *
 *   import {
 *     ScannerRowSchema,
 *     SpreadBuilderSchema,
 *     GammaEventSchema,
 *   } from "@/lib/schemas";
 *
 * Module map
 * ──────────
 *   gamma.js   — Raw Polymarket Gamma API response shapes
 *                (/events, /markets)
 *
 *   clob.js    — Raw Polymarket CLOB API response shapes
 *                (/prices-history, /book) + derived order-book metrics
 *
 *   market.js  — Enriched market objects and computed dislocation shapes
 *                (MarketWithPrice, Dislocation, FamilyType, Status,
 *                 DislocationSeverity, NoArbEnvelope)
 *
 *   family.js  — Scanner family row schema and API response envelope
 *                (ScannerRow, ScannerSummary, ScannerResponse)
 *
 *   spread.js  — Spread Builder schemas
 *                (SpreadLeg, SpreadSummary, BacktestEvidence,
 *                 PnlPoint, LegDepth, SpreadBuilder,
 *                 SpreadResponse, DepthResponse)
 */

// ── Gamma API (raw wire format) ───────────────────────────────────────────────

export {
  /** Coercing helpers used internally — exported for custom extensions. */

  /** Single market object from GET /markets or nested in GET /events. */
  GammaMarketSchema,

  /** Alias for GammaMarketSchema (kept for IDE discoverability). */
  GammaMarketType,

  /** Single event object from GET /events. */
  GammaEventSchema,

  /**
   * Full GET /events response — handles both bare-array and wrapped-object
   * envelope shapes observed in the wild.
   */
  GammaEventsResponseSchema,

  /**
   * Full GET /markets response — handles both bare-array and wrapped-object
   * envelope shapes.
   */
  GammaMarketsResponseSchema,
} from "./gamma";

// ── CLOB API (raw wire format + derived metrics) ──────────────────────────────

export {
  /** One price bar { t: unixSeconds, p: 0–1 } from GET /prices-history. */
  PricePointSchema,

  /** Full GET /prices-history response ({ history: PricePoint[] }). */
  PriceHistoryResponseSchema,

  /** One price level { price, size } from GET /book (coerced to numbers). */
  OrderBookLevelSchema,

  /** Full GET /book response ({ bids, asks }). */
  OrderBookResponseSchema,

  /**
   * Computed statistics derived from a single market's /prices-history.
   * Contains barCount, trailingStd, and hasMinimumBars (≥ 20 bar gate).
   * Used as the denominator in sigma severity calculations (Phase 2).
   */
  PriceHistorySummarySchema,

  /**
   * Enriched order-book snapshot with derived metrics:
   * bestBid, bestAsk, midPrice, topOfBookSpread, bid/askDepthUsd.
   * Produced from OrderBookResponseSchema; never cached.
   */
  OrderBookSnapshotSchema,
} from "./clob";

// ── Enriched market objects and computed dislocation shapes ───────────────────

export {
  /**
   * Union of the four structural family type strings.
   * "Strike ladder" | "Expiry curve" | "Mutex set" | "Nested"
   */
  FamilyTypeSchema,

  /**
   * Signal status derived from dislocation magnitude.
   * "Actionable" | "Watchlist" | "Normal"
   */
  StatusSchema,

  /**
   * Raw Gamma market extended with a computed yesPrice field (decimal [0,1]).
   * The canonical market representation throughout the app.
   */
  MarketWithPriceSchema,

  /**
   * Tuple [low, high] of the two markets producing the maximum violation.
   * Null for mutex sets (overpricing is aggregate, not pair-wise).
   */
  ViolatingPairSchema,

  /**
   * Full result of computeDislocation():
   * rawDislocation, sorted, labels, violatingPair, constraintDesc, sum.
   * Attached to ScannerRow and consumed by chart, hero panel, and spread builder.
   */
  DislocationSchema,

  /**
   * Sigma-normalised severity — Phase 2, not yet wired in.
   * sigma, trailingStd, barCount, hasMinimumBars, sigmaStatus.
   * Requires CLOB /prices-history integration.
   */
  DislocationSeveritySchema,

  /**
   * Output of computeNoArbEnvelope():
   * prices (cents), envelope (cents), colors ("#378ADD" | "#FF5000"),
   * violationCount.
   * Fed directly into Chart.js strike/expiry chart datasets.
   */
  NoArbEnvelopeResultSchema,
} from "./market";

// ── Scanner family rows and API response envelope ─────────────────────────────

export {
  /**
   * One row in the dislocation scanner — the primary data unit consumed
   * by the sidebar, hero panel, stats bar, and spread builder.
   *
   * Key fields:
   *   family, eventSlug, type, typeCls
   *   rawDislocation, severity, severityCls
   *   sigmaSeverity, sigmaDetail  (null until Phase 2)
   *   status, statusCls, constraint
   *   markets[], labels[]
   *   dislocation (DislocationSchema)
   *   isSeed
   */
  ScannerRowSchema,

  /**
   * Aggregate counts shown in the nav bar:
   * totalFamilies, dislocatedCount, actionableCount, watchlistCount, hasSeedRows.
   */
  ScannerSummarySchema,

  /**
   * Full GET /api/families response:
   * { rows: ScannerRow[], summary: ScannerSummary,
   *   defaultHeroIndex: number | null, meta: { fetchedAt, isLive, isSeed, … } }
   */
  ScannerResponseSchema,
} from "./family";

// ── Spread Builder ────────────────────────────────────────────────────────────

export {
  /**
   * Token side purchased on a spread leg.
   * "YES" | "NO"
   */
  LegSideSchema,

  /**
   * Structural role of a spread leg.
   * "BUY_YES_ON_CHEAP" | "BUY_NO_ON_DEAR"
   */
  LegDirectionSchema,

  /**
   * One leg of the corrective spread.
   * Fields: conditionId, tokenId, question, side, direction,
   *         tokenPrice, yesPrice, shares*, cost*, maxGain*,
   *         frictionUsd*, isFillable*
   * (* = placeholder until CLOB /book is wired in)
   */
  SpreadLegSchema,

  /**
   * Combined economics across both legs.
   * Fields: netCost, allInFriction, frictionMultiplier, frictionNote,
   *         breakEvenRepair, edgeAfterSpread, evPer100*, targetRiskPerLeg
   * (* = placeholder)
   */
  SpreadSummarySchema,

  /**
   * One historical dislocation episode (Phase 2 — PIT/LOO backtest).
   * Fields: episodeId, entryDislocation, entryTs, closeDislocation, closeTs,
   *         durationDays, pnlPer100, isWin, isLoo, pnlPer100Harsh
   */
  BacktestEpisodeSchema,

  /**
   * Aggregate PIT/LOO backtest evidence for one family.
   * Fields: episodes, looTotal, looWins, winRate, medianPnlPer100,
   *         p25PnlPer100, worstLoss, bestGain, frictionMultiplier,
   *         frictionLabel, confidence, noTradeGate, noTradeReason,
   *         isLive, historyWindowEnd, barCount, episodes_detail
   */
  BacktestEvidenceSchema,

  /**
   * One point on the P&L vs. repair-amount chart.
   * Fields: repairPct (pp, not decimal), netPnl (USD), netPnlHarsh
   */
  PnlPointSchema,

  /**
   * Order-book depth snapshot for one spread leg (Phase 2, on demand).
   * Fields: conditionId, tokenId, side, bestPrice, topOfBookSpread,
   *         availableShares, dwapPrice, slippage, fetchedAt
   */
  LegDepthSchema,

  /**
   * Full Spread Builder payload for one family.
   * Fields: familySlug, legA, legB, summary, evidence, pnlCurve,
   *         depth (nullable), isPlaceholder, placeholderSections, computedAt
   */
  SpreadBuilderSchema,

  /**
   * GET /api/spread/{familySlug} response envelope.
   * { data: SpreadBuilder, meta: { generatedAt, dislocationAtCompute, ttlSeconds } }
   */
  SpreadResponseSchema,

  /**
   * GET /api/depth/{conditionId} response envelope (on-demand, never cached).
   * { data: { legA: LegDepth, legB: LegDepth }, meta: { fetchedAt, tokenIds, … } }
   */
  DepthResponseSchema,
} from "./spread";
