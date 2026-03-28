/**
 * @file schemas/gamma.js
 *
 * Zod schemas for the raw Polymarket Gamma API responses.
 *
 * Endpoints covered:
 *   GET https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100
 *   GET https://gamma-api.polymarket.com/markets
 *
 * These schemas describe exactly what arrives over the wire before any
 * enrichment or classification is applied.  They are intentionally
 * permissive where the API sometimes omits optional fields, but strict
 * enough to catch structural regressions early.
 *
 * Usage:
 *   import { GammaEventSchema, GammaEventsResponseSchema } from "@/lib/schemas/gamma";
 *   const parsed = GammaEventsResponseSchema.parse(rawJson);
 */

import { z } from "zod";

// ── Primitive helpers ─────────────────────────────────────────────────────────

/**
 * Gamma sometimes returns numeric fields as strings (e.g. volume = "12345.67").
 * This coerces either representation to a JS number.
 */
const numericString = z
  .union([z.string(), z.number()])
  .transform((v) => parseFloat(String(v)))
  .refine((v) => !isNaN(v), { message: "Expected a numeric value" });

/**
 * outcomePrices arrives as either a JSON string ("[\"0.62\",\"0.38\"]") or a
 * plain array of numeric strings.  Both forms are normalised to string[].
 */
const outcomePricesField = z
  .union([
    z.string().transform((s) => {
      try {
        const parsed = JSON.parse(s);
        return z.array(z.string()).parse(parsed);
      } catch {
        return [];
      }
    }),
    z.array(z.string()),
  ])
  .describe(
    "Ordered outcome prices, index 0 = YES price, index 1 = NO price.  " +
      "Values are string-encoded decimals in the range [0, 1]."
  );

/**
 * clobTokenIds works the same way: JSON string or plain array.
 * Index 0 = YES token, index 1 = NO token.
 */
const clobTokenIdsField = z
  .union([
    z.string().transform((s) => {
      try {
        const parsed = JSON.parse(s);
        return z.array(z.string()).parse(parsed);
      } catch {
        return [];
      }
    }),
    z.array(z.string()),
  ])
  .describe(
    "CLOB token IDs used to fetch order-book depth.  " +
      "Index 0 = YES token ID, index 1 = NO token ID."
  );

// ── GammaMarketSchema ─────────────────────────────────────────────────────────

/**
 * A single Polymarket market as returned by the Gamma API.
 *
 * Markets appear both as top-level rows from GET /markets and as nested
 * objects inside each event from GET /events.
 */
export const GammaMarketSchema = z
  .object({
    // ── Identity ──────────────────────────────────────────────────────────
    /** Stable unique identifier.  Links to the CLOB API. */
    conditionId: z.string(),

    /** Internal numeric id (not always present in nested contexts). */
    id: z.string().optional(),

    /** URL slug for deep-linking to polymarket.com/event/[slug]. */
    slug: z.string().optional(),

    // ── Question text ─────────────────────────────────────────────────────
    /**
     * The human-readable question for this market.
     * At least one of question / groupItemTitle / title will be present.
     */
    question: z.string().optional(),

    /**
     * Alternative question label used in multi-market events.
     * Preferred over `question` when classifying strike ladders or expiry
     * curves because it omits the parent event preamble.
     */
    groupItemTitle: z.string().optional(),

    /** Fallback title field occasionally returned instead of question. */
    title: z.string().optional(),

    // ── Pricing ───────────────────────────────────────────────────────────
    /**
     * Current mid-market prices for each outcome.
     * Normalised to string[] after parsing — index 0 = YES, index 1 = NO.
     * Values are decimals in [0, 1].
     */
    outcomePrices: outcomePricesField,

    /**
     * Current bid/ask spread as a decimal.
     * Used as the friction proxy in spread sizing calculations.
     * May be absent for illiquid markets.
     */
    spread: z.number().min(0).max(1).optional(),

    // ── Volume & liquidity ────────────────────────────────────────────────
    /**
     * Total traded volume in USD (sometimes returned as a string).
     * Markets below $500 volume are filtered out before family detection.
     */
    volume: numericString.optional(),

    /** Volume traded in the last 24 hours (USD). */
    volume24hr: numericString.optional(),

    /** Current open interest in USD. */
    openInterest: numericString.optional(),

    /** Best available bid price (decimal). */
    bestBid: numericString.optional(),

    /** Best available ask price (decimal). */
    bestAsk: numericString.optional(),

    // ── Lifecycle ─────────────────────────────────────────────────────────
    /** Market is open for trading and has not yet resolved. */
    active: z.boolean(),

    /** Market has been resolved and is no longer tradeable. */
    closed: z.boolean(),

    /** ISO 8601 datetime string for when the market resolves/resolved. */
    endDate: z.string().datetime({ offset: true }).optional(),

    /** ISO 8601 datetime string for market creation. */
    startDate: z.string().datetime({ offset: true }).optional(),

    // ── CLOB linking ──────────────────────────────────────────────────────
    /**
     * Token IDs used to call clob.polymarket.com/book.
     * Normalised to string[] — index 0 = YES token, index 1 = NO token.
     */
    clobTokenIds: clobTokenIdsField.optional(),

    // ── Outcome labels ────────────────────────────────────────────────────
    /**
     * Human-readable outcome labels matching the outcomePrices array.
     * Typically ["Yes", "No"] for binary markets.
     * Stored as a JSON string by some Gamma endpoints.
     */
    outcomes: z
      .union([
        z.string().transform((s) => {
          try {
            return JSON.parse(s);
          } catch {
            return [];
          }
        }),
        z.array(z.string()),
      ])
      .optional(),

    // ── Metadata ──────────────────────────────────────────────────────────
    /** Image URL for this market (used in the Polymarket UI, not Snapback). */
    image: z.string().url().optional(),

    /** Icon URL. */
    icon: z.string().url().optional(),

    /** Short description of the market. */
    description: z.string().optional(),

    /** Resolution source URL or text. */
    resolutionSource: z.string().optional(),

    /** ID of the parent event this market belongs to. */
    eventId: z.string().optional(),
  })
  .describe(
    "Raw Gamma API market object.  Enrichment (yesPrice, family " +
      "classification) is applied downstream in the lib layer."
  );

/** TypeScript-equivalent inferred type for a raw Gamma market. */
export const GammaMarketType = GammaMarketSchema;

// ── GammaEventSchema ──────────────────────────────────────────────────────────

/**
 * A Polymarket event as returned by GET /events.
 *
 * An event is the grouping mechanism: one event contains one or more markets
 * that share a common question umbrella.  The markets array is what Snapback
 * uses to detect market families (strike ladders, expiry curves, mutex sets).
 */
export const GammaEventSchema = z
  .object({
    // ── Identity ──────────────────────────────────────────────────────────
    /** Stable unique identifier for this event. */
    id: z.string(),

    /** URL slug — used to build deep-links and as the family's eventSlug. */
    slug: z.string(),

    // ── Display ───────────────────────────────────────────────────────────
    /**
     * Human-readable event title.
     * Parsed to classify family type (e.g. numeric thresholds → strike ladder).
     * Also used as the scanner row's `family` display name.
     */
    title: z.string(),

    /** Longer description of the event. */
    description: z.string().optional(),

    /** Category label (e.g. "Crypto", "Politics", "Sports"). */
    category: z.string().optional(),

    /** Sub-category label. */
    subCategory: z.string().optional(),

    /** Cover image URL. */
    image: z.string().url().optional(),

    /** Icon URL. */
    icon: z.string().url().optional(),

    // ── Lifecycle ─────────────────────────────────────────────────────────
    /** True if the event is currently open for trading. */
    active: z.boolean().optional(),

    /** True if all markets in this event have resolved. */
    closed: z.boolean().optional(),

    /** ISO 8601 datetime for when the event starts (or started). */
    startDate: z.string().datetime({ offset: true }).optional(),

    /** ISO 8601 datetime for when the event is expected to end. */
    endDate: z.string().datetime({ offset: true }).optional(),

    // ── Markets ───────────────────────────────────────────────────────────
    /**
     * All markets belonging to this event.
     * Snapback filters this array to active, non-closed, liquid markets
     * before running family classification and dislocation math.
     */
    markets: z.array(GammaMarketSchema).default([]),

    // ── Volume aggregates ─────────────────────────────────────────────────
    /** Total volume across all markets in this event (USD). */
    volume: numericString.optional(),

    /** 24-hour volume across all markets in this event (USD). */
    volume24hr: numericString.optional(),

    /** Liquidity (open interest) across all markets (USD). */
    liquidity: numericString.optional(),

    // ── Resolution ────────────────────────────────────────────────────────
    /** Comment or URL describing how the event resolves. */
    resolutionSource: z.string().optional(),

    /** Which market (conditionId) is considered the "featured" one. */
    featuredMarketId: z.string().optional(),
  })
  .describe(
    "Raw Gamma API event object.  Snapback treats events as the unit of " +
      "family discovery: each event with 2+ active liquid markets is a " +
      "candidate for strike-ladder / expiry-curve / mutex classification."
  );

// ── Response envelopes ────────────────────────────────────────────────────────

/**
 * GET /events can return either a bare array or an object with an `events`
 * key.  Both forms are normalised by fetchFamilies() before processing.
 *
 * Example — bare array form:
 *   [ { id: "...", title: "...", markets: [...] }, ... ]
 *
 * Example — wrapped form:
 *   { events: [ { id: "...", ... } ], count: 42, next_cursor: "..." }
 */
export const GammaEventsResponseSchema = z
  .union([
    z.array(GammaEventSchema),
    z.object({
      events: z.array(GammaEventSchema),
      /** Total count of events matching the query (for pagination). */
      count: z.number().optional(),
      /** Cursor for the next page of results. */
      next_cursor: z.string().optional(),
    }),
  ])
  .describe(
    "GET gamma-api.polymarket.com/events response.  " +
      "Two envelope shapes observed in the wild — validate both."
  );

/**
 * GET /markets returns a flat array of market objects.
 *
 * Query parameters of interest:
 *   ?active=true&closed=false&limit=500&offset=0
 *   &order=volume&ascending=false     (sort by volume DESC)
 *
 * Pagination is offset-based.  Snapback currently uses /events for
 * discovery (which bundles markets in one call), falling back to
 * /markets only when event nesting is not available.
 */
export const GammaMarketsResponseSchema = z
  .union([
    z.array(GammaMarketSchema),
    z.object({
      markets: z.array(GammaMarketSchema),
      count: z.number().optional(),
      next_cursor: z.string().optional(),
    }),
  ])
  .describe(
    "GET gamma-api.polymarket.com/markets response.  " +
      "Used to refresh prices independently of family structure."
  );

// ── Convenience re-exports of inferred JS types (via JSDoc) ───────────────────

/**
 * @typedef {z.infer<typeof GammaMarketSchema>} GammaMarket
 * Raw market object as received from the Gamma API.
 */

/**
 * @typedef {z.infer<typeof GammaEventSchema>} GammaEvent
 * Raw event object as received from the Gamma API.
 */

/**
 * @typedef {z.infer<typeof GammaEventsResponseSchema>} GammaEventsResponse
 * Full GET /events response (either bare array or wrapped object).
 */

/**
 * @typedef {z.infer<typeof GammaMarketsResponseSchema>} GammaMarketsResponse
 * Full GET /markets response.
 */
