// Polymarket CLOB API integration
// Docs: https://docs.polymarket.com/#prices-history

const CLOB_BASE = import.meta.env.DEV
  ? "/api/clob"
  : "https://clob.polymarket.com";

/**
 * Fetch price history for a single CLOB token (YES token ID).
 * @param {string} tokenId - The clobTokenId (YES outcome token)
 * @param {object} opts
 * @param {number} opts.hoursBack - How many hours of history to fetch (default 48)
 * @param {number} opts.fidelity  - Candle size in minutes (default 60)
 * @returns {Promise<Array<{t: number, p: number}>>} Array of {t: ms timestamp, p: probability 0-1}
 */
export async function fetchPriceHistory(tokenId, { hoursBack = 48, fidelity = 60 } = {}) {
  const eTs = Math.floor(Date.now() / 1000);
  const sTs = eTs - hoursBack * 3600;
  const url = `${CLOB_BASE}/prices-history?market=${tokenId}&startTs=${sTs}&endTs=${eTs}&fidelity=${fidelity}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`CLOB /prices-history returned ${res.status}`);
  const json = await res.json();
  return (json.history ?? []).map((pt) => ({
    t: pt.t * 1000,          // convert to ms
    p: parseFloat(pt.p),     // probability 0–1
  }));
}
