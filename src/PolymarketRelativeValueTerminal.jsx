import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  fetchFamilies,
  SEED_ROWS,
  computeNoArbEnvelope,
  getQuestion,
} from "@/lib/gammaApi";

// ── P&L chart data (static until CLOB is wired in) ───────────────────────────
const REPAIR_PCTS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const PNL_DATA = REPAIR_PCTS.map((r) => {
  const legA = 263 * (r / 100);
  const legB = 172 * (r / 100);
  return Math.round((legA + legB - 4.82) * 100) / 100;
});

// ── Tooltip ───────────────────────────────────────────────────────────────────
function Tooltip({ text }) {
  return (
    <div className="relative group inline-flex">
      <Info className="size-3 text-muted-foreground/40 cursor-help" />
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-popover border border-border px-3 py-2 text-[11px] text-popover-foreground shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 leading-relaxed">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
      </div>
    </div>
  );
}

// ── Stat cell (used in the horizontal stats bar) ──────────────────────────────
function StatCell({ label, value, valueCls, tooltip, border = true }) {
  return (
    <div className={`px-6 py-4 ${border ? "border-r border-border" : ""}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        {tooltip && <Tooltip text={tooltip} />}
      </div>
      <p className={`text-[15px] font-semibold ${valueCls ?? ""}`}>{value ?? "—"}</p>
    </div>
  );
}

// ── Freshness badge ───────────────────────────────────────────────────────────
function FreshnessBadge({ dataAge, isSeed }) {
  if (isSeed) return (
    <span className="text-xs text-red-500 font-medium">● Offline · seed data</span>
  );
  if (!dataAge) return null;
  const seconds = Math.floor((Date.now() - dataAge) / 1000);
  if (seconds < 60) return (
    <span className="text-xs text-emerald-500 font-medium">● Live · {seconds}s ago</span>
  );
  return (
    <span className="text-xs text-amber-500 font-medium">● Cached · {Math.floor(seconds / 60)}m ago</span>
  );
}

// ── Main terminal ─────────────────────────────────────────────────────────────
export default function PolymarketRelativeValueTerminal() {
  const strikeChartRef = useRef(null);
  const pnlChartRef    = useRef(null);
  const strikeChart    = useRef(null);
  const pnlChart       = useRef(null);

  const [scannerRows, setScannerRows] = useState(SEED_ROWS);
  const [loading, setLoading]         = useState(true);
  const [isSeed, setIsSeed]           = useState(true);
  const [dataAge, setDataAge]         = useState(null);
  const [heroFamily, setHeroFamily]   = useState(null);

  // ── Fetch ──
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
            rows.find(r => r.type === "Strike ladder" && r.rawDislocation > 0) ?? rows[0]
          );
        }
      } catch (err) {
        console.warn("Gamma API unavailable:", err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Init charts once ──
  useEffect(() => {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const grid   = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
    const txt    = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)";

    strikeChart.current = new Chart(strikeChartRef.current, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "No-arb upper bound",
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
            backgroundColor: isDark ? "#1c1c1c" : "#fff",
            titleColor: isDark ? "#fff" : "#111",
            bodyColor: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)",
            borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
            borderWidth: 1,
            callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}¢` },
          },
        },
        scales: {
          y: {
            title: { display: true, text: "Probability (¢)", color: txt, font: { size: 11 } },
            min: 0,
            grid: { color: grid },
            ticks: { color: txt, font: { size: 11 }, callback: (v) => `${v}¢` },
          },
          x: {
            title: { display: true, text: "Strike", color: txt, font: { size: 11 } },
            grid: { display: false },
            ticks: { color: txt, font: { size: 11 } },
          },
        },
      },
    });

    pnlChart.current = new Chart(pnlChartRef.current, {
      type: "line",
      data: {
        labels: REPAIR_PCTS.map((r) => `${r}pp`),
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
            backgroundColor: isDark ? "#1c1c1c" : "#fff",
            titleColor: isDark ? "#fff" : "#111",
            bodyColor: isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)",
            borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
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

    return () => {
      strikeChart.current?.destroy();
      pnlChart.current?.destroy();
    };
  }, []);

  // ── Update strike chart on heroFamily change ──
  useEffect(() => {
    if (!strikeChart.current || !heroFamily?.markets.length) return;
    const prices   = heroFamily.markets.map(m => m.yesPrice * 100);
    const envelope = computeNoArbEnvelope(prices);
    const colors   = prices.map((p, i) => p > envelope[i] ? "#FF5000" : "#378ADD");
    const c = strikeChart.current;
    c.data.labels                            = heroFamily.labels;
    c.data.datasets[0].data                  = envelope;
    c.data.datasets[1].data                  = prices;
    c.data.datasets[1].pointBackgroundColor  = colors;
    c.data.datasets[1].pointBorderColor      = colors;
    c.update();
  }, [heroFamily]);

  // ── Derived values ──
  const actionableCount = scannerRows.filter(r => r.status === "Actionable").length;
  const dislocatedCount = scannerRows.filter(r => r.rawDislocation > 0).length;

  function violationText() {
    if (!heroFamily?.dislocation) return null;
    const { violatingPair, rawDislocation } = heroFamily.dislocation;
    if (!violatingPair || rawDislocation <= 0) return null;
    const [low, high] = violatingPair;
    const pHigh = (high.yesPrice * 100).toFixed(1);
    const pLow  = (low.yesPrice  * 100).toFixed(1);
    const pp    = (rawDislocation * 100).toFixed(1);
    return `${getQuestion(high).slice(0, 50)} = ${pHigh}¢ but ${getQuestion(low).slice(0, 50)} = ${pLow}¢ — ${pp}pp violation`;
  }

  const alertText = violationText();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* ── Top nav bar ── */}
      <header className="sticky top-0 z-20 bg-background border-b border-border flex items-center justify-between px-6 h-14 shrink-0">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[15px] tracking-tight">Snapback</span>
            <span className="text-muted-foreground text-sm">/ No-arb Terminal</span>
          </div>
          {/* inline KPIs */}
          <div className="hidden md:flex items-center gap-6 text-sm">
            <span>
              <span className="text-muted-foreground">Families </span>
              <span className="font-medium">{loading ? "—" : scannerRows.length}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Dislocations </span>
              <span className="font-medium">{loading ? "—" : dislocatedCount}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Actionable </span>
              <span className={`font-semibold ${actionableCount > 0 ? "text-emerald-500" : ""}`}>
                {loading ? "—" : actionableCount}
              </span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <FreshnessBadge dataAge={dataAge} isSeed={isSeed} />
          {loading && <span className="text-xs text-muted-foreground animate-pulse">Fetching…</span>}
        </div>
      </header>

      {/* ── Body: sidebar + main ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Scanner sidebar ── */}
        <aside className="w-64 shrink-0 border-r border-border flex flex-col sticky top-14 h-[calc(100vh-56px)] overflow-y-auto">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
              Scanner
            </p>
          </div>
          {scannerRows.map((row) => (
            <button
              key={row.family}
              onClick={() => !row.isSeed && setHeroFamily(row)}
              className={`w-full text-left px-4 py-3.5 border-b border-border/50 transition-colors hover:bg-muted/40 ${
                heroFamily?.family === row.family ? "bg-muted/60 border-l-2 border-l-emerald-500" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate leading-snug">{row.family}</span>
                <span className={`text-xs font-bold shrink-0 tabular-nums ${row.severityCls}`}>
                  {row.severity}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[11px] text-muted-foreground">{row.type}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  row.status === "Actionable" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" :
                  row.status === "Watchlist"  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {row.status}
                </span>
              </div>
            </button>
          ))}
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 min-w-0 overflow-y-auto">

          {/* ── Family header + chart ── */}
          <section className="px-8 pt-7 pb-6 border-b border-border">

            {/* Title row */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold leading-tight">
                  {heroFamily?.family ?? "—"}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {heroFamily?.dislocation?.constraintDesc ?? "Select a family from the scanner"}
                </p>
                {alertText && (
                  <p className="text-sm text-red-500 dark:text-red-400 mt-2 flex items-start gap-1.5">
                    <span className="shrink-0 mt-px">⚠</span>
                    {alertText}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0 ml-8">
                <p className={`text-4xl font-bold tabular-nums ${heroFamily?.severityCls ?? ""}`}>
                  {heroFamily?.severity ?? "—"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">{heroFamily?.status ?? "—"}</p>
              </div>
            </div>

            {/* Chart */}
            <div className="relative h-72">
              <canvas ref={strikeChartRef} />
            </div>

            {/* Legend */}
            <div className="flex gap-5 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-emerald-500/20 border border-emerald-500/30" />
                No-arb envelope
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-[#378ADD]" />
                Market price
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-[#FF5000]" />
                Violation
              </span>
            </div>
          </section>

          {/* ── Stats bar ── */}
          <div className="grid grid-cols-4 border-b border-border">
            <StatCell
              label="Markets in family"
              value={heroFamily ? String(heroFamily.markets.length) : "—"}
              border
            />
            <StatCell label="Family type" value={heroFamily?.type ?? "—"} border />
            <StatCell
              label="Raw dislocation"
              value={heroFamily ? `${(heroFamily.rawDislocation * 100).toFixed(1)}pp` : "—"}
              valueCls={heroFamily?.severityCls}
              border
            />
            <StatCell label="Status" value={heroFamily?.status ?? "—"} border={false} />
          </div>

          {/* ── Spread builder ── */}
          <section className="px-8 py-7 space-y-8">

            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Corrective spread</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Direction is structurally implied — no judgment call needed.
                </p>
              </div>
              <span className="text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 px-2.5 py-1 rounded-full">
                Auto-generated
              </span>
            </div>

            {/* ── Two legs ── */}
            <div className="grid grid-cols-2 gap-px bg-border rounded-xl overflow-hidden">
              {/* Leg A */}
              <div className="bg-background p-5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                  Leg A · Buy YES
                </p>
                <p className="text-base font-medium mb-4 leading-snug">
                  {heroFamily?.dislocation?.violatingPair
                    ? getQuestion(heroFamily.dislocation.violatingPair[0]).slice(0, 50)
                    : "BTC above $90k"}
                </p>
                <div className="space-y-2.5 text-sm">
                  {[
                    ["Token", heroFamily?.dislocation?.violatingPair
                      ? `YES @ $${heroFamily.dislocation.violatingPair[0].yesPrice.toFixed(2)}`
                      : "YES @ $0.38"],
                    ["Shares", "263"],
                    ["Cost", "$99.94"],
                    ["Max gain", "+$163.06"],
                  ].map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={`font-medium ${label === "Max gain" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Leg B */}
              <div className="bg-background p-5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                  Leg B · Buy NO
                </p>
                <p className="text-base font-medium mb-4 leading-snug">
                  {heroFamily?.dislocation?.violatingPair
                    ? getQuestion(heroFamily.dislocation.violatingPair[1]).slice(0, 50)
                    : "BTC above $100k"}
                </p>
                <div className="space-y-2.5 text-sm">
                  {[
                    ["Token", heroFamily?.dislocation?.violatingPair
                      ? `NO @ $${(1 - heroFamily.dislocation.violatingPair[1].yesPrice).toFixed(2)}`
                      : "NO @ $0.58"],
                    ["Shares", "172"],
                    ["Cost", "$99.76"],
                    ["Max gain", "+$72.24"],
                  ].map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={`font-medium ${label === "Max gain" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── P&L chart ── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold">P&amp;L vs. repair amount</p>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-[#00C805] inline-block rounded" />
                    Net P&amp;L
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-[#FF5000] inline-block rounded" />
                    Break-even
                  </span>
                </div>
              </div>
              <div className="relative h-44">
                <canvas ref={pnlChartRef} />
              </div>
            </div>

            {/* ── Summary stats ── */}
            <div>
              <p className="text-sm font-semibold mb-3">Summary</p>
              <div className="grid grid-cols-4 divide-x divide-border border border-border rounded-xl">
                {[
                  {
                    label: "Net cost",
                    value: "$199.70",
                    tooltip: "Total upfront spend across both legs. This is your maximum possible loss if both sides go to zero.",
                  },
                  {
                    label: "All-in friction",
                    value: "$4.82",
                    valueCls: "text-amber-500",
                    tooltip: "Estimated transaction costs — bid/ask spread and slippage on both legs combined. Subtracted from your gross P&L.",
                  },
                  {
                    label: "Break-even repair",
                    value: "1.2pp",
                    tooltip: "The minimum amount the dislocation must close (in percentage points) for you to cover friction costs and not lose money.",
                  },
                  {
                    label: "Edge after spread",
                    value: "2.8pp",
                    valueCls: "text-emerald-500",
                    tooltip: "How much of the raw dislocation remains after subtracting friction. This is your net opportunity — the cushion above break-even.",
                  },
                ].map(({ label, value, valueCls, tooltip }, i, arr) => (
                  <div
                    key={label}
                    className={`px-5 py-4 bg-background ${
                      i === 0 ? "rounded-l-xl" : i === arr.length - 1 ? "rounded-r-xl" : ""
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <Tooltip text={tooltip} />
                    </div>
                    <p className={`text-lg font-semibold tabular-nums ${valueCls ?? ""}`}>{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Evidence ── */}
            <div>
              <p className="text-sm font-semibold mb-3">Evidence · PIT leave-one-out</p>
              <div className="grid grid-cols-3 gap-px bg-border rounded-xl overflow-hidden text-sm">
                {[
                  ["Episodes",        "8 (high confidence)", ""],
                  ["LOO wins",        "6 / 8 (75%)",          ""],
                  ["Median P&L",      "+$8.40 / $100",        "text-emerald-500"],
                  ["25th percentile", "-$4.20 / $100",        "text-amber-500"],
                  ["Worst loss",      "-$18.50 / $100",       "text-red-500"],
                  ["Friction",        "Base (1.0×)",           ""],
                ].map(([label, value, cls]) => (
                  <div key={label} className="bg-background px-5 py-3.5">
                    <p className="text-xs text-muted-foreground mb-1">{label}</p>
                    <p className={`font-medium ${cls}`}>{value}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Episode history requires CLOB /prices-history integration (Phase 2).
              </p>
            </div>

            {/* ── Model risk ── */}
            <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/50">
              <AlertDescription className="text-amber-800 dark:text-amber-300 text-sm">
                Friction is a conservative proxy (current spreads, not historical). Depth and σ
                normalization require CLOB integration. Small sample — past ≠ future.
              </AlertDescription>
            </Alert>

            {/* ── Actions ── */}
            <div className="flex gap-3">
              <Button size="lg" className="bg-[#00C805] hover:bg-[#00b004] text-white font-semibold px-8">
                Build spread order
              </Button>
              <Button size="lg" variant="outline" className="px-8">
                View replay
              </Button>
            </div>

          </section>
        </main>
      </div>
    </div>
  );
}
