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
      <Info className="size-3 text-muted-foreground/55 cursor-help" />
      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-xl border border-border/80 bg-white/98 px-3 py-2 text-[11px] leading-relaxed text-popover-foreground opacity-0 shadow-[0_18px_48px_rgba(15,23,42,0.14)] transition-opacity group-hover:opacity-100">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
      </div>
    </div>
  );
}

// ── Stat cell (used in the horizontal stats bar) ──────────────────────────────
function StatCell({ label, value, valueCls, tooltip, border = true }) {
  return (
    <div className={`px-5 py-4 md:px-6 ${border ? "border-r border-border/80" : ""}`}>
      <div className="mb-1 flex items-center gap-1.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        {tooltip && <Tooltip text={tooltip} />}
      </div>
      <p className={`text-[15px] font-semibold tracking-[-0.02em] ${valueCls ?? ""}`}>{value ?? "—"}</p>
    </div>
  );
}

// ── Freshness badge ───────────────────────────────────────────────────────────
function FreshnessBadge({ dataAge, isSeed }) {
  if (isSeed) return (
    <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-600">Offline · seed data</span>
  );
  if (!dataAge) return null;
  const seconds = Math.floor((Date.now() - dataAge) / 1000);
  if (seconds < 60) return (
    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">Live · {seconds}s ago</span>
  );
  return (
    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600">Cached · {Math.floor(seconds / 60)}m ago</span>
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
    const grid = "rgba(148,163,184,0.18)";
    const txt = "rgba(71,85,105,0.92)";

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
            backgroundColor: "#ffffff",
            titleColor: "#111827",
            bodyColor: "rgba(15,23,42,0.72)",
            borderColor: "rgba(15,23,42,0.1)",
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
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Top nav bar ── */}
      <header className="sticky top-0 z-20 border-b border-border/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white shadow-sm">
              S
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold tracking-tight">Snapback</span>
                <span className="text-sm text-muted-foreground">No-arb Terminal</span>
              </div>
              <p className="hidden text-xs text-muted-foreground md:block">
                Scan structurally linked markets, inspect the violated surface, then price the corrective spread.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-5 text-sm md:flex">
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
                <span className={`font-semibold ${actionableCount > 0 ? "text-emerald-600" : ""}`}>
                  {loading ? "—" : actionableCount}
                </span>
              </span>
            </div>
            <FreshnessBadge dataAge={dataAge} isSeed={isSeed} />
            {loading && <span className="text-xs text-muted-foreground animate-pulse">Fetching…</span>}
          </div>
        </div>
      </header>

      {/* ── Body: sidebar + main ── */}
      <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:px-8 lg:py-6">

        {/* ── Scanner sidebar ── */}
        <aside className="glass-panel w-full shrink-0 overflow-hidden lg:sticky lg:top-20 lg:h-[calc(100vh-112px)] lg:w-72">
          <div className="border-b border-border/80 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Scanner
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Ranked by live raw dislocation from current Gamma event discovery.
            </p>
          </div>
          <div className="max-h-[26rem] space-y-2 overflow-y-auto p-3 lg:max-h-[calc(100vh-202px)]">
            {scannerRows.map((row) => (
              <button
                key={row.family}
                onClick={() => !row.isSeed && setHeroFamily(row)}
                className={`scanner-item w-full text-left px-4 py-3.5 ${
                  heroFamily?.family === row.family ? "scanner-item-active" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium leading-snug text-slate-900">{row.family}</span>
                  <span className={`text-xs font-bold shrink-0 tabular-nums ${row.severityCls}`}>
                    {row.severity}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">
                    {row.type}
                  </span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                    row.status === "Actionable" ? "bg-emerald-100 text-emerald-700" :
                    row.status === "Watchlist"  ? "bg-amber-100 text-amber-700" :
                    "bg-slate-100 text-slate-500"
                  }`}>
                    {row.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="min-w-0 flex-1 space-y-4">

          {/* ── Family header + chart ── */}
          <section className="glass-panel overflow-hidden">

            {/* Title row */}
            <div className="soft-grid border-b border-border/80 px-6 pb-6 pt-7 sm:px-8">
              <div className="mb-6 flex flex-col items-start justify-between gap-6 lg:flex-row">
                <div className="max-w-2xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Selected family
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-[-0.04em] text-slate-950">
                    {heroFamily?.family ?? "—"}
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    {heroFamily?.dislocation?.constraintDesc ?? "Select a family from the scanner"}
                  </p>
                  {alertText && (
                    <p className="mt-4 flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                      <span className="shrink-0 mt-px">⚠</span>
                      {alertText}
                    </p>
                  )}
                </div>
                <div className="min-w-[140px] rounded-3xl border border-slate-200/80 bg-white/85 px-5 py-4 text-left shadow-sm lg:text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Current signal</p>
                  <p className={`mt-2 text-4xl font-bold tracking-[-0.06em] tabular-nums ${heroFamily?.severityCls ?? ""}`}>
                    {heroFamily?.severity ?? "—"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{heroFamily?.status ?? "—"}</p>
                </div>
              </div>

              {/* Chart */}
              <div className="relative h-72 overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/88 p-4 shadow-[0_12px_40px_rgba(15,23,42,0.06)]">
                <canvas ref={strikeChartRef} />
              </div>

              {/* Legend */}
              <div className="mt-4 flex flex-wrap gap-5 text-xs text-muted-foreground">
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
            </div>

          </section>

          {/* ── Stats bar ── */}
          <div className="glass-panel grid grid-cols-2 overflow-hidden md:grid-cols-4">
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
          <section className="glass-panel overflow-hidden">
            <div className="border-b border-border/80 px-6 py-5 sm:px-8">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Spread builder
                  </p>
                  <h3 className="mt-2 text-base font-semibold text-slate-950">Corrective spread</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Direction is structurally implied. The UI stays explicit about what is live versus what is still proxy data.
                  </p>
                </div>
                <Badge className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                  Auto-generated
                </Badge>
              </div>
            </div>

            <div className="space-y-8 px-6 py-7 sm:px-8">
              {/* ── Two legs ── */}
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Leg A */}
                <div className="rounded-[28px] border border-slate-200/80 bg-white/84 p-5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Leg A · Buy YES
                  </p>
                  <p className="mb-4 mt-3 text-base font-medium leading-snug text-slate-950">
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
                        <span className={`font-medium ${label === "Max gain" ? "text-emerald-600" : "text-slate-900"}`}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Leg B */}
                <div className="rounded-[28px] border border-slate-200/80 bg-white/84 p-5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Leg B · Buy NO
                  </p>
                  <p className="mb-4 mt-3 text-base font-medium leading-snug text-slate-950">
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
                        <span className={`font-medium ${label === "Max gain" ? "text-emerald-600" : "text-slate-900"}`}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── P&L chart ── */}
              <div>
                <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">P&amp;L vs. repair amount</p>
                    <p className="mt-1 text-sm text-muted-foreground">Illustrative until CLOB-backed spread economics replace the placeholder curve.</p>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-3 rounded bg-[#00C805]" />
                      Net P&amp;L
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-0.5 w-3 rounded bg-[#FF5000]" />
                      Break-even
                    </span>
                  </div>
                </div>
                <div className="relative h-44 rounded-[28px] border border-slate-200/80 bg-white/84 p-4 shadow-sm">
                  <canvas ref={pnlChartRef} />
                </div>
              </div>

              {/* ── Summary stats ── */}
              <div>
                <p className="mb-3 text-sm font-semibold text-slate-950">Summary</p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    {
                      label: "Net cost",
                      value: "$199.70",
                      tooltip: "Total upfront spend across both legs. This is your maximum possible loss if both sides go to zero.",
                    },
                    {
                      label: "All-in friction",
                      value: "$4.82",
                      valueCls: "text-amber-600",
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
                      valueCls: "text-emerald-600",
                      tooltip: "How much of the raw dislocation remains after subtracting friction. This is your net opportunity — the cushion above break-even.",
                    },
                  ].map(({ label, value, valueCls, tooltip }) => (
                    <div key={label} className="rounded-[24px] border border-slate-200/80 bg-white/84 px-5 py-4 shadow-sm">
                      <div className="mb-1 flex items-center gap-1.5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                        <Tooltip text={tooltip} />
                      </div>
                      <p className={`text-lg font-semibold tabular-nums tracking-[-0.03em] ${valueCls ?? "text-slate-950"}`}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Evidence ── */}
              <div>
                <div className="mb-3 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Evidence · PIT leave-one-out</p>
                    <p className="mt-1 text-sm text-muted-foreground">Still a presentation placeholder until `/prices-history` powers the evidence layer.</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {[
                    ["Episodes",        "8 (high confidence)", ""],
                    ["LOO wins",        "6 / 8 (75%)",          ""],
                    ["Median P&L",      "+$8.40 / $100",        "text-emerald-600"],
                    ["25th percentile", "-$4.20 / $100",        "text-amber-600"],
                    ["Worst loss",      "-$18.50 / $100",       "text-red-600"],
                    ["Friction",        "Base (1.0×)",           ""],
                  ].map(([label, value, cls]) => (
                    <div key={label} className="rounded-[24px] border border-slate-200/80 bg-white/84 px-5 py-4 shadow-sm">
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                      <p className={`font-medium ${cls || "text-slate-900"}`}>{value}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Episode history requires CLOB /prices-history integration (Phase 2).
                </p>
              </div>

              {/* ── Model risk ── */}
              <Alert className="border-amber-200 bg-amber-50">
                <AlertDescription className="text-sm leading-6 text-amber-800">
                  Friction is a conservative proxy. Depth and σ normalization are not yet live-computed, so the UI keeps those areas framed as incomplete evidence rather than definitive analytics.
                </AlertDescription>
              </Alert>

              {/* ── Actions ── */}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button size="lg" className="bg-slate-950 px-8 font-semibold text-white hover:bg-slate-800">
                  Build spread order
                </Button>
                <Button size="lg" variant="outline" className="border-slate-200 bg-white px-8 text-slate-900 hover:bg-slate-50">
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
