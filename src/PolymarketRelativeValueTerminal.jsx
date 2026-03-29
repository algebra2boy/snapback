import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { Info, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  fetchFamilies,
  SEED_ROWS,
  computeNoArbEnvelope,
  getQuestion,
  getClobTokenId,
} from "@/lib/gammaApi";
import {
  fetchPriceHistory,
  fetchOrderBook,
  fetch30dHistory,
} from "@/lib/clobApi";
import {
  buildSpreadSeries,
  computeSigmaScore,
  detectEpisodes,
  episodePnl,
  runBacktest,
} from "@/lib/PITStats";

// ── P&L chart data (static until CLOB is wired in) ───────────────────────────
const REPAIR_PCTS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const PNL_DATA = REPAIR_PCTS.map((r) => {
  const legA = 263 * (r / 100);
  const legB = 172 * (r / 100);
  return Math.round((legA + legB - 4.82) * 100) / 100;
});
const SCANNER_PAGE_SIZE = 10;

const STATUS_FILTERS = ["all", "Actionable", "Watchlist", "Normal"];
const TYPE_FILTERS = ["all", "Strike ladder", "Expiry curve", "Mutex set"];

// ── Glossary ──────────────────────────────────────────────────────────────────
const GLOSSARY = [
  {
    term: "Family",
    def: "A group of markets that are logically linked — e.g. all BTC price-threshold markets, or all Fed rate-hold markets by month. Prices within a family must obey mathematical constraints by definition.",
  },
  {
    term: "Dislocation",
    def: "When prices inside a family break their logical ordering — for example, when a harder BTC target trades above an easier one. The size in points shows how far outside the rule the prices have moved.",
  },
  {
    term: "Points",
    def: "The raw gap between two prices. A 4-point dislocation means the prices are 4 cents apart on a 0 to 100 cent scale when they should not be.",
  },
  {
    term: "Actionable",
    def: "The dislocation is 4 points or more — large enough to likely cover transaction costs and still leave a margin after the spread closes.",
  },
  {
    term: "Watchlist",
    def: "The dislocation is between 2 and 4 points — notable, but it may not clear friction costs yet. Worth monitoring before trading.",
  },
  {
    term: "Normal",
    def: "The dislocation is under 2 points — within typical noise. No trade recommended.",
  },
  {
    term: "Strike ladder",
    def: "Markets with different numeric thresholds on the same underlying (e.g. BTC > $80k, > $90k, > $100k). Higher strikes must be cheaper — if they are not, there is an arb.",
  },
  {
    term: "Expiry curve",
    def: "Markets with the same outcome but different deadlines (e.g. Fed holds by May / June / July). If the near date resolves yes, the later one must also resolve yes, so the near market should never trade above the later one.",
  },
  {
    term: "No-arbitrage ceiling",
    def: "The maximum price each market can have without creating a risk-free arbitrage against its neighbours. Points above this line are the violation.",
  },
];

// ── Tooltip ───────────────────────────────────────────────────────────────────
function Tooltip({ text }) {
  return (
    <div className="relative group inline-flex">
      <Info className="size-3 text-muted-foreground/55 cursor-help" />
      <div className="pointer-events-none absolute bottom-full left-1/2 z-[80] mb-2 w-56 -translate-x-1/2 rounded-xl border border-border/80 bg-white/98 px-3 py-2 text-[11px] leading-relaxed text-popover-foreground opacity-0 shadow-[0_18px_48px_rgba(15,23,42,0.14)] transition-opacity group-hover:opacity-100">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
      </div>
    </div>
  );
}

function AxisLabel({ fullLabel, shortLabel }) {
  const isTruncated = fullLabel !== shortLabel;

  return (
    <div className="group relative min-w-0 px-1">
      <span className="block truncate text-center text-[11px] leading-4 text-slate-500">
        {shortLabel}
      </span>
      {isTruncated && (
        <div className="pointer-events-none absolute left-1/2 top-full z-40 mt-2 hidden w-48 -translate-x-1/2 rounded-xl border border-border/80 bg-white px-3 py-2 text-center text-[11px] leading-relaxed text-slate-700 shadow-[0_18px_48px_rgba(15,23,42,0.12)] group-hover:block">
          {fullLabel}
        </div>
      )}
    </div>
  );
}

// ── Stat cell (used in the horizontal stats bar) ──────────────────────────────
function StatCell({ label, value, valueCls, tooltip, border = true }) {
  return (
    <div
      className={`px-5 py-4 md:px-6 ${border ? "border-r border-border/80" : ""}`}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        {tooltip && <Tooltip text={tooltip} />}
      </div>
      <p
        className={`text-[15px] font-semibold tracking-[-0.02em] ${valueCls ?? ""}`}
      >
        {value ?? "—"}
      </p>
    </div>
  );
}

// ── Freshness badge ───────────────────────────────────────────────────────────
function FreshnessBadge({ dataAge, isSeed }) {
  if (isSeed)
    return (
      <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-600">
        Offline · seed data
      </span>
    );
  if (!dataAge) return null;
  const seconds = Math.floor((Date.now() - dataAge) / 1000);
  if (seconds < 60)
    return (
      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
        Live · {seconds}s ago
      </span>
    );
  return (
    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600">
      Cached · {Math.floor(seconds / 60)}m ago
    </span>
  );
}

// ── Replay modal ──────────────────────────────────────────────────────────────
function ReplayModal({ open, onClose, spreadSeries, heroFamily }) {
  const chartRef = useRef(null);
  const chartInst = useRef(null);

  const { episodes, pnls } = useMemo(() => {
    if (!spreadSeries || spreadSeries.length < 10)
      return { episodes: [], pnls: [] };
    const eps = detectEpisodes(spreadSeries);
    return { episodes: eps, pnls: eps.map((ep) => episodePnl(ep)) };
  }, [spreadSeries]);

  useEffect(() => {
    if (!open || !chartRef.current || !spreadSeries?.length) return;

    chartInst.current?.destroy();

    const grid = "rgba(148,163,184,0.18)";
    const txt = "rgba(71,85,105,0.92)";

    const labels = spreadSeries.map((pt) => {
      const d = new Date(pt.t);
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    });
    const spreads = spreadSeries.map((pt) => +(pt.spread * 100).toFixed(2));

    // Per-point visual overrides for entry/exit markers
    const pointRadii = spreadSeries.map(() => 0);
    const pointBg = spreadSeries.map(() => "transparent");
    const pointBorder = spreadSeries.map(() => "transparent");

    for (const ep of episodes) {
      if (ep.entryIdx < pointRadii.length) {
        pointRadii[ep.entryIdx] = 5;
        pointBg[ep.entryIdx] = "#ef4444";
        pointBorder[ep.entryIdx] = "#ef4444";
      }
      if (ep.closeIdx < pointRadii.length) {
        pointRadii[ep.closeIdx] = 5;
        pointBg[ep.closeIdx] = "#10b981";
        pointBorder[ep.closeIdx] = "#10b981";
      }
    }

    chartInst.current = new Chart(chartRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Spread (pp)",
            data: spreads,
            borderColor: "#378ADD",
            backgroundColor: "rgba(55,138,221,0.06)",
            borderWidth: 1.5,
            pointRadius: pointRadii,
            pointBackgroundColor: pointBg,
            pointBorderColor: pointBorder,
            pointBorderWidth: 2,
            tension: 0.2,
            fill: false,
          },
          {
            label: "Zero",
            data: spreadSeries.map(() => 0),
            borderColor: "rgba(100,116,139,0.35)",
            borderWidth: 1,
            borderDash: [5, 4],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#ffffff",
            titleColor: "#111827",
            bodyColor: "rgba(15,23,42,0.72)",
            borderColor: "rgba(15,23,42,0.1)",
            borderWidth: 1,
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              label: (ctx) => `Spread: ${ctx.parsed.y.toFixed(2)}pp`,
            },
          },
        },
        scales: {
          y: {
            grid: { color: grid },
            ticks: {
              color: txt,
              font: { size: 11 },
              callback: (v) => `${v.toFixed(1)}pp`,
            },
          },
          x: {
            grid: { display: false },
            ticks: {
              color: txt,
              font: { size: 11 },
              maxTicksLimit: 8,
              maxRotation: 0,
            },
          },
        },
      },
    });

    return () => {
      chartInst.current?.destroy();
      chartInst.current = null;
    };
  }, [open, spreadSeries, episodes]);

  if (!open) return null;

  const fmtDate = (ms) =>
    new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative flex w-full max-w-2xl flex-col rounded-2xl border border-border/80 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.18)]"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Episode replay
            </h2>
            {heroFamily && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {heroFamily.family} · 30-day spread history
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5">
          {!spreadSeries?.length ? (
            <p className="text-sm text-muted-foreground">
              Select a family with 30-day history loaded to view the replay.
            </p>
          ) : (
            <div className="space-y-5">
              {/* Legend */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-full bg-red-500" />
                  Entry (σ ≥ 2)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-full bg-emerald-500" />
                  Exit (σ ≤ 0.5 or 7d)
                </span>
              </div>

              {/* Chart */}
              <div className="h-52">
                <canvas ref={chartRef} />
              </div>

              {/* Episode table */}
              {episodes.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  No episodes triggered in this window (need σ ≥ 2).
                </p>
              ) : (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Episodes ({episodes.length})
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2.5">Entry</th>
                          <th className="px-4 py-2.5">Entry spread</th>
                          <th className="px-4 py-2.5">Entry σ</th>
                          <th className="px-4 py-2.5">Duration</th>
                          <th className="px-4 py-2.5">Close spread</th>
                          <th className="px-4 py-2.5">P&L / $100</th>
                        </tr>
                      </thead>
                      <tbody>
                        {episodes.map((ep, i) => {
                          const pnl = pnls[i];
                          return (
                            <tr
                              key={i}
                              className="border-b border-slate-100 last:border-0"
                            >
                              <td className="px-4 py-2.5 text-slate-700">
                                {fmtDate(ep.entryT)}
                              </td>
                              <td className="px-4 py-2.5 tabular-nums text-slate-700">
                                {(ep.entrySpread * 100).toFixed(2)}pp
                              </td>
                              <td className="px-4 py-2.5 tabular-nums text-slate-700">
                                {ep.entrySigma.toFixed(2)}σ
                              </td>
                              <td className="px-4 py-2.5 tabular-nums text-slate-700">
                                {ep.durationDays.toFixed(1)}d
                                {ep.timedOut && (
                                  <span className="ml-1 text-amber-500">
                                    ⏱
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 tabular-nums text-slate-700">
                                {(ep.closeSpread * 100).toFixed(2)}pp
                              </td>
                              <td
                                className={`px-4 py-2.5 tabular-nums font-medium ${pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}
                              >
                                {pnl >= 0 ? "+" : ""}
                                {pnl.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    P&L per $100 at risk after 2% friction. ⏱ = timed-out
                    without σ close.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border/60 px-6 py-4">
          <Button
            size="sm"
            className="bg-slate-950 text-white hover:bg-slate-800"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Spread order modal ────────────────────────────────────────────────────────
function SpreadOrderModal({ open, onClose, heroFamily, spreadCalc }) {
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const isMutex = heroFamily?.type === "Mutex set";
  const legAMarket = heroFamily?.dislocation?.violatingPair?.[0];
  const legBMarket = heroFamily?.dislocation?.violatingPair?.[1];
  const eventUrl = heroFamily?.eventSlug
    ? `https://polymarket.com/event/${heroFamily.eventSlug}`
    : null;

  function buildClipboard() {
    if (!spreadCalc || !heroFamily) return "";
    const legASide = isMutex ? "NO" : "YES";
    return [
      `=== Spread Order — ${heroFamily.family} ===`,
      ``,
      `LEG A · Buy ${legASide}`,
      `  Market : ${legAMarket ? getQuestion(legAMarket) : "—"}`,
      `  Price  : $${spreadCalc.priceA.toFixed(3)}`,
      `  Shares : ${spreadCalc.sharesA}`,
      `  Cost   : $${spreadCalc.costA.toFixed(2)}`,
      `  Max gain: +$${spreadCalc.maxGainA.toFixed(2)}`,
      ``,
      `LEG B · Buy NO`,
      `  Market : ${legBMarket ? getQuestion(legBMarket) : "—"}`,
      `  Price  : $${spreadCalc.priceB.toFixed(3)}`,
      `  Shares : ${spreadCalc.sharesB}`,
      `  Cost   : $${spreadCalc.costB.toFixed(2)}`,
      `  Max gain: +$${spreadCalc.maxGainB.toFixed(2)}`,
      ``,
      `SUMMARY`,
      `  Net cost        : $${spreadCalc.netCost.toFixed(2)}`,
      `  Est. friction   : $${spreadCalc.totalFriction.toFixed(2)}`,
      `  Breakeven repair: ${spreadCalc.breakevenRepairPp.toFixed(1)}pp`,
      `  Edge after spread: ${spreadCalc.edgePp.toFixed(1)}pp`,
      eventUrl ? `\n  Polymarket: ${eventUrl}` : "",
    ].join("\n");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildClipboard());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border/80 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.18)] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Spread order
            </h2>
            {heroFamily && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {heroFamily.family}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-4">
          {!spreadCalc ? (
            <p className="text-sm text-muted-foreground">
              Select a family with live book data loaded to build a spread
              order.
            </p>
          ) : (
            <>
              {/* Legs */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Leg A · Buy {isMutex ? "NO" : "YES"}
                  </p>
                  <p className="mb-3 text-xs font-medium leading-snug text-slate-900">
                    {legAMarket
                      ? getQuestion(legAMarket).slice(0, 60)
                      : "—"}
                  </p>
                  {[
                    ["Price", `$${spreadCalc.priceA.toFixed(3)}`],
                    ["Shares", String(spreadCalc.sharesA)],
                    ["Cost", `$${spreadCalc.costA.toFixed(2)}`],
                    ["Max gain", `+$${spreadCalc.maxGainA.toFixed(2)}`],
                  ].map(([label, val]) => (
                    <div
                      key={label}
                      className="flex justify-between py-0.5 text-xs"
                    >
                      <span className="text-muted-foreground">{label}</span>
                      <span
                        className={`font-medium ${label === "Max gain" ? "text-emerald-600" : "text-slate-900"}`}
                      >
                        {val}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Leg B · Buy NO
                  </p>
                  <p className="mb-3 text-xs font-medium leading-snug text-slate-900">
                    {legBMarket
                      ? getQuestion(legBMarket).slice(0, 60)
                      : "—"}
                  </p>
                  {[
                    ["Price", `$${spreadCalc.priceB.toFixed(3)}`],
                    ["Shares", String(spreadCalc.sharesB)],
                    ["Cost", `$${spreadCalc.costB.toFixed(2)}`],
                    ["Max gain", `+$${spreadCalc.maxGainB.toFixed(2)}`],
                  ].map(([label, val]) => (
                    <div
                      key={label}
                      className="flex justify-between py-0.5 text-xs"
                    >
                      <span className="text-muted-foreground">{label}</span>
                      <span
                        className={`font-medium ${label === "Max gain" ? "text-emerald-600" : "text-slate-900"}`}
                      >
                        {val}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Summary
                </p>
                <div className="space-y-1.5">
                  {[
                    ["Net cost", `$${spreadCalc.netCost.toFixed(2)}`, ""],
                    [
                      "Est. friction",
                      `$${spreadCalc.totalFriction.toFixed(2)}`,
                      "",
                    ],
                    [
                      "Breakeven repair",
                      `${spreadCalc.breakevenRepairPp.toFixed(1)}pp`,
                      "",
                    ],
                    [
                      "Edge after spread",
                      `${spreadCalc.edgePp.toFixed(1)}pp`,
                      spreadCalc.edgePp > 0
                        ? "text-emerald-600"
                        : "text-red-500",
                    ],
                  ].map(([label, val, cls]) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={`font-medium ${cls || "text-slate-900"}`}>
                        {val}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Polymarket link */}
              {eventUrl && (
                <a
                  href={eventUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm transition-colors hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-900">
                    Open on Polymarket
                  </span>
                  <span className="text-xs text-muted-foreground">↗</span>
                </a>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-6 py-4">
          {spreadCalc ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="text-xs"
            >
              {copied ? "Copied!" : "Copy order details"}
            </Button>
          ) : (
            <div />
          )}
          <Button
            size="sm"
            className="bg-slate-950 text-white hover:bg-slate-800"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Glossary modal ────────────────────────────────────────────────────────────
function GlossaryModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border/80 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.18)] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-2">
            <Info className="size-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-900">Glossary</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* Terms */}
        <div className="overflow-y-auto px-6 py-4 space-y-4">
          {GLOSSARY.map(({ term, def }) => (
            <div key={term}>
              <p className="text-xs font-semibold text-slate-900">{term}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{def}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Format ms timestamp as "MMM D HH:MM" ─────────────────────────────────────
function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function simplifyMarketLabel(label) {
  if (!label) return "";
  return label
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\bSpace Exploration Technologies Corp\.?\b/gi, "SpaceX")
    .replace(/\bbefore the end of\b/gi, "by")
    .replace(/\bbefore\b/gi, "by")
    .replace(/\bwill\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAxisLabel(label, maxLength = 18) {
  if (!label) return "";
  if (label.length <= maxLength) return label;
  return `${label.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildViolationAlert(family) {
  if (!family?.dislocation) return null;
  const { violatingPair, rawDislocation } = family.dislocation;
  if (!violatingPair || rawDislocation <= 0) return null;

  const gap = (rawDislocation * 100).toFixed(1);

  // ── Mutex set: violation is Σ YES > 1.00, not an ordering inversion ──
  if (family.type === "Mutex set") {
    const sum = family.dislocation.sum ?? 0;
    const [topLeg, secondLeg] = violatingPair;
    const topLabel = simplifyMarketLabel(getQuestion(topLeg));
    const secondLabel = simplifyMarketLabel(getQuestion(secondLeg));
    const topPrice = (topLeg.yesPrice * 100).toFixed(1);
    const secondPrice = (secondLeg.yesPrice * 100).toFixed(1);
    return {
      eyebrow: `${gap} pt sum overrun`,
      summary: `Outcomes sum to ${(sum * 100).toFixed(1)}¢ — ${gap} pts above the 100¢ ceiling.`,
      detail: `Top two: ${topLabel} at ${topPrice}¢, ${secondLabel} at ${secondPrice}¢. Buy NO on the most overpriced outcomes to capture the gap.`,
    };
  }

  // ── Strike ladder / Expiry curve: ordering inversion ──
  const [lowerLeg, upperLeg] = violatingPair;
  const upperPrice = (upperLeg.yesPrice * 100).toFixed(1);
  const lowerPrice = (lowerLeg.yesPrice * 100).toFixed(1);
  const upperLabel = simplifyMarketLabel(getQuestion(upperLeg));
  const lowerLabel = simplifyMarketLabel(getQuestion(lowerLeg));

  return {
    eyebrow: `${gap} point ordering break`,
    summary: `${upperLabel} is trading at ${upperPrice}¢.`,
    detail: `${lowerLabel} is still at ${lowerPrice}¢, even though this family should be ordered the other way around.`,
  };
}

// ── Main terminal ─────────────────────────────────────────────────────────────
export default function PolymarketRelativeValueTerminal() {
  const strikeChartRef = useRef(null);
  const pnlChartRef = useRef(null);
  const historyChartRef = useRef(null);
  const strikeChart = useRef(null);
  const pnlChart = useRef(null);
  const historyChart = useRef(null);

  const [scannerRows, setScannerRows] = useState(SEED_ROWS);
  const [loading, setLoading] = useState(true);
  const [isSeed, setIsSeed] = useState(true);
  const [dataAge, setDataAge] = useState(null);
  const [heroFamily, setHeroFamily] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [clobLoading, setClobLoading] = useState(false);
  const [clobHistory, setClobHistory] = useState(null); // { seriesA, seriesB, labelA, labelB }
  const [bookData, setBookData] = useState(null); // { legA: book, legB: book }
  const [bookLoading, setBookLoading] = useState(false);
  const [analyticsData, setAnalyticsData] = useState(null); // { sigma, backtest }
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [chartPointLimit, setChartPointLimit] = useState("all"); // "all" | number
  const [scannerPage, setScannerPage] = useState(1);
  const [pageJumpValue, setPageJumpValue] = useState("1");

  // ── Fetch Gamma families ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const rows = await fetchFamilies();
        if (cancelled) return;
        if (rows.length > 0) {
          setScannerRows(rows);
          setIsSeed(false);
          setDataAge(Date.now());
          setHeroFamily(
            rows.find(
              (r) => r.type === "Strike ladder" && r.rawDislocation > 0,
            ) ?? rows[0],
          );
        }
      } catch (err) {
        console.warn("Gamma API unavailable:", err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Fetch CLOB price history when hero family changes ──
  useEffect(() => {
    if (!heroFamily || heroFamily.isSeed) {
      setClobHistory(null);
      return;
    }

    // Pick the two markets to chart: violating pair if available, else top 2 by price
    const markets =
      heroFamily.dislocation?.violatingPair ?? heroFamily.markets.slice(0, 2);
    if (!markets || markets.length < 2) {
      setClobHistory(null);
      return;
    }

    const [mktA, mktB] = markets;
    const tokenA = getClobTokenId(mktA);
    const tokenB = getClobTokenId(mktB);
    if (!tokenA || !tokenB) {
      setClobHistory(null);
      return;
    }

    let cancelled = false;
    async function loadHistory() {
      setClobLoading(true);
      try {
        const [seriesA, seriesB] = await Promise.all([
          fetchPriceHistory(tokenA, { interval: "max", fidelity: 1440 }),
          fetchPriceHistory(tokenB, { interval: "max", fidelity: 1440 }),
        ]);
        if (cancelled) return;
        setClobHistory({
          seriesA,
          seriesB,
          labelA: getQuestion(mktA).slice(0, 40),
          labelB: getQuestion(mktB).slice(0, 40),
        });
      } catch (err) {
        console.warn("CLOB history unavailable:", err.message);
        if (!cancelled) setClobHistory(null);
      } finally {
        if (!cancelled) setClobLoading(false);
      }
    }
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [heroFamily]);

  // ── Fetch CLOB order book (both legs) when hero family changes ──
  useEffect(() => {
    if (
      !heroFamily ||
      heroFamily.isSeed ||
      !heroFamily.dislocation?.violatingPair
    ) {
      setBookData(null);
      return;
    }
    const [mktA, mktB] = heroFamily.dislocation.violatingPair;
    const tokenA = getClobTokenId(mktA);
    const tokenB = getClobTokenId(mktB);
    if (!tokenA || !tokenB) {
      setBookData(null);
      return;
    }

    let cancelled = false;
    async function loadBook() {
      setBookLoading(true);
      try {
        const [legA, legB] = await Promise.all([
          fetchOrderBook(tokenA),
          fetchOrderBook(tokenB),
        ]);
        if (cancelled) return;
        setBookData({ legA, legB });
      } catch (err) {
        console.warn("CLOB /book unavailable:", err.message);
        if (!cancelled) setBookData(null);
      } finally {
        if (!cancelled) setBookLoading(false);
      }
    }
    loadBook();
    return () => {
      cancelled = true;
    };
  }, [heroFamily]);

  // ── Fetch 30d history + compute σ and backtest when hero family changes ──
  useEffect(() => {
    if (
      !heroFamily ||
      heroFamily.isSeed ||
      !heroFamily.dislocation?.violatingPair
    ) {
      setAnalyticsData(null);
      return;
    }
    const [mktA, mktB] = heroFamily.dislocation.violatingPair;
    const tokenA = getClobTokenId(mktA);
    const tokenB = getClobTokenId(mktB);
    if (!tokenA || !tokenB) {
      setAnalyticsData(null);
      return;
    }

    let cancelled = false;
    async function loadAnalytics() {
      setAnalyticsLoading(true);
      try {
        const { seriesA, seriesB } = await fetch30dHistory(tokenA, tokenB);
        if (cancelled) return;
        const spreadSeries = buildSpreadSeries(seriesA, seriesB);
        const sigma = computeSigmaScore(
          spreadSeries,
          heroFamily.rawDislocation,
        );
        const frictionFrac = 0.02; // conservative 2% proxy; Spread Builder shows live dollar friction
        const backtest = runBacktest(spreadSeries, frictionFrac);
        if (!cancelled) setAnalyticsData({ sigma, backtest, spreadSeries });
      } catch (err) {
        console.warn("Analytics unavailable:", err.message);
        if (!cancelled) setAnalyticsData(null);
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    }
    loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [heroFamily]);

  // ── Init charts once ──
  useEffect(() => {
    const grid = "rgba(148,163,184,0.18)";
    const txt = "rgba(71,85,105,0.92)";

    strikeChart.current?.destroy();
    pnlChart.current?.destroy();
    historyChart.current?.destroy();

    strikeChart.current = new Chart(strikeChartRef.current, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "No-arbitrage ceiling",
            data: [],
            borderColor: "rgba(31,158,117,0.25)",
            backgroundColor: "rgba(31,158,117,0.05)",
            fill: true,
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: "Market prices",
            data: [],
            borderColor: "#378ADD",
            backgroundColor: "#378ADD",
            borderWidth: 2,
            pointRadius: 6,
            pointBackgroundColor: [],
            pointBorderColor: [],
            pointBorderWidth: 2,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#ffffff",
            titleColor: "#111827",
            bodyColor: "rgba(15,23,42,0.72)",
            borderColor: "rgba(15,23,42,0.1)",
            borderWidth: 1,
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}¢`,
            },
          },
        },
        scales: {
          y: {
            title: {
              display: true,
              text: "Probability (¢)",
              color: txt,
              font: { size: 11 },
            },
            min: 0,
            grid: { color: grid },
            ticks: { color: txt, font: { size: 11 }, callback: (v) => `${v}¢` },
          },
          x: {
            title: {
              display: false,
              text: "",
              color: txt,
              font: { size: 11 },
            },
            grid: { display: false },
            ticks: {
              display: false,
              color: txt,
              font: { size: 11 },
              autoSkip: true,
              maxTicksLimit: 10,
              minRotation: 0,
              maxRotation: 0,
            },
          },
        },
      },
    });

    pnlChart.current = new Chart(pnlChartRef.current, {
      type: "line",
      data: {
        labels: REPAIR_PCTS.map((r) => `${r} pts`),
        datasets: [
          {
            label: "Net P&L after fees",
            data: PNL_DATA,
            borderColor: "#00C805",
            backgroundColor: "rgba(0,200,5,0.08)",
            fill: true,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: "Break-even",
            data: REPAIR_PCTS.map(() => 0),
            borderColor: "#FF5000",
            borderWidth: 1,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#ffffff",
            titleColor: "#111827",
            bodyColor: "rgba(15,23,42,0.72)",
            borderColor: "rgba(15,23,42,0.1)",
            borderWidth: 1,
          },
        },
        scales: {
          y: {
            grid: { color: grid },
            ticks: {
              color: txt,
              font: { size: 11 },
              callback: (v) => `${v < 0 ? "-" : ""}$${Math.abs(v)}`,
            },
          },
          x: {
            grid: { display: false },
            ticks: { color: txt, font: { size: 11 } },
          },
        },
      },
    });

    historyChart.current = new Chart(historyChartRef.current, {
      type: "line",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: txt,
              font: { size: 11 },
              boxWidth: 10,
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: "#ffffff",
            titleColor: "#111827",
            bodyColor: "rgba(15,23,42,0.72)",
            borderColor: "rgba(15,23,42,0.1)",
            borderWidth: 1,
            callbacks: {
              label: (ctx) =>
                `${ctx.dataset.label}: ${(ctx.parsed.y * 100).toFixed(1)}¢`,
            },
          },
        },
        scales: {
          y: {
            min: 0,
            max: 1,
            title: {
              display: true,
              text: "Probability",
              color: txt,
              font: { size: 11 },
            },
            grid: { color: grid },
            ticks: {
              color: txt,
              font: { size: 11 },
              callback: (v) => `${(v * 100).toFixed(0)}¢`,
            },
          },
          x: {
            grid: { display: false },
            ticks: {
              color: txt,
              font: { size: 11 },
              maxTicksLimit: 8,
              maxRotation: 0,
            },
          },
        },
      },
    });

    return () => {
      strikeChart.current?.destroy();
      pnlChart.current?.destroy();
      historyChart.current?.destroy();
    };
  }, []);

  // ── Reset chart point limit when hero family changes ──
  useEffect(() => {
    if (!heroFamily) return;
    const count = heroFamily.markets?.length ?? 0;
    // Auto-select a reasonable default: show all if ≤12, else top 10
    setChartPointLimit(count <= 12 ? "all" : 10);
  }, [heroFamily]);

  // ── Update strike chart on heroFamily + chartPointLimit change ──
  useEffect(() => {
    if (!strikeChart.current || !heroFamily?.markets.length) return;

    const allPrices = heroFamily.markets.map((m) => m.yesPrice * 100);
    const allEnvelope = computeNoArbEnvelope(allPrices);
    const allLabels = heroFamily.markets.map((market, index) => {
      const explicitLabel = heroFamily.labels?.[index];
      return getQuestion(market) || explicitLabel || `Market ${index + 1}`;
    });

    // Determine which indices to show
    let visibleIndices;
    const limit =
      chartPointLimit === "all" ? allPrices.length : chartPointLimit;

    if (limit >= allPrices.length) {
      visibleIndices = allPrices.map((_, i) => i);
    } else {
      // Always include violation points + first + last, then sample evenly
      const violationIdx = new Set();
      allPrices.forEach((p, i) => {
        if (p > allEnvelope[i]) violationIdx.add(i);
      });
      violationIdx.add(0);
      violationIdx.add(allPrices.length - 1);

      const remaining = limit - violationIdx.size;
      if (remaining > 0) {
        const candidates = [];
        for (let i = 0; i < allPrices.length; i++) {
          if (!violationIdx.has(i)) candidates.push(i);
        }
        // Evenly sample from candidates
        const step = candidates.length / remaining;
        for (let j = 0; j < remaining && j < candidates.length; j++) {
          violationIdx.add(candidates[Math.round(j * step)]);
        }
      }
      visibleIndices = [...violationIdx].sort((a, b) => a - b).slice(0, limit);
    }

    const prices = visibleIndices.map((i) => allPrices[i]);
    const envelope = visibleIndices.map((i) => allEnvelope[i]);
    const rawLabels = visibleIndices.map((i) => allLabels[i]);
    const colors = prices.map((p, i) =>
      p > envelope[i] ? "#FF5000" : "#378ADD",
    );

    const c = strikeChart.current;
    c.$rawLabels = rawLabels;
    c.data.labels = rawLabels;
    c.data.datasets[0].data = envelope;
    c.data.datasets[1].data = prices;
    c.data.datasets[1].pointBackgroundColor = colors;
    c.data.datasets[1].pointBorderColor = colors;
    c.options.plugins.tooltip.callbacks.title = (items) => {
      if (!items.length) return "";
      return c.$rawLabels?.[items[0].dataIndex] ?? items[0].label;
    };
    c.options.scales.x.ticks.maxTicksLimit =
      heroFamily.type === "Mutex set" ? 8 : 12;
    c.update();
  }, [heroFamily, chartPointLimit]);

  // ── Update history chart on clobHistory change ──
  useEffect(() => {
    if (!historyChart.current) return;
    const c = historyChart.current;

    if (!clobHistory || !clobHistory.seriesA.length) {
      c.data.labels = [];
      c.data.datasets = [];
      c.update();
      return;
    }

    const { seriesA, seriesB, labelA, labelB } = clobHistory;

    // Align on seriesA timestamps as the x-axis spine
    c.data.labels = seriesA.map((pt) => fmtTime(pt.t));

    // Build a lookup for seriesB by timestamp for alignment
    const bByTime = new Map(seriesB.map((pt) => [pt.t, pt.p]));

    c.data.datasets = [
      {
        label: labelA,
        data: seriesA.map((pt) => pt.p),
        borderColor: "#378ADD",
        backgroundColor: "rgba(55,138,221,0.06)",
        fill: false,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: labelB,
        data: seriesA.map((pt) => bByTime.get(pt.t) ?? null),
        borderColor: "#FF5000",
        backgroundColor: "rgba(255,80,0,0.06)",
        fill: false,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        spanGaps: true,
      },
    ];
    c.update();
  }, [clobHistory]);

  // ── Update P&L chart when live book data arrives ──
  useEffect(() => {
    if (
      !pnlChart.current ||
      !bookData ||
      !heroFamily?.dislocation?.violatingPair
    )
      return;
    const [mktA, mktB] = heroFamily.dislocation.violatingPair;
    const isMutexPnl = heroFamily.type === "Mutex set";
    const TARGET = 100;
    // Mutex: buy NO on both overpriced outcomes. Strike/Expiry: buy YES on A, NO on B.
    const priceA = isMutexPnl
      ? bookData.legA.topBid != null
        ? 1 - bookData.legA.topBid
        : 1 - mktA.yesPrice
      : (bookData.legA.topAsk ?? mktA.yesPrice);
    const sharesA = Math.round(TARGET / priceA);
    const noPrice =
      bookData.legB.topBid != null
        ? 1 - bookData.legB.topBid
        : 1 - mktB.yesPrice;
    const sharesB = Math.round(TARGET / noPrice);
    const frictionA =
      bookData.legA.spread != null
        ? (sharesA * bookData.legA.spread) / 2
        : sharesA * priceA * 0.02;
    const frictionB =
      bookData.legB.spread != null
        ? (sharesB * bookData.legB.spread) / 2
        : sharesB * noPrice * 0.02;
    const totalFriction = frictionA + frictionB;
    const totalShares = sharesA + sharesB;
    const c = pnlChart.current;
    c.data.datasets[0].data = REPAIR_PCTS.map(
      (r) => Math.round((totalShares * (r / 100) - totalFriction) * 100) / 100,
    );
    c.update();
  }, [bookData, heroFamily]);

  // ── Derived values ──
  const actionableCount = scannerRows.filter(
    (r) => r.status === "Actionable",
  ).length;
  const dislocatedCount = scannerRows.filter(
    (r) => r.rawDislocation > 0,
  ).length;
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRows = scannerRows.filter((row) => {
    const matchesSearch =
      normalizedQuery === "" ||
      row.family.toLowerCase().includes(normalizedQuery);
    const matchesStatus = statusFilter === "all" || row.status === statusFilter;
    const matchesType = typeFilter === "all" || row.type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });
  const filtersActive =
    normalizedQuery !== "" || statusFilter !== "all" || typeFilter !== "all";
  const totalScannerPages = Math.max(
    1,
    Math.ceil(filteredRows.length / SCANNER_PAGE_SIZE),
  );
  const activeScannerPage = Math.min(scannerPage, totalScannerPages);
  const pageStartIndex = (activeScannerPage - 1) * SCANNER_PAGE_SIZE;
  const pagedRows = filteredRows.slice(
    pageStartIndex,
    pageStartIndex + SCANNER_PAGE_SIZE,
  );
  const visibleRangeStart = filteredRows.length ? pageStartIndex + 1 : 0;
  const visibleRangeEnd = Math.min(
    pageStartIndex + SCANNER_PAGE_SIZE,
    filteredRows.length,
  );
  // Compute visible chart indices (mirrors the logic in the chart useEffect)
  const chartVisibleIndices = (() => {
    if (!heroFamily?.markets?.length) return [];
    const allPrices = heroFamily.markets.map((m) => m.yesPrice * 100);
    const allEnvelope = computeNoArbEnvelope(allPrices);
    const limit =
      chartPointLimit === "all" ? allPrices.length : chartPointLimit;
    if (limit >= allPrices.length) return allPrices.map((_, i) => i);
    const keep = new Set([0, allPrices.length - 1]);
    allPrices.forEach((p, i) => {
      if (p > allEnvelope[i]) keep.add(i);
    });
    const remaining = limit - keep.size;
    if (remaining > 0) {
      const cands = [];
      for (let i = 0; i < allPrices.length; i++)
        if (!keep.has(i)) cands.push(i);
      const step = cands.length / remaining;
      for (let j = 0; j < remaining && j < cands.length; j++)
        keep.add(cands[Math.round(j * step)]);
    }
    return [...keep].sort((a, b) => a - b).slice(0, limit);
  })();

  const totalMarketCount = heroFamily?.markets?.length ?? 0;

  // Build chart point-limit options: only show options that are smaller than total
  const chartLimitOptions = (() => {
    const opts = [];
    for (const n of [5, 8, 10, 15, 20]) {
      if (n < totalMarketCount) opts.push(n);
    }
    opts.push("all");
    return opts;
  })();

  const strikeAxisLabels = chartVisibleIndices.map((i) => {
    const market = heroFamily.markets[i];
    const fullLabel =
      getQuestion(market) || heroFamily?.labels?.[i] || `Market ${i + 1}`;
    const shortLabel = heroFamily?.labels?.[i] || fullLabel;
    return {
      full: fullLabel,
      short: truncateAxisLabel(shortLabel),
    };
  });

  useEffect(() => {
    setScannerPage(1);
    setPageJumpValue("1");
  }, [searchQuery, statusFilter, typeFilter]);

  useEffect(() => {
    if (scannerPage > totalScannerPages) {
      setScannerPage(totalScannerPages);
      return;
    }
    setPageJumpValue(String(activeScannerPage));
  }, [scannerPage, totalScannerPages, activeScannerPage]);

  // ── Live spread economics (computed from book data) ──
  let spreadCalc = null;
  if (bookData && heroFamily?.dislocation?.violatingPair) {
    const [mktA, mktB] = heroFamily.dislocation.violatingPair;
    const isMutex = heroFamily.type === "Mutex set";
    const TARGET = 100;
    // Mutex: buy NO on both legs (both outcomes overpriced). Strike/Expiry: buy YES on A.
    const priceA = isMutex
      ? bookData.legA.topBid != null
        ? 1 - bookData.legA.topBid
        : 1 - mktA.yesPrice
      : (bookData.legA.topAsk ?? mktA.yesPrice);
    const sharesA = Math.round(TARGET / priceA);
    const costA = sharesA * priceA;
    const maxGainA = sharesA * (1 - priceA);
    const frictionA =
      bookData.legA.spread != null
        ? (sharesA * bookData.legA.spread) / 2
        : costA * 0.02;
    const noPrice =
      bookData.legB.topBid != null
        ? 1 - bookData.legB.topBid
        : 1 - mktB.yesPrice;
    const sharesB = Math.round(TARGET / noPrice);
    const costB = sharesB * noPrice;
    const maxGainB = sharesB * (1 - noPrice);
    const frictionB =
      bookData.legB.spread != null
        ? (sharesB * bookData.legB.spread) / 2
        : costB * 0.02;
    const totalFriction = frictionA + frictionB;
    const netCost = costA + costB;
    const totalShares = sharesA + sharesB;
    const breakevenRepairPp = (totalFriction / totalShares) * 100;
    const edgePp = heroFamily.rawDislocation * 100 - breakevenRepairPp;
    spreadCalc = {
      priceA,
      sharesA,
      costA,
      maxGainA,
      priceB: noPrice,
      sharesB,
      costB,
      maxGainB,
      totalFriction,
      netCost,
      breakevenRepairPp,
      edgePp,
    };
  }

  // ── Sigma display label ──
  const sigma = analyticsData?.sigma ?? null;
  const sigmaLabel = sigma != null ? sigma.toFixed(2) : null;
  const sigmaStatus =
    sigma == null
      ? null
      : sigma >= 2
        ? "Actionable"
        : sigma >= 1.5
          ? "Watchlist"
          : "Normal";
  const sigmaCls =
    sigmaStatus === "Actionable"
      ? "text-emerald-600"
      : sigmaStatus === "Watchlist"
        ? "text-amber-600"
        : "text-muted-foreground";

  const violationAlert = buildViolationAlert(heroFamily);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background text-foreground">
      <GlossaryModal open={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
      <SpreadOrderModal
        open={orderModalOpen}
        onClose={() => setOrderModalOpen(false)}
        heroFamily={heroFamily}
        spreadCalc={spreadCalc}
      />
      <ReplayModal
        open={replayOpen}
        onClose={() => setReplayOpen(false)}
        spreadSeries={analyticsData?.spreadSeries ?? null}
        heroFamily={heroFamily}
      />
      {/* ── Top nav bar ── */}
      <header className="sticky top-0 z-20 border-b border-border/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-950 to-slate-800 text-sm font-semibold text-white shadow-md">
              S
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold tracking-tight">
                  Snapback
                </span>
                <span className="text-xs font-medium text-slate-500">
                  Terminal
                </span>
              </div>
              <p className="hidden text-xs text-muted-foreground md:block leading-tight">
                Scan structurally linked markets, inspect violations, price
                spreads
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-5 text-sm md:flex">
              <span className="flex items-center gap-1">
                <button
                  onClick={() => setGlossaryOpen(true)}
                  className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-500 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
                  aria-label="Open glossary"
                  title="Open glossary"
                >
                  <Info className="size-3" />
                  <span className="text-[10px] font-medium">Glossary</span>
                </button>
                <span className="text-muted-foreground">Families</span>
                <span className="font-medium">
                  {loading ? "—" : scannerRows.length}
                </span>
              </span>
              <div className="flex items-center gap-2 rounded-full bg-slate-50 px-4 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Dislocations
                </span>
                <span className="font-semibold text-slate-900">
                  {loading ? "—" : dislocatedCount}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Actionable
                </span>
                <span
                  className={`font-semibold ${actionableCount > 0 ? "text-emerald-700" : "text-slate-900"}`}
                >
                  {loading ? "—" : actionableCount}
                </span>
              </div>
            </div>
            <FreshnessBadge dataAge={dataAge} isSeed={isSeed} />
            {loading && (
              <span className="text-xs text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300 animate-pulse mr-1" />
                Fetching…
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6">
        <section className="scanner-command-bar">
          <div className="scanner-command-copy">
            <p className="scanner-command-eyebrow">Scanner search</p>
            <p className="scanner-command-subtitle">
              Search the ranked family list without breaking the main workspace.
            </p>
          </div>
          <div className="scanner-command-actions">
            <label className="scanner-search scanner-search-panel">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search families"
                className="scanner-search-input"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="scanner-search-clear"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </label>
            <div className="scanner-command-meta">
              <span className="scanner-command-count">
                {filteredRows.length} matching families
              </span>
              <span className="scanner-command-range">
                {filteredRows.length
                  ? `Showing ${visibleRangeStart}-${visibleRangeEnd}`
                  : "No matches"}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* ── Body: sidebar + main ── */}
      <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:px-8 lg:py-6">
        {/* ── Scanner sidebar ── */}
        <aside className="glass-panel w-full shrink-0 overflow-hidden lg:sticky lg:top-20 lg:h-[calc(100vh-112px)] lg:w-72 flex flex-col">
          <div className="border-b border-border/80 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Scanner
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Groups of linked markets ranked by price deviation severity.
            </p>
          </div>
          <div className="border-b border-border/80 px-4 py-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Scanner view
              </p>
              <span className="text-[11px] text-muted-foreground font-medium">
                Page {activeScannerPage} of {totalScannerPages}
              </span>
            </div>
            <div className="space-y-2.5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                  Status
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_FILTERS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setStatusFilter(option)}
                      className={`scanner-filter-chip ${statusFilter === option ? "scanner-filter-chip-active" : ""}`}
                    >
                      {option === "all" ? "All statuses" : option}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
                  Type
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {TYPE_FILTERS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTypeFilter(option)}
                      className={`scanner-filter-chip ${typeFilter === option ? "scanner-filter-chip-active" : ""}`}
                    >
                      {option === "all"
                        ? "All types"
                        : option === "Strike ladder"
                          ? "Strike"
                          : option === "Expiry curve"
                            ? "Expiry"
                            : "Mutex"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="scanner-pagination mt-3">
              <button
                type="button"
                onClick={() => setScannerPage((page) => Math.max(1, page - 1))}
                disabled={activeScannerPage === 1}
                className="scanner-pagination-button"
              >
                Previous
              </button>
              <form
                className="scanner-pagination-jump"
                onSubmit={(event) => {
                  event.preventDefault();
                  const requestedPage = Number.parseInt(pageJumpValue, 10);
                  if (Number.isNaN(requestedPage)) {
                    setPageJumpValue(String(activeScannerPage));
                    return;
                  }
                  const nextPage = Math.min(
                    Math.max(requestedPage, 1),
                    totalScannerPages,
                  );
                  setScannerPage(nextPage);
                }}
              >
                <input
                  type="number"
                  min="1"
                  max={String(totalScannerPages)}
                  value={pageJumpValue}
                  onChange={(event) => setPageJumpValue(event.target.value)}
                  className="scanner-page-input"
                  aria-label="Go to scanner page"
                />
                <span className="scanner-page-label">go</span>
              </form>
              <button
                type="button"
                onClick={() =>
                  setScannerPage((page) =>
                    Math.min(totalScannerPages, page + 1),
                  )
                }
                disabled={activeScannerPage === totalScannerPages}
                className="scanner-pagination-button"
              >
                Next
              </button>
            </div>
            {filtersActive ? (
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted-foreground">
                  Filters are narrowing the view.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setTypeFilter("all");
                  }}
                  className="text-[11px] font-medium text-blue-600 transition hover:text-blue-700"
                >
                  Clear
                </button>
              </div>
            ) : null}
          </div>
          <div className="sidebar-scroll flex-1 overflow-y-auto">
            <div className="space-y-2 p-3">
              {pagedRows.length ? (
                pagedRows.map((row) => (
                  <button
                    key={row.family}
                    onClick={() => !row.isSeed && setHeroFamily(row)}
                    className={`fade-in scanner-item w-full text-left px-4 py-3.5 rounded-lg transition-all ${
                      heroFamily?.family === row.family
                        ? "scanner-item-active bg-blue-50 border border-blue-200"
                        : "hover:bg-slate-50 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-sm font-semibold leading-snug text-slate-900">
                        {row.family}
                      </span>
                      <span
                        className={`text-xs font-bold shrink-0 tabular-nums ${row.severityCls}`}
                        title="Price deviation in percentage points"
                      >
                        {row.severity.replace("pp", " pts")}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600"
                        title={
                          row.type === "Strike ladder"
                            ? "Markets with different price thresholds on the same asset — higher thresholds must be cheaper"
                            : row.type === "Expiry curve"
                              ? "Same outcome, different deadlines — earlier deadlines cannot be more likely than later ones"
                              : "Mutually exclusive outcomes — their probabilities must sum to ~100%"
                        }
                      >
                        {row.type}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                          row.status === "Actionable"
                            ? "bg-emerald-100 text-emerald-700"
                            : row.status === "Watchlist"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-500"
                        }`}
                        title={
                          row.status === "Actionable"
                            ? "Gap is 4 points or more — likely profitable after costs"
                            : row.status === "Watchlist"
                              ? "Gap is between 2 and 4 points — notable, but may not clear transaction costs yet"
                              : "Gap is under 2 points — within normal noise, no trade"
                        }
                      >
                        {row.status}
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/65 px-4 py-5 text-sm text-muted-foreground">
                  <p>No families match these filters.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("all");
                      setTypeFilter("all");
                    }}
                    className="mt-2 font-medium text-blue-600 transition hover:text-blue-700"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>
            {/* ── Glossary (collapsible) ── */}
            <div className="border-t border-border/80">
              <button
                type="button"
                onClick={() => setGlossaryOpen(!glossaryOpen)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Glossary
                </p>
                <span
                  className={`text-xs transition ${glossaryOpen ? "rotate-180" : ""}`}
                >
                  ▼
                </span>
              </button>
              {glossaryOpen && (
                <div className="px-5 pb-5 pt-3 border-t border-border/40">
                  <dl className="space-y-2.5">
                    {GLOSSARY.map(({ term, def }) => (
                      <div key={term} className="text-[10px]">
                        <dt className="font-semibold text-slate-700">{term}</dt>
                        <dd className="leading-relaxed text-muted-foreground mt-0.5">
                          {def}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="min-w-0 flex-1 space-y-4">
          {/* ── Family header + chart ── */}
          <section className="fade-in px-8 pt-7 pb-6 border-b border-border">
            {/* Title row */}
            <div className="soft-grid border-b border-border/80 px-6 pb-6 pt-7 sm:px-8">
              <div className="mb-6 flex flex-col items-start justify-between gap-6 lg:flex-row">
                <div className="max-w-2xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Selected market group
                  </p>
                  <h2 className="mt-3 text-2xl font-bold leading-tight tracking-[-0.04em] text-slate-950">
                    {heroFamily?.family ?? "—"}
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    {heroFamily?.dislocation?.constraintDesc ??
                      "Select a family from the scanner to inspect"}
                  </p>
                  {violationAlert && (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50/95 px-4 py-3 text-red-700 shadow-sm">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 shrink-0 text-lg leading-none font-semibold">
                          ⚠
                        </span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-600">
                            {violationAlert.eyebrow}
                          </p>
                          <p className="mt-1 text-sm font-semibold leading-6 text-red-700">
                            {violationAlert.summary}
                          </p>
                          <p className="text-sm leading-6 text-red-600">
                            {violationAlert.detail}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="min-w-[160px] rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white/95 to-slate-50/50 px-6 py-5 text-left shadow-sm lg:text-right">
                  <div className="flex items-center justify-between gap-2 lg:justify-end mb-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {sigmaLabel ? "Sigma score" : "Gap"}
                    </p>
                    {sigmaLabel && (
                      <Tooltip text="Sigma score shows how many standard deviations the current gap sits above its 30-day trailing average. A reading of 2 standard deviations or higher is Actionable, 1.5 to 2 is Watchlist, and below 1.5 is Normal." />
                    )}
                  </div>
                  <p
                    className={`text-4xl font-bold tracking-[-0.06em] tabular-nums ${sigmaLabel ? sigmaCls : (heroFamily?.severityCls ?? "")}`}
                  >
                    {sigmaLabel ??
                      (heroFamily
                        ? heroFamily.severity.replace("pp", "")
                        : "—")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {sigmaLabel ? "std devs" : "pts"}
                  </p>
                  {!sigmaLabel && heroFamily && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {analyticsLoading ? "Computing sigma…" : "sigma pending"}
                    </p>
                  )}
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {sigmaStatus ?? heroFamily?.status ?? "—"}
                  </p>
                </div>
              </div>

              {/* Chart — with inline point-limit filter in top-right corner */}
              <div className="chart-container rounded-xl border border-slate-200/80 bg-white/50 backdrop-blur-sm overflow-hidden">
                {/* Chart toolbar */}
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Price surface
                  </span>
                  {chartLimitOptions.length > 1 && (
                    <div className="flex items-center gap-2">
                      {chartPointLimit !== "all" && (
                        <span className="text-[10px] text-muted-foreground/70 hidden sm:inline">
                          Violations always shown ·
                        </span>
                      )}
                      <div className="flex gap-1">
                        {chartLimitOptions.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setChartPointLimit(opt)}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all duration-150 ${
                              chartPointLimit === opt
                                ? "border-blue-200 bg-blue-50 text-blue-600 shadow-sm"
                                : "border-slate-200/80 bg-white/60 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-700"
                            }`}
                          >
                            {opt === "all"
                              ? `All ${totalMarketCount}`
                              : `${opt}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {/* Canvas */}
                <div className="relative h-72 p-4">
                  <canvas ref={strikeChartRef} />
                </div>
              </div>
              {strikeAxisLabels.length > 0 && (
                <div
                  className="mt-4 grid items-start gap-2"
                  style={{
                    gridTemplateColumns: `repeat(${strikeAxisLabels.length}, minmax(0, 1fr))`,
                  }}
                >
                  {strikeAxisLabels.map((label) => (
                    <AxisLabel
                      key={label.full}
                      fullLabel={label.full}
                      shortLabel={label.short}
                    />
                  ))}
                </div>
              )}

              {/* Legend */}
              <div className="mt-5 flex flex-wrap gap-5 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm bg-emerald-500/20 border border-emerald-500/40" />
                  <span className="font-medium text-slate-700">
                    No-arbitrage ceiling
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-[#378ADD]" />
                  <span className="font-medium text-slate-700">
                    Market price
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-[#FF5000]" />
                  <span className="font-medium text-slate-700">Violation</span>
                </span>
              </div>
            </div>
          </section>

          {/* ── CLOB price history (48h) ── */}
          <section className="fade-in px-8 py-6 border-b border-border">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Price history
                </p>
                <p className="text-sm font-semibold mt-1">
                  Market spread over time
                </p>
              </div>
              {clobLoading && (
                <span className="text-xs text-muted-foreground">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300 animate-pulse mr-1" />
                  Loading…
                </span>
              )}
              {!clobLoading && clobHistory && (
                <span className="text-xs text-slate-500">
                  via CLOB /prices-history
                </span>
              )}
              {!clobLoading &&
                !clobHistory &&
                !heroFamily?.isSeed &&
                heroFamily && (
                  <span className="text-xs text-red-500 font-medium">
                    Unavailable
                  </span>
                )}
            </div>
            <div className="chart-container relative h-52 rounded-xl border border-slate-200/80 bg-white/50 p-4 backdrop-blur-sm">
              {/* Canvas is always mounted so Chart.js can bind; content driven by clobHistory */}
              <canvas
                ref={historyChartRef}
                className={clobHistory ? "" : "opacity-0"}
              />
              {!clobHistory && !clobLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground rounded-lg">
                  {heroFamily && !heroFamily.isSeed
                    ? "No CLOB history data"
                    : "Select a live family to view history"}
                </div>
              )}
            </div>
          </section>

          {/* ── Stats bar ── */}
          <div className="glass-panel grid grid-cols-2 md:grid-cols-4 rounded-xl">
            <StatCell
              label="Markets in family"
              value={heroFamily ? String(heroFamily.markets.length) : "—"}
              tooltip="How many individual markets belong to this linked group."
              border
            />
            <StatCell
              label="Family type"
              value={heroFamily?.type ?? "—"}
              tooltip="The structural constraint that links these markets. Strike ladder = price thresholds. Expiry curve = same outcome, different deadlines. Mutex set = mutually exclusive outcomes."
              border
            />
            <StatCell
              label="Price deviation"
              value={
                heroFamily
                  ? `${(heroFamily.rawDislocation * 100).toFixed(1)} pts`
                  : "—"
              }
              valueCls={heroFamily?.severityCls}
              tooltip="How far the most-violated pair sits outside the no-arbitrage constraint, in percentage points (cents on a 0–100¢ scale)."
              border
            />
            <StatCell
              label={sigmaLabel ? "Sigma score" : "Signal strength"}
              value={
                sigmaLabel
                  ? `${sigmaLabel} · ${sigmaStatus}`
                  : (heroFamily?.status ?? "—")
              }
              valueCls={sigmaLabel ? sigmaCls : undefined}
              tooltip="Sigma score shows how many standard deviations the gap sits above its 30-day trailing average. 2 or more is Actionable, 1.5 to 2 is Watchlist, and below 1.5 is Normal. Raw points are shown until 30-day history loads."
              border={false}
            />
          </div>

          {/* ── Spread builder ── */}
          <section className="fade-in glass-panel overflow-hidden rounded-xl">
            <div className="border-b border-border/80 px-6 py-5 sm:px-8 bg-gradient-to-r from-white/50 to-slate-50/30">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Spread builder
                  </p>
                  <h3 className="mt-2 text-base font-bold text-slate-950">
                    Corrective spread
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Direction is structurally implied. The UI stays explicit
                    about what is live versus what is still proxy data.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {bookLoading && (
                    <span className="text-xs text-muted-foreground">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300 animate-pulse mr-1" />
                      Loading…
                    </span>
                  )}
                  {bookData && !bookLoading && (
                    <span className="rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                      Live book
                    </span>
                  )}
                  <Badge className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                    Auto-generated
                  </Badge>
                </div>
              </div>
            </div>

            <div className="space-y-8 px-6 py-7 sm:px-8">
              {/* ── Two legs ── */}
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Leg A */}
                <div className="rounded-xl border border-slate-200/80 bg-gradient-to-br from-white/90 to-slate-50/50 p-5 shadow-sm">
                  <div className="mb-3 pb-3 border-b border-slate-100">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {heroFamily?.type === "Mutex set"
                        ? "Leg A · Buy NO"
                        : "Leg A · Buy YES"}
                    </p>
                  </div>
                  {(() => {
                    const fullA = heroFamily?.dislocation?.violatingPair
                      ? getQuestion(heroFamily.dislocation.violatingPair[0])
                      : "BTC above $90k";
                    const isTruncatedA = fullA.length > 50;
                    return (
                      <div className="group relative mb-4">
                        <p className="text-base font-semibold leading-snug text-slate-950 cursor-default">
                          {isTruncatedA ? `${fullA.slice(0, 50)}…` : fullA}
                        </p>
                        {isTruncatedA && (
                          <div className="pointer-events-none absolute top-full left-0 z-50 mt-2 w-80 rounded-xl border border-border/80 bg-white px-3 py-2.5 text-[12px] leading-relaxed text-slate-700 shadow-[0_18px_48px_rgba(15,23,42,0.13)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                            {fullA}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <div className="space-y-2.5 text-sm">
                    {[
                      [
                        "Token",
                        (() => {
                          const isMutexLeg = heroFamily?.type === "Mutex set";
                          if (spreadCalc) {
                            return isMutexLeg
                              ? `NO @ $${spreadCalc.priceA.toFixed(3)}`
                              : `YES @ $${spreadCalc.priceA.toFixed(3)}`;
                          }
                          if (heroFamily?.dislocation?.violatingPair) {
                            const p =
                              heroFamily.dislocation.violatingPair[0].yesPrice;
                            return isMutexLeg
                              ? `NO @ $${(1 - p).toFixed(2)}`
                              : `YES @ $${p.toFixed(2)}`;
                          }
                          return isMutexLeg ? "NO @ —" : "YES @ —";
                        })(),
                      ],
                      ["Shares", spreadCalc ? String(spreadCalc.sharesA) : "—"],
                      [
                        "Cost",
                        spreadCalc ? `$${spreadCalc.costA.toFixed(2)}` : "—",
                      ],
                      [
                        "Max gain",
                        spreadCalc
                          ? `+$${spreadCalc.maxGainA.toFixed(2)}`
                          : "—",
                      ],
                    ].map(([label, val]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between"
                      >
                        <span className="text-muted-foreground text-xs font-medium">
                          {label}
                        </span>
                        <span
                          className={`font-semibold tabular-nums ${label === "Max gain" ? "text-emerald-600" : "text-slate-900"}`}
                        >
                          {val}
                        </span>
                      </div>
                    ))}
                  </div>
                  {bookData && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {heroFamily?.type === "Mutex set"
                          ? "Depth (NO · implied)"
                          : "Depth (YES)"}
                      </p>
                      <div className="grid grid-cols-2 gap-x-3 text-[11px]">
                        <div>
                          <p className="mb-1 text-muted-foreground text-xs">
                            Bids
                          </p>
                          {bookData.legA.bids.slice(0, 3).map((b, i) => (
                            <div
                              key={i}
                              className="flex justify-between tabular-nums text-xs"
                            >
                              <span className="text-emerald-600 font-medium">
                                {b.price.toFixed(3)}
                              </span>
                              <span className="text-muted-foreground">
                                {b.size.toFixed(0)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="mb-1 text-muted-foreground text-xs">
                            Asks
                          </p>
                          {bookData.legA.asks.slice(0, 3).map((a, i) => (
                            <div
                              key={i}
                              className="flex justify-between tabular-nums text-xs"
                            >
                              <span className="text-red-500 font-medium">
                                {a.price.toFixed(3)}
                              </span>
                              <span className="text-muted-foreground">
                                {a.size.toFixed(0)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {/* Leg B */}
                <div className="rounded-xl border border-slate-200/80 bg-gradient-to-br from-white/90 to-slate-50/50 p-5 shadow-sm">
                  <div className="mb-3 pb-3 border-b border-slate-100">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Leg B · Buy NO
                    </p>
                  </div>
                  {(() => {
                    const fullB = heroFamily?.dislocation?.violatingPair
                      ? getQuestion(heroFamily.dislocation.violatingPair[1])
                      : "BTC above $100k";
                    const isTruncatedB = fullB.length > 50;
                    return (
                      <div className="group relative mb-4">
                        <p className="text-base font-semibold leading-snug text-slate-950 cursor-default">
                          {isTruncatedB ? `${fullB.slice(0, 50)}…` : fullB}
                        </p>
                        {isTruncatedB && (
                          <div className="pointer-events-none absolute top-full left-0 z-50 mt-2 w-80 rounded-xl border border-border/80 bg-white px-3 py-2.5 text-[12px] leading-relaxed text-slate-700 shadow-[0_18px_48px_rgba(15,23,42,0.13)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                            {fullB}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <div className="space-y-2.5 text-sm">
                    {[
                      [
                        "Token",
                        spreadCalc
                          ? `NO @ $${spreadCalc.priceB.toFixed(3)}`
                          : heroFamily?.dislocation?.violatingPair
                            ? `NO @ $${(1 - heroFamily.dislocation.violatingPair[1].yesPrice).toFixed(2)}`
                            : "NO @ $0.58",
                      ],
                      ["Shares", spreadCalc ? String(spreadCalc.sharesB) : "—"],
                      [
                        "Cost",
                        spreadCalc ? `$${spreadCalc.costB.toFixed(2)}` : "—",
                      ],
                      [
                        "Max gain",
                        spreadCalc
                          ? `+$${spreadCalc.maxGainB.toFixed(2)}`
                          : "—",
                      ],
                    ].map(([label, val]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between"
                      >
                        <span className="text-muted-foreground text-xs font-medium">
                          {label}
                        </span>
                        <span
                          className={`font-semibold tabular-nums ${label === "Max gain" ? "text-emerald-600" : "text-slate-900"}`}
                        >
                          {val}
                        </span>
                      </div>
                    ))}
                  </div>
                  {bookData && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Depth (YES · implied NO)
                      </p>
                      <div className="grid grid-cols-2 gap-x-3 text-[11px]">
                        <div>
                          <p className="mb-1 text-muted-foreground text-xs">
                            NO bids (1−ask)
                          </p>
                          {bookData.legB.asks.slice(0, 3).map((a, i) => (
                            <div
                              key={i}
                              className="flex justify-between tabular-nums text-xs"
                            >
                              <span className="text-emerald-600 font-medium">
                                {(1 - a.price).toFixed(3)}
                              </span>
                              <span className="text-muted-foreground">
                                {a.size.toFixed(0)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="mb-1 text-muted-foreground text-xs">
                            NO asks (1−bid)
                          </p>
                          {bookData.legB.bids.slice(0, 3).map((b, i) => (
                            <div
                              key={i}
                              className="flex justify-between tabular-nums text-xs"
                            >
                              <span className="text-red-500 font-medium">
                                {(1 - b.price).toFixed(3)}
                              </span>
                              <span className="text-muted-foreground">
                                {b.size.toFixed(0)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── P&L chart ── */}
              <div>
                <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      P&amp;L Analysis
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-950">
                      Net P&amp;L vs. repair amount
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {spreadCalc
                        ? "Live — sized from CLOB top-of-book."
                        : "Illustrative until CLOB book loads."}
                    </p>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="inline-block h-0.5 w-4 rounded-full bg-[#00C805]" />
                      <span className="font-medium">Net P&amp;L</span>
                    </span>
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="inline-block h-0.5 w-4 rounded-full bg-[#FF5000]" />
                      <span className="font-medium">Break-even</span>
                    </span>
                  </div>
                </div>
                <div className="chart-container relative h-44 rounded-xl border border-slate-200/80 bg-white/50 p-4 shadow-sm backdrop-blur-sm">
                  <canvas ref={pnlChartRef} />
                </div>
              </div>

              {/* ── Summary stats ── */}
              <div>
                <p className="mb-4 text-sm font-semibold text-slate-950 uppercase tracking-widest text-muted-foreground">
                  Summary
                </p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    {
                      label: "Net cost",
                      value: spreadCalc
                        ? `$${spreadCalc.netCost.toFixed(2)}`
                        : "—",
                      tooltip:
                        "Total upfront spend across both legs. This is your maximum possible loss if both sides go to zero.",
                    },
                    {
                      label: "All-in friction",
                      value: spreadCalc
                        ? `$${spreadCalc.totalFriction.toFixed(2)}`
                        : "—",
                      valueCls: "text-amber-600",
                      tooltip:
                        "Estimated transaction costs — half-spread slippage on both legs combined. Subtracted from your gross P&L.",
                    },
                    {
                      label: "Break-even repair",
                      value: spreadCalc
                        ? `${spreadCalc.breakevenRepairPp.toFixed(1)} pts`
                        : "—",
                      tooltip:
                        "The minimum amount the dislocation must close (in percentage points) for you to cover friction costs and not lose money.",
                    },
                    {
                      label: "Edge after spread",
                      value: spreadCalc
                        ? `${spreadCalc.edgePp.toFixed(1)} pts`
                        : "—",
                      valueCls: spreadCalc
                        ? spreadCalc.edgePp > 0
                          ? "text-emerald-600"
                          : "text-red-600"
                        : "",
                      tooltip:
                        "How much of the raw dislocation remains after subtracting friction. This is your net opportunity — the cushion above break-even.",
                    },
                  ].map(({ label, value, valueCls, tooltip }) => (
                    <div
                      key={label}
                      className="rounded-xl border border-slate-200/80 bg-gradient-to-br from-white/90 to-slate-50/50 px-5 py-4 shadow-sm"
                    >
                      <div className="mb-2 flex items-center gap-1.5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          {label}
                        </p>
                        <Tooltip text={tooltip} />
                      </div>
                      <p
                        className={`text-lg font-bold tabular-nums tracking-[-0.03em] ${valueCls ?? "text-slate-950"}`}
                      >
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Evidence ── */}
              <div>
                <div className="mb-4 flex items-center justify-between gap-2 border-b border-slate-200 pb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Evidence Analysis
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-950">
                      PIT leave-one-out backtest
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {analyticsData?.backtest
                        ? "Computed from 30-day daily CLOB history with point-in-time sigma triggers."
                        : analyticsLoading
                          ? "Loading 30-day history…"
                          : "Select a live family to compute backtest."}
                    </p>
                  </div>
                  {analyticsLoading && (
                    <span className="text-xs text-muted-foreground">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300 animate-pulse mr-1" />
                      Computing…
                    </span>
                  )}
                </div>
                {(() => {
                  const bt = analyticsData?.backtest;
                  const fmt = (v, prefix = "") =>
                    v == null
                      ? "—"
                      : `${prefix}$${Math.abs(v).toFixed(2)} / $100`;
                  const confidence = bt?.confidence ?? null;
                  const confLabel =
                    confidence === "high"
                      ? "High (10+ episodes)"
                      : confidence === "moderate"
                        ? "Moderate (5–9)"
                        : confidence === "low"
                          ? "Low (< 5)"
                          : confidence === "insufficient"
                            ? "Insufficient data"
                            : "—";
                  const cells = [
                    {
                      label: "Episodes detected",
                      value: bt ? String(bt.episodes) : "—",
                      cls: "",
                    },
                    {
                      label: "Confidence",
                      value: confLabel,
                      cls:
                        confidence === "high"
                          ? "text-emerald-600"
                          : confidence === "moderate"
                            ? "text-amber-600"
                            : "text-muted-foreground",
                    },
                    {
                      label: "LOO win rate",
                      value:
                        bt?.looWinRate != null
                          ? `${bt.looWins} / ${bt.episodes} (${(bt.looWinRate * 100).toFixed(0)}%)`
                          : "—",
                      cls:
                        bt?.looWinRate >= 0.6
                          ? "text-emerald-600"
                          : "text-amber-600",
                    },
                    {
                      label: "Median P&L",
                      value: fmt(bt?.medianPnl, bt?.medianPnl >= 0 ? "+" : "-"),
                      cls:
                        bt?.medianPnl >= 0
                          ? "text-emerald-600"
                          : "text-red-600",
                    },
                    {
                      label: "25th percentile",
                      value: fmt(bt?.p25Pnl, bt?.p25Pnl >= 0 ? "+" : "-"),
                      cls:
                        bt?.p25Pnl >= 0 ? "text-emerald-600" : "text-amber-600",
                    },
                    {
                      label: "Worst loss",
                      value: fmt(bt?.worstLoss, bt?.worstLoss >= 0 ? "+" : "-"),
                      cls:
                        bt?.worstLoss >= 0
                          ? "text-emerald-600"
                          : "text-red-600",
                    },
                  ];
                  return (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {cells.map(({ label, value, cls }) => (
                        <div
                          key={label}
                          className="rounded-xl border border-slate-200/80 bg-gradient-to-br from-white/90 to-slate-50/50 px-5 py-4 shadow-sm"
                        >
                          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            {label}
                          </p>
                          <p
                            className={`font-bold text-base ${cls || "text-slate-900"}`}
                          >
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {analyticsData?.backtest && (
                  <p className="mt-3 text-[11px] text-muted-foreground bg-slate-50 rounded-lg px-3 py-2">
                    <span className="font-semibold">Trigger:</span> sigma
                    reaches 2.0 or higher.{" "}
                    <span className="font-semibold">Close:</span> sigma falls to
                    0.5 or lower, or the trade hits a 7-day timeout.{" "}
                    <span className="font-semibold">Friction:</span> 2% per
                    round-trip.
                  </p>
                )}
              </div>

              {/* ── Model risk ── */}
              <Alert className="border-amber-200 bg-amber-50/80 rounded-lg">
                <AlertDescription className="text-sm leading-6 text-amber-800">
                  {analyticsData
                    ? "Sigma score and backtest are computed from live 30-day CLOB history. Small episode counts mean wide confidence intervals, so treat the evidence bands as directional rather than precise."
                    : spreadCalc
                      ? "Sizing and friction are computed from live CLOB top-of-book. Sigma score and backtest load alongside the 30-day history."
                      : "Friction is a conservative proxy. Book depth and sigma score load when a live family is selected."}
                </AlertDescription>
              </Alert>

              {/* ── Actions ── */}
              <div className="flex flex-col gap-3 sm:flex-row pt-2">
                <Button
                  size="lg"
                  className="bg-slate-950 px-8 font-semibold text-white hover:bg-slate-800"
                  onClick={() => setOrderModalOpen(true)}
                >
                  Build spread order
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-slate-200 bg-white px-8 text-slate-900 hover:bg-slate-50"
                  onClick={() => setReplayOpen(true)}
                >
                  View replay
                </Button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
