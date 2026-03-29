// Polymarket Gamma API integration
// Docs: gamma-api.polymarket.com/events + gamma-api.polymarket.com/markets

const GAMMA_BASE = "/api/gamma";

// ── Field helpers ─────────────────────────────────────────────────────────────

export function getQuestion(market) {
  return market.question || market.groupItemTitle || market.title || "";
}

// Returns the YES-outcome CLOB token ID for a market, or null if unavailable.
export function getClobTokenId(market) {
  try {
    const ids = Array.isArray(market.clobTokenIds)
      ? market.clobTokenIds
      : JSON.parse(market.clobTokenIds || "[]");
    return ids[0] ?? null;
  } catch {
    return null;
  }
}

export function parseYesPrice(market) {
  try {
    const prices = Array.isArray(market.outcomePrices)
      ? market.outcomePrices
      : JSON.parse(market.outcomePrices || "[]");
    const p = parseFloat(prices[0] ?? 0);
    return isNaN(p) ? 0 : p;
  } catch {
    return 0;
  }
}

// ── Strike / date extraction ──────────────────────────────────────────────────

export function extractStrike(question) {
  // Match "$80k", "$80,000", ">$80k", "above $80k", "80000"
  const match = question.match(/\$?([\d,]+)\s*([km]?)/i);
  if (!match) return null;
  let val = parseFloat(match[1].replace(/,/g, ""));
  const suffix = match[2].toLowerCase();
  if (suffix === "k") val *= 1_000;
  if (suffix === "m") val *= 1_000_000;
  return val;
}

function formatStrike(val) {
  if (!val) return "?";
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}k`;
  return `$${val}`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function extractMonthIndex(question) {
  const q = question.toLowerCase();
  const short = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const long = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  for (let i = 0; i < 12; i++) {
    if (q.includes(long[i]) || q.includes(short[i])) return i;
  }
  return -1;
}

// ── Family classification ─────────────────────────────────────────────────────

export function classifyFamilyType(markets) {
  const questions = markets.map((m) => getQuestion(m).toLowerCase());

  // Strike ladder: 2+ markets with numeric price thresholds ($80k, $90k, etc.)
  const strikeCount = questions.filter((q) =>
    /\$[\d,]+\s*[km]?\b/.test(q),
  ).length;
  if (strikeCount >= 2) return "Strike ladder";

  // Expiry curve: 2+ markets whose titles differ only by month/date
  const monthSet = new Set(
    questions.map((q) => extractMonthIndex(q)).filter((i) => i >= 0),
  );
  if (monthSet.size >= 2) return "Expiry curve";

  // Mutex: 3+ named outcomes (candidates, teams, etc.)
  if (markets.length >= 3) return "Mutex set";

  return "Mutex set";
}

// ── Dislocation computation ───────────────────────────────────────────────────

// Returns: { rawDislocation, violatingPair, sorted, labels, constraintDesc }
// rawDislocation is in [0, 1] — percentage points expressed as decimal (0.04 = 4pp)
export function computeDislocation(markets, familyType) {
  const priced = markets
    .map((m) => ({ ...m, yesPrice: parseYesPrice(m) }))
    .filter((m) => m.yesPrice > 0.01 && m.yesPrice < 0.99);

  if (priced.length < 2) return null;

  // ── Strike ladder ──
  if (familyType === "Strike ladder") {
    const sorted = [...priced].sort(
      (a, b) =>
        (extractStrike(getQuestion(a)) ?? 0) -
        (extractStrike(getQuestion(b)) ?? 0),
    );

    let maxViolation = 0;
    let violatingPair = null;

    for (let i = 0; i < sorted.length - 1; i++) {
      // P(above lower strike) >= P(above higher strike) — violation when higher > lower
      const violation = sorted[i + 1].yesPrice - sorted[i].yesPrice;
      if (violation > maxViolation) {
        maxViolation = violation;
        violatingPair = [sorted[i], sorted[i + 1]];
      }
    }

    const labels = sorted.map((m) =>
      formatStrike(extractStrike(getQuestion(m))),
    );
    return {
      rawDislocation: maxViolation,
      violatingPair,
      sorted,
      labels,
      constraintDesc: `P(${labels[labels.length - 1]}) ≤ … ≤ P(${labels[0]})`,
    };
  }

  // ── Expiry curve ──
  if (familyType === "Expiry curve") {
    const sorted = [...priced].sort(
      (a, b) =>
        extractMonthIndex(getQuestion(a)) - extractMonthIndex(getQuestion(b)),
    );

    let maxViolation = 0;
    let violatingPair = null;

    for (let i = 0; i < sorted.length - 1; i++) {
      // Near expiry should be cheaper than far expiry — violation when near > far
      const violation = sorted[i].yesPrice - sorted[i + 1].yesPrice;
      if (violation > maxViolation) {
        maxViolation = violation;
        violatingPair = [sorted[i], sorted[i + 1]];
      }
    }

    const labels = sorted.map((m) => {
      const idx = extractMonthIndex(getQuestion(m));
      return idx >= 0 ? MONTH_NAMES[idx] : getQuestion(m).slice(0, 8);
    });

    return {
      rawDislocation: maxViolation,
      violatingPair,
      sorted,
      labels,
      constraintDesc:
        labels.length >= 2
          ? `P(by ${labels[0]}) ≤ P(by ${labels[labels.length - 1]})`
          : "",
    };
  }

  // ── Mutex set ──
  if (familyType === "Mutex set") {
    const sum = priced.reduce((acc, m) => acc + m.yesPrice, 0);
    const overpricing = Math.max(0, sum - 1.0);
    const sorted = [...priced].sort((a, b) => b.yesPrice - a.yesPrice);

    // violatingPair = the two most overpriced outcomes — best NO candidates
    const violatingPair = sorted.length >= 2 ? [sorted[0], sorted[1]] : null;

    return {
      rawDislocation: overpricing,
      sum,
      violatingPair,
      sorted,
      labels: sorted.map((m) => getQuestion(m).slice(0, 22)),
      constraintDesc: `Σ outcomes ≈ 1.00 (current: ${sum.toFixed(2)})`,
    };
  }

  return null;
}

// ── No-arb envelope for the strike chart ─────────────────────────────────────

// For each point i, the upper bound is min(all prices at j < i).
// A violation is when prices[i] > noArbEnvelope[i].
export function computeNoArbEnvelope(prices) {
  const envelope = [];
  let runMin = prices[0];
  for (let i = 0; i < prices.length; i++) {
    if (i === 0) {
      envelope.push(prices[0]);
    } else {
      envelope.push(runMin);
      runMin = Math.min(runMin, prices[i]);
    }
  }
  return envelope;
}

// ── Status / styling ──────────────────────────────────────────────────────────

export function getStatus(rawDislocation) {
  if (rawDislocation >= 0.04) return "Actionable";
  if (rawDislocation >= 0.02) return "Watchlist";
  return "Normal";
}

export const TYPE_CLS = {
  "Strike ladder": "bg-violet-100 text-violet-800",
  "Expiry curve": "bg-emerald-100 text-emerald-900",
  "Mutex set": "bg-orange-100 text-orange-900",
};

export const STATUS_CLS = {
  Actionable: "bg-emerald-100 text-emerald-800",
  Watchlist: "bg-amber-100 text-amber-800",
  Normal: "",
};

export const SEVERITY_CLS = {
  Actionable: "text-emerald-600",
  Watchlist: "text-amber-600",
  Normal: "text-muted-foreground",
};

// ── Seed fallback data ────────────────────────────────────────────────────────
// Shown when API is unavailable. Prices are zeroed out.

export const SEED_ROWS = [
  {
    family: "BTC price thresholds",
    type: "Strike ladder",
    typeCls: TYPE_CLS["Strike ladder"],
    severity: "—",
    rawDislocation: 0,
    severityCls: "text-muted-foreground",
    constraint: "P($100k) ≤ P($90k) ≤ P($80k)",
    status: "Normal",
    statusCls: "",
    markets: [],
    labels: ["$80k", "$90k", "$100k"],
    isSeed: true,
  },
  {
    family: "Fed rate hold by month",
    type: "Expiry curve",
    typeCls: TYPE_CLS["Expiry curve"],
    severity: "—",
    rawDislocation: 0,
    severityCls: "text-muted-foreground",
    constraint: "P(by Jul) ≥ P(by Jun) ≥ P(by May)",
    status: "Normal",
    statusCls: "",
    markets: [],
    labels: ["May", "Jun", "Jul"],
    isSeed: true,
  },
];

// ── Raw event fetch ───────────────────────────────────────────────────────────

/**
 * Fetch raw events from the Gamma API.
 * @param {object} opts
 * @param {boolean} opts.active   - Filter to active events only (default true)
 * @param {boolean} opts.closed   - Include closed events (default false)
 * @param {number}  opts.limit    - Max events to return (default 1000)
 * @returns {Promise<Array>} Raw event objects with nested markets[]
 */
export async function fetchEvents({
  active = true,
  closed = false,
  limit = 1000,
} = {}) {
  const params = new URLSearchParams({ active, closed, limit });
  const res = await fetch(`${GAMMA_BASE}/events?${params}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Gamma /events returned ${res.status}`);
  const raw = await res.json();
  return Array.isArray(raw) ? raw : (raw.events ?? []);
}

// ── Main fetch ────────────────────────────────────────────────────────────────

export async function fetchFamilies() {
  const events = await fetchEvents();

  const rows = [];

  for (const event of events) {
    if (!Array.isArray(event.markets)) continue;

    // Only active, liquid markets
    const active = event.markets.filter(
      (m) => m.active && !m.closed && parseFloat(m.volume ?? 0) > 500,
    );
    if (active.length < 2) continue;

    const familyType = classifyFamilyType(active);
    const dislocation = computeDislocation(active, familyType);
    if (!dislocation) continue;

    const { rawDislocation, constraintDesc, sorted, labels } = dislocation;
    const status = getStatus(rawDislocation);

    rows.push({
      family: event.title || event.slug || "Unknown",
      type: familyType,
      typeCls: TYPE_CLS[familyType] ?? "",
      // Show raw pp until CLOB history is wired in for sigma calculation
      severity: `${(rawDislocation * 100).toFixed(1)}pp`,
      rawDislocation,
      severityCls: SEVERITY_CLS[status],
      constraint: constraintDesc,
      status,
      statusCls: STATUS_CLS[status],
      markets: sorted ?? active,
      labels: labels ?? [],
      dislocation,
      eventSlug: event.slug,
    });
  }

  // Rank by dislocation magnitude, largest first
  return rows.sort((a, b) => b.rawDislocation - a.rawDislocation);
}
