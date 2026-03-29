// ── Spread analytics: σ normalization + PIT backtest + LOO validation ─────────

// ── Helpers ───────────────────────────────────────────────────────────────────

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function percentile(sorted, p) {
  const idx = Math.max(0, Math.floor(sorted.length * p) - 1);
  return sorted[idx];
}

// ── Spread series alignment ───────────────────────────────────────────────────

/**
 * Align two price series by day bucket and compute the structural spread.
 * Each series is Array<{t: ms, p: number}>.
 * Returns Array<{t: ms, spread: number}> sorted ascending.
 */
export function buildSpreadSeries(seriesA, seriesB) {
  // Bucket to midnight UTC of each day
  const bucket = (ms) => Math.floor(ms / 86_400_000) * 86_400_000;

  const mapB = new Map();
  for (const pt of seriesB) {
    mapB.set(bucket(pt.t), pt.p);
  }

  const result = [];
  for (const pt of seriesA) {
    const key = bucket(pt.t);
    if (mapB.has(key)) {
      result.push({ t: key, spread: pt.p - mapB.get(key) });
    }
  }

  result.sort((a, b) => a.t - b.t);
  return result;
}

// ── σ score ───────────────────────────────────────────────────────────────────

/**
 * Compute the σ score for the current dislocation.
 * σ = |currentDislocation| / std(historicalSpread)
 * Returns null if insufficient data.
 */
export function computeSigmaScore(spreadSeries, currentDislocation) {
  if (!spreadSeries || spreadSeries.length < 5) return null;
  const spreads = spreadSeries.map((pt) => pt.spread);
  const std = stdDev(spreads);
  if (!std || std < 1e-6) return null;
  return Math.abs(currentDislocation) / std;
}

// ── PIT episode detection ─────────────────────────────────────────────────────

/**
 * Detect historical dislocation episodes using point-in-time σ (no lookahead).
 *
 * At each bar t, σ_t is computed using only spread[0..t-1].
 * Trigger: σ_t >= triggerSigma
 * Close:   σ_t <= closeSigma  OR  duration >= maxDays
 *
 * Each returned episode includes entryIdx/closeIdx and entryT/closeT so callers
 * can annotate charts without a second pass.
 */
export function detectEpisodes(spreadSeries, { triggerSigma = 2, closeSigma = 0.5, maxDays = 7 } = {}) {
  const episodes = [];
  let inEpisode = false;
  let entry = null;

  for (let i = 5; i < spreadSeries.length; i++) {
    const history = spreadSeries.slice(0, i).map((p) => p.spread);
    const std = stdDev(history);
    if (!std || std < 1e-6) continue;

    const sigma = spreadSeries[i].spread / std;

    if (!inEpisode && sigma >= triggerSigma) {
      inEpisode = true;
      entry = {
        idx: i,
        t: spreadSeries[i].t,
        spread: spreadSeries[i].spread,
        sigma,
      };
    } else if (inEpisode) {
      const durationDays = (spreadSeries[i].t - entry.t) / 86_400_000;
      if (sigma <= closeSigma || durationDays >= maxDays) {
        episodes.push({
          entryIdx: entry.idx,
          closeIdx: i,
          entryT: entry.t,
          closeT: spreadSeries[i].t,
          entrySpread: entry.spread,
          closeSpread: spreadSeries[i].spread,
          entrySigma: entry.sigma,
          durationDays,
          timedOut: sigma > closeSigma,
        });
        inEpisode = false;
        entry = null;
      }
    }
  }
  return episodes;
}

/**
 * Compute P&L (per $100 at risk) for one episode.
 * profit = (entrySpread - closeSpread) * 100 - friction * 100
 */
export function episodePnl(ep, frictionFrac = 0.02) {
  return (ep.entrySpread - ep.closeSpread) * 100 - frictionFrac * 100;
}

// ── Full PIT backtest + LOO ───────────────────────────────────────────────────

/**
 * Run PIT backtest with leave-one-out win validation.
 *
 * @param {Array<{t,spread}>} spreadSeries - 30d daily aligned spread
 * @param {number} frictionFrac            - friction as fraction (e.g. 0.02)
 * @returns backtest result object or null if insufficient data
 */
export function runBacktest(spreadSeries, frictionFrac = 0.02) {
  if (!spreadSeries || spreadSeries.length < 10) return null;

  const episodes = detectEpisodes(spreadSeries);
  if (episodes.length === 0) {
    return {
      episodes: 0,
      confidence: "insufficient",
      looWins: 0,
      looWinRate: null,
      medianPnl: null,
      p25Pnl: null,
      worstLoss: null,
    };
  }

  const pnls = episodes.map((ep) => episodePnl(ep, frictionFrac));

  // LOO: for episode i, recompute σ using spread history excluding episode i's
  // trigger bar. A "LOO win" = episode would still have triggered (σ >= 2) AND
  // P&L was positive under the excluded threshold.
  let looWins = 0;
  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    // Approximate LOO: recompute std excluding the entry bar's contribution.
    // We use all bars except the one that triggered, then recheck σ.
    const otherSpreads = spreadSeries
      .filter((_, idx) => idx !== i + 5) // rough exclusion of entry bar
      .map((p) => p.spread);

    if (otherSpreads.length < 5) {
      if (pnls[i] > 0) looWins++;
      continue;
    }
    const looStd = stdDev(otherSpreads);
    if (!looStd || looStd < 1e-6) { if (pnls[i] > 0) looWins++; continue; }
    const looSigma = ep.entrySpread / looStd;
    if (looSigma >= 2 && pnls[i] > 0) looWins++;
  }

  const sorted = [...pnls].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const p25 = percentile(sorted, 0.25);
  const worst = sorted[0];

  const confidence = n >= 10 ? "high" : n >= 5 ? "moderate" : "low";

  return {
    episodes: n,
    confidence,
    looWins,
    looWinRate: looWins / n,
    medianPnl: median,
    p25Pnl: p25,
    worstLoss: worst,
  };
}
