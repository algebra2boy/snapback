import { useEffect, useRef, useState } from "react";
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
  runBacktest,
} from "@/lib/PITStats";

// ── P&L chart data (static until CLOB is wired in) ───────────────────────────
const REPAIR_PCTS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const PNL_DATA = REPAIR_PCTS.map((r) => {
  const legA = 263 * (r / 100);
  const legB = 172 * (r / 100);
  return Math.round((legA + legB - 4.82) * 100) / 100;
});

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
    def: "When prices inside a family violate their constraint — e.g. P(BTC > $100k) > P(BTC > $90k), which is impossible since $100k is harder to reach. The size in % pts is how far outside the constraint the prices sit.",
  },
  {
    term: "% pts (pp)",
    def: "Percentage points — the raw gap between two prices. A 4 % pt dislocation means the prices are 4 cents apart on a 0–100¢ scale when they should not be.",
  },
  {
    term: "Actionable",
    def: "Dislocation is ≥ 4 % pts — large enough to likely cover transaction costs and leave positive expected value after the spread closes.",
  },
  {
    term: "Watchlist",
    def: "Dislocation is 2-4 % pts — notable but may not clear friction costs. Worth monitoring for it to grow before trading.",
  },
  {
    term: "Normal",
    def: "Dislocation is < 2 % pts — within typical noise. No trade recommended.",
  },
  {
    term: "Strike ladder",
    def: "Markets with different numeric thresholds on the same underlying (e.g. BTC > $80k, > $90k, > $100k). Higher strikes must be cheaper — if they are not, there is an arb.",
  },
  {
    term: "Expiry curve",
    def: "Markets with the same outcome but different deadlines (e.g. Fed holds by May / June / July). A nearer deadline resolving YES implies the further one also resolves YES, so the near price must be ≤ the far price.",
  },
  {
    term: "No-arb envelope",
    def: "The theoretical maximum price each market can have without creating a risk-free arbitrage against its neighbours. Points above this line are the violation.",
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

  const [lowerLeg, upperLeg] = violatingPair;
  const upperPrice = (upperLeg.yesPrice * 100).toFixed(1);
  const lowerPrice = (lowerLeg.yesPrice * 100).toFixed(1);
  const gap = (rawDislocation * 100).toFixed(1);
  const upperLabel = simplifyMarketLabel(getQuestion(upperLeg));
  const lowerLabel = simplifyMarketLabel(getQuestion(lowerLeg));

  return {
    eyebrow: `${gap}pp ordering break`,
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
  const [clobLoading, setClobLoading] = useState(false);
  const [clobHistory, setClobHistory] = useState(null); // { seriesA, seriesB, labelA, labelB }
  const [bookData, setBookData] = useState(null); // { legA: book, legB: book }
  const [bookLoading, setBookLoading] = useState(false);
  const [analyticsData, setAnalyticsData] = useState(null); // { sigma, backtest }
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

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

  // ── Update strike chart on heroFamily change ──
  useEffect(() => {
    if (!strikeChart.current || !heroFamily?.markets.length) return;
    const prices = heroFamily.markets.map((m) => m.yesPrice * 100);
    const envelope = computeNoArbEnvelope(prices);
    const colors = prices.map((p, i) =>
      p > envelope[i] ? "#FF5000" : "#378ADD",
    );
    const rawLabels = heroFamily.markets.map((market, index) => {
      const explicitLabel = heroFamily.labels?.[index];
      return getQuestion(market) || explicitLabel || `Market ${index + 1}`;
    });
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
  }, [heroFamily]);

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
  const strikeAxisLabels =
    heroFamily?.markets?.map((market, index) => {
      const fullLabel =
        getQuestion(market) ||
        heroFamily.labels?.[index] ||
        `Market ${index + 1}`;
      const shortLabel = heroFamily.labels?.[index] || fullLabel;
      return {
        full: fullLabel,
        short: truncateAxisLabel(shortLabel),
      };
    }) ?? [];

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

  // ── σ display label ──
  const sigma = analyticsData?.sigma ?? null;
  const sigmaLabel = sigma != null ? `${sigma.toFixed(2)}σ` : null;
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
      {/* ── Top nav bar ── */}
      <header className="sticky top-0 z-20 border-b border-border/80 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white shadow-sm">
              S
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold tracking-tight">
                  Snapback
                </span>
                <span className="text-sm text-muted-foreground">
                  No-arb Terminal
                </span>
              </div>
              <p className="hidden text-xs text-muted-foreground md:block">
                Scan structurally linked markets, inspect the violated surface,
                then price the corrective spread.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-5 text-sm md:flex">
              <span>
                <span className="text-muted-foreground">Families </span>
                <span className="font-medium">
                  {loading ? "—" : scannerRows.length}
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">Dislocations </span>
                <span className="font-medium">
                  {loading ? "—" : dislocatedCount}
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">Actionable </span>
                <span
                  className={`font-semibold ${actionableCount > 0 ? "text-emerald-600" : ""}`}
                >
                  {loading ? "—" : actionableCount}
                </span>
              </span>
            </div>
            <FreshnessBadge dataAge={dataAge} isSeed={isSeed} />
            {loading && (
              <span className="text-xs text-muted-foreground animate-pulse">
                Fetching…
              </span>
            )}
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
              Groups of linked markets ranked by how far their prices deviate
              from logical constraints.
            </p>
          </div>
          <div className="border-y border-border/80 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Filter scanner
              </p>
              <span className="text-[11px] text-muted-foreground">
                {filteredRows.length} shown
              </span>
            </div>
            <div className="mt-3">
              <label className="scanner-search">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
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
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
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
            <div className="mt-2 flex flex-wrap gap-1.5">
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
            {filtersActive ? (
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted-foreground">
                  Filters are narrowing the ranked scanner view.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setTypeFilter("all");
                  }}
                  className="text-[11px] font-medium text-slate-700 transition hover:text-slate-950"
                >
                  Clear filters
                </button>
              </div>
            ) : null}
          </div>
          <div className="max-h-[26rem] space-y-2 overflow-y-auto p-3 lg:max-h-[calc(100vh-372px)]">
            {filteredRows.length ? (
              filteredRows.map((row) => (
                <button
                  key={row.family}
                  onClick={() => !row.isSeed && setHeroFamily(row)}
                  className={`scanner-item w-full text-left px-4 py-3.5 ${
                    heroFamily?.family === row.family
                      ? "scanner-item-active"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium leading-snug text-slate-900">
                      {row.family}
                    </span>
                    <span
                      className={`text-xs font-bold shrink-0 tabular-nums ${row.severityCls}`}
                      title="Price deviation in percentage points"
                    >
                      {row.severity.replace("pp", " % pts")}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
                          ? "Gap ≥ 4 % pts — likely profitable after costs"
                          : row.status === "Watchlist"
                            ? "Gap 2–4 % pts — notable but may not clear transaction costs yet"
                            : "Gap < 2 % pts — within normal noise, no trade"
                      }
                    >
                      {row.status}
                    </span>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/65 px-4 py-5 text-sm text-muted-foreground">
                <p>No scanner families match these filters.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setTypeFilter("all");
                  }}
                  className="mt-2 font-medium text-slate-700 transition hover:text-slate-950"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
          {/* ── Glossary ── */}
          <div className="border-t border-border/80 px-5 py-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Glossary
            </p>
            <dl className="space-y-2">
              {GLOSSARY.map(({ term, def }) => (
                <div key={term}>
                  <dt className="text-[11px] font-semibold text-slate-700">
                    {term}
                  </dt>
                  <dd className="text-[11px] leading-relaxed text-muted-foreground">
                    {def}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="min-w-0 flex-1 space-y-4">
          {/* ── Family header + chart ── */}
          <section className="px-8 pt-7 pb-6 border-b border-border">
            {/* Title row */}
            <div className="soft-grid border-b border-border/80 px-6 pb-6 pt-7 sm:px-8">
              <div className="mb-6 flex flex-col items-start justify-between gap-6 lg:flex-row">
                <div className="max-w-2xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Selected market group
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-[-0.04em] text-slate-950">
                    {heroFamily?.family ?? "—"}
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    {heroFamily?.dislocation?.constraintDesc ??
                      "Select a family from the scanner"}
                  </p>
                  {violationAlert && (
                    <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/90 px-4 py-3 text-red-700">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 shrink-0 text-base leading-none">
                          ⚠
                        </span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-500">
                            {violationAlert.eyebrow}
                          </p>
                          <p className="mt-1 text-sm font-medium leading-6 text-red-700">
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
                <div className="min-w-[140px] rounded-3xl border border-slate-200/80 bg-white/85 px-5 py-4 text-left shadow-sm lg:text-right">
                  <div className="flex items-center justify-between gap-2 lg:justify-end">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {sigmaLabel ? "Sigma score" : "Price deviation"}
                    </p>
                    {sigmaLabel && (
                      <Tooltip text="Sigma score shows how many standard deviations the current gap sits above its 30-day trailing average. A reading of 2σ or higher is Actionable, 1.5σ to 2σ is Watchlist, and below 1.5σ is Normal." />
                    )}
                  </div>
                  <p
                    className={`mt-2 text-4xl font-bold tracking-[-0.06em] tabular-nums ${sigmaLabel ? sigmaCls : (heroFamily?.severityCls ?? "")}`}
                  >
                    {sigmaLabel ??
                      (heroFamily
                        ? heroFamily.severity.replace("pp", "")
                        : "—")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sigmaLabel ? "standard deviations" : "percentage points"}
                  </p>
                  {!sigmaLabel && heroFamily && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {analyticsLoading
                        ? "Computing σ…"
                        : "raw gap · σ pending"}
                    </p>
                  )}
                  <p className="mt-1 text-sm font-medium">
                    {sigmaStatus ?? heroFamily?.status ?? "—"}
                  </p>
                </div>
              </div>

              {/* Chart */}
              <div className="relative h-72">
                <canvas ref={strikeChartRef} />
              </div>
              {strikeAxisLabels.length > 0 && (
                <div
                  className="mt-3 grid items-start gap-2"
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

          {/* ── CLOB price history (48h) ── */}
          <section className="px-8 py-6 border-b border-border">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">Price history · 48h</p>
              {clobLoading && (
                <span className="text-xs text-muted-foreground animate-pulse">
                  Loading CLOB history…
                </span>
              )}
              {!clobLoading && clobHistory && (
                <span className="text-xs text-muted-foreground">
                  via CLOB /prices-history
                </span>
              )}
              {!clobLoading &&
                !clobHistory &&
                !heroFamily?.isSeed &&
                heroFamily && (
                  <span className="text-xs text-red-400">
                    CLOB history unavailable
                  </span>
                )}
            </div>
            <div className="relative h-52">
              {/* Canvas is always mounted so Chart.js can bind; content driven by clobHistory */}
              <canvas
                ref={historyChartRef}
                className={clobHistory ? "" : "opacity-0"}
              />
              {!clobHistory && !clobLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  {heroFamily && !heroFamily.isSeed
                    ? "No CLOB history data"
                    : "Select a live family to view history"}
                </div>
              )}
            </div>
          </section>

          {/* ── Stats bar ── */}
          <div className="glass-panel grid grid-cols-2 md:grid-cols-4">
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
                  ? `${(heroFamily.rawDislocation * 100).toFixed(1)} % pts`
                  : "—"
              }
              valueCls={heroFamily?.severityCls}
              tooltip="How far the most-violated pair sits outside the no-arbitrage constraint, in percentage points (cents on a 0–100¢ scale)."
              border
            />
            <StatCell
              label={sigmaLabel ? "σ score" : "Signal strength"}
              value={
                sigmaLabel
                  ? `${sigmaLabel} · ${sigmaStatus}`
                  : (heroFamily?.status ?? "—")
              }
              valueCls={sigmaLabel ? sigmaCls : undefined}
              tooltip="σ = how many standard deviations the gap sits above its 30-day trailing average. ≥ 2σ = Actionable, 1.5–2σ = Watchlist, < 1.5σ = Normal. Raw % pts shown until 30d history loads."
              border={false}
            />
          </div>

          {/* ── Spread builder ── */}
          <section className="glass-panel overflow-hidden">
            <div className="border-b border-border/80 px-6 py-5 sm:px-8">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Spread builder
                  </p>
                  <h3 className="mt-2 text-base font-semibold text-slate-950">
                    Corrective spread
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Direction is structurally implied. The UI stays explicit
                    about what is live versus what is still proxy data.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {bookLoading && (
                    <span className="text-xs text-muted-foreground animate-pulse">
                      Loading book…
                    </span>
                  )}
                  {bookData && !bookLoading && (
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                      Live book
                    </span>
                  )}
                  <Badge className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                    Auto-generated
                  </Badge>
                </div>
              </div>
            </div>

            <div className="space-y-8 px-6 py-7 sm:px-8">
              {/* ── Two legs ── */}
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Leg A */}
                <div className="rounded-[28px] border border-slate-200/80 bg-white/84 p-5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {heroFamily?.type === "Mutex set"
                      ? "Leg A · Buy NO"
                      : "Leg A · Buy YES"}
                  </p>
                  <p className="mb-4 mt-3 text-base font-medium leading-snug text-slate-950">
                    {heroFamily?.dislocation?.violatingPair
                      ? getQuestion(
                          heroFamily.dislocation.violatingPair[0],
                        ).slice(0, 50)
                      : "BTC above $90k"}
                  </p>
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
                        <span className="text-muted-foreground">{label}</span>
                        <span
                          className={`font-medium ${label === "Max gain" ? "text-emerald-600" : "text-slate-900"}`}
                        >
                          {val}
                        </span>
                      </div>
                    ))}
                  </div>
                  {bookData && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {heroFamily?.type === "Mutex set"
                          ? "Depth (NO · implied)"
                          : "Depth (YES)"}
                      </p>
                      <div className="grid grid-cols-2 gap-x-3 text-[11px]">
                        <div>
                          <p className="mb-1 text-muted-foreground">Bids</p>
                          {bookData.legA.bids.slice(0, 3).map((b, i) => (
                            <div
                              key={i}
                              className="flex justify-between tabular-nums"
                            >
                              <span className="text-emerald-600">
                                {b.price.toFixed(3)}
                              </span>
                              <span className="text-muted-foreground">
                                {b.size.toFixed(0)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="mb-1 text-muted-foreground">Asks</p>
                          {bookData.legA.asks.slice(0, 3).map((a, i) => (
                            <div
                              key={i}
                              className="flex justify-between tabular-nums"
                            >
                              <span className="text-red-500">
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
                <div className="rounded-[28px] border border-slate-200/80 bg-white/84 p-5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Leg B · Buy NO
                  </p>
                  <p className="mb-4 mt-3 text-base font-medium leading-snug text-slate-950">
                    {heroFamily?.dislocation?.violatingPair
                      ? getQuestion(
                          heroFamily.dislocation.violatingPair[1],
                        ).slice(0, 50)
                      : "BTC above $100k"}
                  </p>
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
                        <span className="text-muted-foreground">{label}</span>
                        <span
                          className={`font-medium ${label === "Max gain" ? "text-emerald-600" : "text-slate-900"}`}
                        >
                          {val}
                        </span>
                      </div>
                    ))}
                  </div>
                  {bookData && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Depth (YES · implied NO)
                      </p>
                      <div className="grid grid-cols-2 gap-x-3 text-[11px]">
                        <div>
                          <p className="mb-1 text-muted-foreground">
                            NO bids (1−ask)
                          </p>
                          {bookData.legB.asks.slice(0, 3).map((a, i) => (
                            <div
                              key={i}
                              className="flex justify-between tabular-nums"
                            >
                              <span className="text-emerald-600">
                                {(1 - a.price).toFixed(3)}
                              </span>
                              <span className="text-muted-foreground">
                                {a.size.toFixed(0)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="mb-1 text-muted-foreground">
                            NO asks (1−bid)
                          </p>
                          {bookData.legB.bids.slice(0, 3).map((b, i) => (
                            <div
                              key={i}
                              className="flex justify-between tabular-nums"
                            >
                              <span className="text-red-500">
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
                    <p className="text-sm font-semibold text-slate-950">
                      P&amp;L vs. repair amount
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {spreadCalc
                        ? "Live — sized from CLOB top-of-book."
                        : "Illustrative until CLOB book loads."}
                    </p>
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
                <p className="mb-3 text-sm font-semibold text-slate-950">
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
                        ? `${spreadCalc.breakevenRepairPp.toFixed(1)}pp`
                        : "—",
                      tooltip:
                        "The minimum amount the dislocation must close (in percentage points) for you to cover friction costs and not lose money.",
                    },
                    {
                      label: "Edge after spread",
                      value: spreadCalc
                        ? `${spreadCalc.edgePp.toFixed(1)}pp`
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
                      className="rounded-[24px] border border-slate-200/80 bg-white/84 px-5 py-4 shadow-sm"
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          {label}
                        </p>
                        <Tooltip text={tooltip} />
                      </div>
                      <p
                        className={`text-lg font-semibold tabular-nums tracking-[-0.03em] ${valueCls ?? "text-slate-950"}`}
                      >
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Evidence ── */}
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      Evidence · PIT leave-one-out
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {analyticsData?.backtest
                        ? "Computed from 30-day daily CLOB history with point-in-time σ triggers."
                        : analyticsLoading
                          ? "Loading 30-day history…"
                          : "Select a live family to compute backtest."}
                    </p>
                  </div>
                  {analyticsLoading && (
                    <span className="text-xs text-muted-foreground animate-pulse">
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
                      ? "High (≥ 10 episodes)"
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
                          className="rounded-[24px] border border-slate-200/80 bg-white/84 px-5 py-4 shadow-sm"
                        >
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            {label}
                          </p>
                          <p
                            className={`font-medium ${cls || "text-slate-900"}`}
                          >
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {analyticsData?.backtest && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Trigger: σ ≥ 2 (point-in-time). Close: σ ≤ 0.5 or 7-day
                    timeout. Friction: 2% per round-trip.
                  </p>
                )}
              </div>

              {/* ── Model risk ── */}
              <Alert className="border-amber-200 bg-amber-50">
                <AlertDescription className="text-sm leading-6 text-amber-800">
                  {analyticsData
                    ? "σ score and backtest computed from live 30-day CLOB history. Small episode counts mean wide confidence intervals — treat evidence bands as directional, not precise."
                    : spreadCalc
                      ? "Sizing and friction computed from live CLOB top-of-book. σ and backtest load alongside 30-day history."
                      : "Friction is a conservative proxy. Book depth and σ load when a live family is selected."}
                </AlertDescription>
              </Alert>

              {/* ── Actions ── */}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  size="lg"
                  className="bg-slate-950 px-8 font-semibold text-white hover:bg-slate-800"
                >
                  Build spread order
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-slate-200 bg-white px-8 text-slate-900 hover:bg-slate-50"
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
