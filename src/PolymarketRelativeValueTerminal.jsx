import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";
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

const SCANNER_ROWS = [
  {
    family: "BTC price thresholds",
    type: "Strike ladder",
    typeCls: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
    severity: "2.4σ",
    severityCls: "text-emerald-600 dark:text-emerald-400",
    constraint: "P($100k) ≤ P($90k) ≤ P($80k)",
    status: "Actionable",
    statusCls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  {
    family: "Fed rate hold by month",
    type: "Expiry curve",
    typeCls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-300",
    severity: "1.8σ",
    severityCls: "text-amber-600 dark:text-amber-400",
    constraint: "P(by Jul) ≥ P(by Jun) ≥ P(by May)",
    status: "Watchlist",
    statusCls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  {
    family: "GOP primary winner",
    type: "Mutex set",
    typeCls: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-300",
    severity: "0.6σ",
    severityCls: "text-muted-foreground",
    constraint: "Σ outcomes ≈ 1.00 (current: 1.02)",
    status: "Normal",
    statusCls: "",
  },
  {
    family: "ETH price thresholds",
    type: "Strike ladder",
    typeCls: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
    severity: "0.3σ",
    severityCls: "text-muted-foreground",
    constraint: "P($5k) ≤ P($4k) ≤ P($3k)",
    status: "Normal",
    statusCls: "",
  },
];

const REPAIR_PCTS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const PNL_DATA = REPAIR_PCTS.map((r) => {
  const legA = 263 * (r / 100);
  const legB = 172 * (r / 100);
  return Math.round((legA + legB - 4.82) * 100) / 100;
});

function MetricCard({ label, value, valueCls }) {
  return (
    <div className="bg-muted/60 rounded-lg p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
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

export default function PolymarketRelativeValueTerminal() {
  const strikeChartRef = useRef(null);
  const pnlChartRef = useRef(null);

  useEffect(() => {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const grid = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
    const txt = isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";

    const strikeChart = new Chart(strikeChartRef.current, {
      type: "line",
      data: {
        labels: ["$80k", "$90k", "$100k", "$110k", "$120k"],
        datasets: [
          {
            label: "No-arb upper bound",
            data: [72, 55, 42, 28, 15],
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
            data: [68, 38, 42, 22, 11],
            borderColor: "#378ADD",
            backgroundColor: "#378ADD",
            borderWidth: 2,
            pointRadius: 6,
            pointBackgroundColor: (ctx) =>
              ctx.dataIndex === 1 || ctx.dataIndex === 2 ? "#E24B4A" : "#378ADD",
            pointBorderColor: (ctx) =>
              ctx.dataIndex === 1 || ctx.dataIndex === 2 ? "#E24B4A" : "#378ADD",
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
            callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}¢` },
          },
        },
        scales: {
          y: {
            title: { display: true, text: "Probability (¢)", color: txt, font: { size: 12 } },
            min: 0,
            max: 80,
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

    const pnlChart = new Chart(pnlChartRef.current, {
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
      strikeChart.destroy();
      pnlChart.destroy();
    };
  }, []);

  return (
    <div className="py-4 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-medium">Polymarket relative value terminal</h1>
          <p className="text-sm text-muted-foreground mt-0.5">No-arb surface for prediction markets</p>
        </div>
        <div className="flex gap-2">
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            Live
          </Badge>
          <Badge variant="secondary">Replay available</Badge>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-3 gap-3">
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">Families scanned</p>
            <p className="text-2xl font-medium mt-0.5">14</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">Dislocations found</p>
            <p className="text-2xl font-medium mt-0.5">3</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <p className="text-sm text-muted-foreground">Actionable (≥2σ)</p>
            <p className="text-2xl font-medium mt-0.5 text-emerald-600 dark:text-emerald-400">1</p>
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
                <TableHead className="text-right">Severity</TableHead>
                <TableHead>Constraint</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SCANNER_ROWS.map((row) => (
                <TableRow key={row.family} className="cursor-pointer">
                  <TableCell className="font-medium">{row.family}</TableCell>
                  <TableCell>
                    <Badge className={row.typeCls}>{row.type}</Badge>
                  </TableCell>
                  <TableCell className={`text-right font-medium ${row.severityCls}`}>
                    {row.severity}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.constraint}</TableCell>
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
      </section>

      {/* ── Screen 2 · Dislocation visualizer ── */}
      <section>
        <p className="text-sm font-medium mb-2">Screen 2 · Dislocation visualizer — BTC strike ladder</p>
        <Card>
          <CardHeader>
            <CardTitle>BTC price threshold family</CardTitle>
            <CardDescription>Constraint: probability must decrease as strike increases</CardDescription>
            <CardAction>
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                  Exact
                </Badge>
                <span className="text-xs text-muted-foreground">constraint confidence</span>
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

            <Alert className="bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-900">
              <AlertDescription className="text-red-800 dark:text-red-300">
                Violation detected: P(&gt;$100k) = 42¢ but P(&gt;$90k) = 38¢. The $100k market is
                priced 4pp above the $90k market — this violates monotonicity. Severity: 2.4σ from
                trailing 30-day norm.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-4 gap-2">
              <MetricCard label="Severity" value="2.4σ" valueCls="text-emerald-600 dark:text-emerald-400" />
              <MetricCard label="Episodes (30d)" value="8" />
              <MetricCard label="Closure rate" value="6/8 (75%)" />
              <MetricCard label="Median closure" value="1.8d" />
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
              Direction is structurally implied: P($100k) must fall or P($90k) must rise. Both legs
              correct the violation.
            </p>

            {/* Legs */}
            <div className="grid grid-cols-2 gap-3">
              <LegCard
                leg="Leg A · Buy YES"
                title="BTC above $90k"
                rows={[
                  ["Token", "YES @ $0.38"],
                  ["Shares", "263"],
                  ["Cost", "$99.94"],
                  ["Max gain", "+$163.06", "text-emerald-600 dark:text-emerald-400"],
                ]}
              />
              <LegCard
                leg="Leg B · Buy NO"
                title="BTC above $100k"
                rows={[
                  ["Token", "NO @ $0.58"],
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
                  title="BTC >$90k YES"
                  rows={[
                    ["Best ask", "$0.39"],
                    ["Spread", "1.8%"],
                    ["Depth at ask", "$48k"],
                    ["Est. fill (263 sh)", "$0.391"],
                    ["Slippage", "0.3%", "text-amber-600 dark:text-amber-400"],
                  ]}
                />
                <DepthCard
                  title="BTC >$100k NO"
                  rows={[
                    ["Best ask", "$0.59"],
                    ["Spread", "2.1%"],
                    ["Depth at ask", "$32k"],
                    ["Est. fill (172 sh)", "$0.594"],
                    ["Slippage", "0.7%", "text-amber-600 dark:text-amber-400"],
                  ]}
                />
              </div>
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
              <MetricCard label="Net cost" value="$199.70" />
              <MetricCard label="All-in friction" value="$4.82" valueCls="text-amber-600 dark:text-amber-400" />
              <MetricCard label="Break-even repair" value="1.2pp" />
              <MetricCard label="Edge after spread" value="2.8pp" valueCls="text-emerald-600 dark:text-emerald-400" />
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
              </div>
            </div>

            {/* Model risk */}
            <div>
              <p className="text-sm font-medium mb-2">Model risk</p>
              <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900">
                <AlertDescription className="text-amber-900 dark:text-amber-300">
                  Friction is a conservative proxy (current spreads, not historical). Structural
                  constraint is definitional for identically-worded strike markets. Sample: 8
                  episodes over 30 days.
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
