// Polymarket CLOB API integration
// Docs: https://docs.polymarket.com/#prices-history

const CLOB_BASE = "/api/clob";

/**
 * Fetch the order book for a single CLOB token (YES token ID).
 * @param {string} tokenId - The clobTokenId (YES outcome token)
 * @returns {Promise<{bids, asks, topBid, topAsk, mid, spread}>}
 *   bids/asks sorted best-first; prices in [0,1]; spread = topAsk - topBid
 */
export async function fetchOrderBook(tokenId) {
  const url = `${CLOB_BASE}/book?token_id=${tokenId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`CLOB /book returned ${res.status}`);
  const json = await res.json();

  const bids = (json.bids ?? [])
    .map((b) => ({ price: parseFloat(b.price), size: parseFloat(b.size) }))
    .sort((a, b) => b.price - a.price);
  const asks = (json.asks ?? [])
    .map((a) => ({ price: parseFloat(a.price), size: parseFloat(a.size) }))
    .sort((a, b) => a.price - b.price);

  const topBid = bids[0]?.price ?? null;
  const topAsk = asks[0]?.price ?? null;
  const mid = topBid != null && topAsk != null ? (topBid + topAsk) / 2 : null;
  const spread = topBid != null && topAsk != null ? topAsk - topBid : null;

  return { bids, asks, topBid, topAsk, mid, spread };
}

/**
 * Fetch 30-day daily price history for two tokens and return both series.
 * Used for σ normalization and PIT backtest.
 * @param {string} tokenA
 * @param {string} tokenB
 * @returns {Promise<{ seriesA, seriesB }>}
 */
export async function fetch30dHistory(tokenA, tokenB) {
  const [seriesA, seriesB] = await Promise.all([
    fetchPriceHistory(tokenA, { hoursBack: 720, fidelity: 1440 }),
    fetchPriceHistory(tokenB, { hoursBack: 720, fidelity: 1440 }),
  ]);
  return { seriesA, seriesB };
}

/**
 * Fetch price history for a single CLOB token (YES token ID).
 * @param {string} tokenId - The clobTokenId (YES outcome token)
 * @param {object} opts
 * @param {number} opts.hoursBack - How many hours of history to fetch (default 48)
 * @param {number} opts.fidelity  - Candle size in minutes (default 60)
 * @returns {Promise<Array<{t: number, p: number}>>} Array of {t: ms timestamp, p: probability 0-1}
 */
export async function fetchPriceHistory(
  tokenId,
  { hoursBack = 48, fidelity = 60 } = {},
) {
  const eTs = Math.floor(Date.now() / 1000);
  const sTs = eTs - hoursBack * 3600;
  const url = `${CLOB_BASE}/prices-history?market=${tokenId}&startTs=${sTs}&endTs=${eTs}&fidelity=${fidelity}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`CLOB /prices-history returned ${res.status}`);
  const json = await res.json();
  return (json.history ?? []).map((pt) => ({
    t: pt.t * 1000, // convert to ms
    p: parseFloat(pt.p), // probability 0–1
  }));
}
