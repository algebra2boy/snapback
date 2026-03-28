import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  fetchFamilies,
  SEED_ROWS,
  computeNoArbEnvelope,
  getQuestion,
} from "@/lib/gammaApi";

// ── P&L chart config (spread builder — still static until CLOB is wired in) ──
const REPAIR_PCTS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const PNL_DATA = REPAIR_PCTS.map((r) => {
  const legA = 263 * (r / 100);
  const legB = 172 * (r / 100);
  return Math.round((legA + legB - 4.82) * 100) / 100;
});

// ── Small presentational components ──────────────────────────────────────────

function MetricCard({ label, value, valueCls, tooltip }) {
  return (
    <div className="bg-muted/60 rounded-lg p-2.5">
      <div className="flex items-center gap-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        {tooltip && (
          <div className="relative group">
            <Info className="size-3 text-muted-foreground/50 cursor-help shrink-0" />
            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 rounded-md bg-popover border border-border px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50">
              {tooltip}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
            </div>
          </div>
        )}
      </div>
      <p className={`text-base font-medium mt-0.5 ${valueCls ?? ""}`}>{value}</p>
    </div>
  );
}

function LegCard({ leg, title, rows }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] text-muted-foreground">{leg}</p>
      <p className="text-[15px] font-medium mt-1 mb-2">{title}</p>
      <div className="grid grid-cols-2 gap-y-1 text-xs">
        {rows.map(([label, value, cls]) => (
          <>
            <span key={label} className="text-muted-foreground">{label}</span>
            <span key={value} className={`text-right ${cls ?? ""}`}>{value}</span>
          </>
        ))}
      </div>
    </div>
  );
}

function DepthCard({ title, rows }) {
  return (
    <div className="bg-muted/60 rounded-lg p-2.5 text-xs">
      <p className="font-medium mb-1.5">{title}</p>
      <div className="grid grid-cols-2 gap-y-0.5">
        {rows.map(([label, value, cls]) => (
          <>
            <span key={label} className="text-muted-foreground">{label}</span>
            <span key={value} className={`text-right ${cls ?? ""}`}>{value}</span>
          </>
        ))}
      </div>
    </div>
  );
}

// ── Freshness badge ───────────────────────────────────────────────────────────

function FreshnessBadge({ dataAge, isSeed }) {
  if (isSeed) {
    return (
      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
        Offline · seed data
      </Badge>
    );
  }
  if (!dataAge) return null;
  const seconds = Math.floor((Date.now() - dataAge) / 1000);
  if (seconds < 60) {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
        Live · {seconds}s ago
      </Badge>
    );
  }
  const minutes = Math.floor(seconds / 60);
  return (
    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
      Cached · {minutes}m ago
    </Badge>
  );
}

// ── Main terminal ─────────────────────────────────────────────────────────────

export default function PolymarketRelativeValueTerminal() {
  const strikeChartRef = useRef(null);
  const pnlChartRef    = useRef(null);
  const strikeChart    = useRef(null); // Chart.js instance
  const pnlChart       = useRef(null); // Chart.js instance

  const [scannerRows, setScannerRows] = useState(SEED_ROWS);
  const [loading, setLoading]         = useState(true);
  const [isSeed, setIsSeed]           = useState(true);
  const [dataAge, setDataAge]         = useState(null);
  // Hero family: first strike-ladder row, used for Screen 2 + 3
  const [heroFamily, setHeroFamily]   = useState(null);

  // ── Fetch live families from Gamma API ──
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
          // Pick the best strike-ladder family for the visualizer
          const best =
            rows.find(r => r.type === "Strike ladder" && r.rawDislocation > 0) ??
            rows[0];
          setHeroFamily(best);
        }
      } catch (err) {
        // API down — seed data already shown, just log
        console.warn("Gamma API unavailable, using seed data:", err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Initialise charts (once, on mount) ──
  useEffect(() => {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const grid   = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
    const txt    = isDark ? "rgba(255,255,255,0.6)"  : "rgba(0,0,0,0.5)";

    strikeChart.current = new Chart(strikeChartRef.current, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "No-arb upper bound",
            data: [],
            borderColor: "rgba(31,158,117,0.3)",
            backgroundColor: "rgba(31,158,117,0.06)",
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
            callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}¢` },
          },
        },
        scales: {
          y: {
            title: { display: true, text: "Probability (¢)", color: txt, font: { size: 12 } },
            min: 0,
            grid: { color: grid },
            ticks: { color: txt, font: { size: 11 }, callback: (v) => `${v}¢` },
          },
          x: {
            title: { display: true, text: "Strike", color: txt, font: { size: 12 } },
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
            borderColor: "#1D9E75",
            backgroundColor: "rgba(31,158,117,0.1)",
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: "#1D9E75",
            tension: 0.2,
          },
          {
            label: "Break-even",
            data: REPAIR_PCTS.map(() => 0),
            borderColor: "#E24B4A",
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
        plugins: { legend: { display: false } },
        scales: {
          y: {
            title: { display: true, text: "Net P&L ($)", color: txt, font: { size: 11 } },
            grid: { color: grid },
            ticks: {
              color: txt,
              font: { size: 11 },
              callback: (v) => `${v < 0 ? "-" : ""}$${Math.abs(v)}`,
            },
          },
          x: {
            title: { display: true, text: "Dislocation repair amount", color: txt, font: { size: 11 } },
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

  // ── Update strike chart whenever heroFamily changes ──
  useEffect(() => {
    if (!strikeChart.current || !heroFamily || !heroFamily.markets.length) return;

    const prices  = heroFamily.markets.map(m => m.yesPrice * 100);
    const envelope = computeNoArbEnvelope(prices);

    // Red dot if the price is above the no-arb envelope at that index
    const dotColors = prices.map((p, i) =>
      p > envelope[i] ? "#E24B4A" : "#378ADD"
    );

    const chart = strikeChart.current;
    chart.data.labels                              = heroFamily.labels;
    chart.data.datasets[0].data                   = envelope;
    chart.data.datasets[1].data                   = prices;
    chart.data.datasets[1].pointBackgroundColor   = dotColors;
    chart.data.datasets[1].pointBorderColor       = dotColors;
    chart.update();
  }, [heroFamily]);

  // ── Derived KPI values ──
  const actionableCount = scannerRows.filter(r => r.status === "Actionable").length;
  const dislocatedCount = scannerRows.filter(r => r.rawDislocation > 0).length;

  // ── Violation alert text for Screen 2 ──
  function violationAlertText() {
    if (!heroFamily || !heroFamily.dislocation) return null;
    const { violatingPair, rawDislocation } = heroFamily.dislocation;
    if (!violatingPair || rawDislocation <= 0) return null;
    const [low, high] = violatingPair;
    const pHigh = (high.yesPrice * 100).toFixed(1);
    const pLow  = (low.yesPrice  * 100).toFixed(1);
    const pp    = (rawDislocation * 100).toFixed(1);
    const qHigh = getQuestion(high).slice(0, 50);
    const qLow  = getQuestion(low).slice(0, 50);
    return `Violation detected: ${qHigh} = ${pHigh}¢ but ${qLow} = ${pLow}¢. The higher-strike market is priced ${pp}pp above — this violates monotonicity.`;
  }

  const alertText = violationAlertText();

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="py-4 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-medium">Polymarket relative value terminal</h1>
          <p className="text-sm text-muted-foreground mt-0.5">No-arb surface for prediction markets</p>
        </div>
        <div className="flex gap-2 items-center">
          <FreshnessBadge dataAge={dataAge} isSeed={isSeed} />
          {loading && (
            <span className="text-xs text-muted-foreground animate-pulse">Fetching…</span>
          )}
          <Badge variant="secondary">Replay available</Badge>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-3 gap-3">
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">Families scanned</p>
            <p className="text-2xl font-medium mt-0.5">
              {loading ? "—" : scannerRows.length}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">Dislocations found</p>
            <p className="text-2xl font-medium mt-0.5">
              {loading ? "—" : dislocatedCount}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">Actionable (≥4pp)</p>
            <p className={`text-2xl font-medium mt-0.5 ${actionableCount > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
              {loading ? "—" : actionableCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Screen 1 · Dislocation scanner ── */}
      <section>
        <p className="text-sm font-medium mb-2">Screen 1 · Dislocation scanner</p>
        <Card className="p-0 gap-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Family</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Dislocation</TableHead>
                <TableHead>Constraint</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scannerRows.map((row) => (
                <TableRow
                  key={row.family}
                  className="cursor-pointer"
                  onClick={() => !row.isSeed && setHeroFamily(row)}
                >
                  <TableCell className="font-medium">{row.family}</TableCell>
                  <TableCell>
                    <Badge className={row.typeCls}>{row.type}</Badge>
                  </TableCell>
                  <TableCell className={`text-right font-medium ${row.severityCls}`}>
                    {row.severity}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{row.constraint}</TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={row.statusCls ? undefined : "secondary"}
                      className={row.statusCls || undefined}
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        {!isSeed && (
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Severity shown as raw pp until CLOB price history is wired in for σ normalization. Click a row to visualize.
          </p>
        )}
      </section>

      {/* ── Screen 2 · Dislocation visualizer ── */}
      <section>
        <p className="text-sm font-medium mb-2">
          Screen 2 · Dislocation visualizer —{" "}
          {heroFamily ? heroFamily.family : "loading…"}
        </p>
        <Card>
          <CardHeader>
            <CardTitle>{heroFamily ? heroFamily.family : "—"}</CardTitle>
            <CardDescription>
              {heroFamily?.dislocation?.constraintDesc
                ? `Constraint: ${heroFamily.dislocation.constraintDesc}`
                : "Constraint: probability must decrease as strike increases"}
            </CardDescription>
            <CardAction>
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                  {heroFamily?.type ?? "Strike ladder"}
                </Badge>
                <span className="text-xs text-muted-foreground">family type</span>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative h-64">
              <canvas ref={strikeChartRef} />
            </div>

            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-emerald-500/20" />
                No-arb envelope
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-[#378ADD]" />
                Market prices
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-[#E24B4A]" />
                Violation
              </span>
            </div>

            {alertText ? (
              <Alert className="bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-900">
                <AlertDescription className="text-red-800 dark:text-red-300">
                  {alertText}
                </AlertDescription>
              </Alert>
            ) : heroFamily && heroFamily.rawDislocation === 0 ? (
              <Alert className="bg-muted border-border">
                <AlertDescription className="text-muted-foreground">
                  No violation detected in this family. All prices satisfy the monotonicity constraint.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid grid-cols-4 gap-2">
              <MetricCard
                label="Dislocation"
                value={heroFamily ? `${(heroFamily.rawDislocation * 100).toFixed(1)}pp` : "—"}
                valueCls={heroFamily?.severityCls}
              />
              <MetricCard label="Markets in family" value={heroFamily ? heroFamily.markets.length : "—"} />
              <MetricCard label="Status" value={heroFamily?.status ?? "—"} />
              <MetricCard label="Type" value={heroFamily?.type ?? "—"} />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Screen 3 · Spread builder ── */}
      <section>
        <p className="text-sm font-medium mb-2">Screen 3 · Spread builder</p>
        <Card>
          <CardHeader>
            <CardTitle>Corrective spread</CardTitle>
            <CardAction>
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                Auto-generated
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Direction is structurally implied: the higher-strike market must fall or the lower-strike
              market must rise. Both legs correct the violation.
            </p>

            {/* Legs */}
            <div className="grid grid-cols-2 gap-3">
              <LegCard
                leg="Leg A · Buy YES"
                title={
                  heroFamily?.dislocation?.violatingPair
                    ? getQuestion(heroFamily.dislocation.violatingPair[0]).slice(0, 40)
                    : "BTC above $90k"
                }
                rows={[
                  ["Token", heroFamily?.dislocation?.violatingPair
                    ? `YES @ $${heroFamily.dislocation.violatingPair[0].yesPrice.toFixed(2)}`
                    : "YES @ $0.38"],
                  ["Shares", "263"],
                  ["Cost", "$99.94"],
                  ["Max gain", "+$163.06", "text-emerald-600 dark:text-emerald-400"],
                ]}
              />
              <LegCard
                leg="Leg B · Buy NO"
                title={
                  heroFamily?.dislocation?.violatingPair
                    ? getQuestion(heroFamily.dislocation.violatingPair[1]).slice(0, 40)
                    : "BTC above $100k"
                }
                rows={[
                  ["Token", heroFamily?.dislocation?.violatingPair
                    ? `NO @ $${(1 - heroFamily.dislocation.violatingPair[1].yesPrice).toFixed(2)}`
                    : "NO @ $0.58"],
                  ["Shares", "172"],
                  ["Cost", "$99.76"],
                  ["Max gain", "+$72.24", "text-emerald-600 dark:text-emerald-400"],
                ]}
              />
            </div>

            {/* Market depth */}
            <div>
              <p className="text-sm font-medium mb-2">Market depth</p>
              <div className="grid grid-cols-2 gap-3">
                <DepthCard
                  title={heroFamily?.dislocation?.violatingPair
                    ? getQuestion(heroFamily.dislocation.violatingPair[0]).slice(0, 30) + " YES"
                    : "BTC >$90k YES"}
                  rows={[
                    ["Best ask", heroFamily?.dislocation?.violatingPair
                      ? `$${(heroFamily.dislocation.violatingPair[0].yesPrice + 0.01).toFixed(2)}`
                      : "$0.39"],
                    ["Spread", "1.8%"],
                    ["Depth at ask", "$48k"],
                    ["Est. fill (263 sh)", heroFamily?.dislocation?.violatingPair
                      ? `$${(heroFamily.dislocation.violatingPair[0].yesPrice + 0.001).toFixed(3)}`
                      : "$0.391"],
                    ["Slippage", "0.3%", "text-amber-600 dark:text-amber-400"],
                  ]}
                />
                <DepthCard
                  title={heroFamily?.dislocation?.violatingPair
                    ? getQuestion(heroFamily.dislocation.violatingPair[1]).slice(0, 30) + " NO"
                    : "BTC >$100k NO"}
                  rows={[
                    ["Best ask", heroFamily?.dislocation?.violatingPair
                      ? `$${(1 - heroFamily.dislocation.violatingPair[1].yesPrice + 0.01).toFixed(2)}`
                      : "$0.59"],
                    ["Spread", "2.1%"],
                    ["Depth at ask", "$32k"],
                    ["Est. fill (172 sh)", heroFamily?.dislocation?.violatingPair
                      ? `$${(1 - heroFamily.dislocation.violatingPair[1].yesPrice + 0.004).toFixed(3)}`
                      : "$0.594"],
                    ["Slippage", "0.7%", "text-amber-600 dark:text-amber-400"],
                  ]}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Depth and slippage estimates require CLOB /book integration (Phase 2).
              </p>
            </div>

            {/* P&L chart */}
            <div>
              <p className="text-sm font-medium mb-2">P&amp;L vs. partial repair</p>
              <div className="relative h-48">
                <canvas ref={pnlChartRef} />
              </div>
              <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-[#1D9E75]" />
                  Net P&amp;L after fees
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-0.5 bg-[#E24B4A]" />
                  Break-even line
                </span>
              </div>
            </div>

            {/* Summary metrics */}
            <div className="grid grid-cols-4 gap-2">
              <MetricCard
                label="Net cost"
                value="$199.70"
                tooltip="Total upfront spend across both legs. This is your maximum possible loss if both sides go to zero."
              />
              <MetricCard
                label="All-in friction"
                value="$4.82"
                valueCls="text-amber-600 dark:text-amber-400"
                tooltip="Estimated transaction costs — bid/ask spread and slippage on both legs combined. Subtracted from your gross P&L."
              />
              <MetricCard
                label="Break-even repair"
                value="1.2pp"
                tooltip="The minimum amount the dislocation must close (in percentage points) for you to cover friction costs and not lose money."
              />
              <MetricCard
                label="Edge after spread"
                value="2.8pp"
                valueCls="text-emerald-600 dark:text-emerald-400"
                tooltip="How much of the raw dislocation remains after subtracting friction. This is your net opportunity — the cushion above break-even."
              />
            </div>

            {/* Evidence */}
            <div>
              <p className="text-sm font-medium mb-2">Evidence (PIT, leave-one-out)</p>
              <div className="bg-muted/60 rounded-lg p-3">
                <div className="grid grid-cols-3 gap-3 text-xs">
                  {[
                    ["Episodes", "8 (high confidence)", ""],
                    ["LOO wins", "6/8 (75%)", ""],
                    ["Median P&L", "+$8.40 / $100", "text-emerald-600 dark:text-emerald-400"],
                    ["25th pctl", "-$4.20 / $100", "text-amber-600 dark:text-amber-400"],
                    ["Worst loss", "-$18.50 / $100", "text-red-600 dark:text-red-400"],
                    ["Friction scenario", "Base (1.0×)", ""],
                  ].map(([label, value, cls]) => (
                    <div key={label}>
                      <p className="text-muted-foreground">{label}</p>
                      <p className={`font-medium mt-0.5 ${cls}`}>{value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Episode history requires CLOB /prices-history integration (Phase 2).
                </p>
              </div>
            </div>

            {/* Model risk */}
            <div>
              <p className="text-sm font-medium mb-2">Model risk</p>
              <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900">
                <AlertDescription className="text-amber-900 dark:text-amber-300">
                  Friction is a conservative proxy (current spreads, not historical). Structural
                  constraint is definitional for identically-worded strike markets. Depth and sigma
                  normalization require CLOB integration.
                </AlertDescription>
              </Alert>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700 text-white w-full">
                Build spread order
              </Button>
              <Button size="lg" variant="outline" className="w-full">
                View replay (best + worst)
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

    </div>
  );
}
