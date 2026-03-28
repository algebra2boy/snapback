import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import "./polymarket_relative_value_terminal_ui.css";

const scannerRows = [
  {
    family: "BTC price thresholds",
    type: "Strike ladder",
    typeClass: "tag-strike",
    severity: "2.4σ",
    severityClass: "sev-good",
    constraint: "P($100k) ≤ P($90k) ≤ P($80k)",
    status: "Actionable",
    statusClass: "status-success",
  },
  {
    family: "Fed rate hold by month",
    type: "Expiry curve",
    typeClass: "tag-expiry",
    severity: "1.8σ",
    severityClass: "sev-warn",
    constraint: "P(by Jul) ≥ P(by Jun) ≥ P(by May)",
    status: "Watchlist",
    statusClass: "status-warning",
  },
  {
    family: "GOP primary winner",
    type: "Mutex set",
    typeClass: "tag-mutex",
    severity: "0.6σ",
    severityClass: "sev-muted",
    constraint: "Σ outcomes ≈ 1.00 (current: 1.02)",
    status: "Normal",
    statusClass: "status-normal",
  },
  {
    family: "ETH price thresholds",
    type: "Strike ladder",
    typeClass: "tag-strike",
    severity: "0.3σ",
    severityClass: "sev-muted",
    constraint: "P($5k) ≤ P($4k) ≤ P($3k)",
    status: "Normal",
    statusClass: "status-normal",
  },
];

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
            pointBackgroundColor: (ctx) => {
              if (ctx.dataIndex === 2 || ctx.dataIndex === 1) return "#E24B4A";
              return "#378ADD";
            },
            pointBorderColor: (ctx) => {
              if (ctx.dataIndex === 2 || ctx.dataIndex === 1) return "#E24B4A";
              return "#378ADD";
            },
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
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}¢`,
            },
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

    const repairPcts = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
    const pnlData = repairPcts.map((r) => {
      const legA = 263 * (r / 100);
      const legB = 172 * (r / 100);
      return Math.round((legA + legB - 4.82) * 100) / 100;
    });

    const pnlChart = new Chart(pnlChartRef.current, {
      type: "line",
      data: {
        labels: repairPcts.map((r) => `${r}pp`),
        datasets: [
          {
            label: "Net P&L after fees",
            data: pnlData,
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
            data: repairPcts.map(() => 0),
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
    <div className="pmrt-root">
      <div className="pmrt-header">
        <div>
          <div className="pmrt-title">Polymarket relative value terminal</div>
          <div className="pmrt-subtitle">No-arb surface for prediction markets</div>
        </div>
        <div className="pmrt-header-tags">
          <span className="status-pill status-success">Live</span>
          <span className="status-pill status-secondary">Replay available</span>
        </div>
      </div>

      <div className="pmrt-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Families scanned</div>
          <div className="kpi-value">14</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Dislocations found</div>
          <div className="kpi-value">3</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Actionable (≥2σ)</div>
          <div className="kpi-value kpi-green">1</div>
        </div>
      </div>

      <div className="section-title">Screen 1 · Dislocation scanner</div>
      <div className="table-wrap">
        <table className="scan-table">
          <thead>
            <tr>
              <th>Family</th>
              <th>Type</th>
              <th className="right">Severity</th>
              <th>Constraint</th>
              <th className="right">Status</th>
            </tr>
          </thead>
          <tbody>
            {scannerRows.map((row) => (
              <tr key={row.family}>
                <td className="family-cell">{row.family}</td>
                <td>
                  <span className={`type-tag ${row.typeClass}`}>{row.type}</span>
                </td>
                <td className={`right severity-cell ${row.severityClass}`}>{row.severity}</td>
                <td className="muted">{row.constraint}</td>
                <td className="right">
                  <span className={`status-pill ${row.statusClass}`}>{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Screen 2 · Dislocation visualizer — BTC strike ladder</div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">BTC price threshold family</div>
            <div className="pmrt-subtitle">Constraint: probability must decrease as strike increases</div>
          </div>
          <div className="confidence-wrap">
            <span className="tag-exact">Exact</span>
            <span className="small-muted">constraint confidence</span>
          </div>
        </div>

        <div className="chart-box chart-tall">
          <canvas ref={strikeChartRef} />
        </div>

        <div className="legend-row">
          <span className="legend-item"><span className="legend-swatch swatch-envelope" />No-arb envelope</span>
          <span className="legend-item"><span className="legend-swatch swatch-market" />Market prices</span>
          <span className="legend-item"><span className="legend-swatch swatch-violation" />Violation</span>
        </div>

        <div className="alert alert-danger">
          Violation detected: P(&gt;$100k) = 42¢ but P(&gt;$90k) = 38¢. The $100k market is priced 4pp above the $90k market — this violates monotonicity. Severity: 2.4σ from trailing 30-day norm.
        </div>

        <div className="mini-kpi-grid">
          <div className="mini-kpi-card">
            <div className="mini-kpi-label">Severity</div>
            <div className="mini-kpi-value kpi-green">2.4σ</div>
          </div>
          <div className="mini-kpi-card">
            <div className="mini-kpi-label">Episodes (30d)</div>
            <div className="mini-kpi-value">8</div>
          </div>
          <div className="mini-kpi-card">
            <div className="mini-kpi-label">Closure rate</div>
            <div className="mini-kpi-value">6/8 (75%)</div>
          </div>
          <div className="mini-kpi-card">
            <div className="mini-kpi-label">Median closure</div>
            <div className="mini-kpi-value">1.8d</div>
          </div>
        </div>
      </div>

      <div className="section-title">Screen 3 · Spread builder</div>
      <div className="panel">
        <div className="panel-head center-y">
          <div className="panel-title">Corrective spread</div>
          <span className="status-pill status-success">Auto-generated</span>
        </div>

        <div className="copy-block">
          Direction is structurally implied: P($100k) must fall or P($90k) must rise. Both legs correct the violation.
        </div>

        <div className="legs-grid">
          <div className="card-outline">
            <div className="small-muted">Leg A · Buy YES</div>
            <div className="leg-title">BTC above $90k</div>
            <div className="kv-grid">
              <div className="muted">Token</div><div className="right">YES @ $0.38</div>
              <div className="muted">Shares</div><div className="right">263</div>
              <div className="muted">Cost</div><div className="right">$99.94</div>
              <div className="muted">Max gain</div><div className="right kpi-green">+$163.06</div>
            </div>
          </div>
          <div className="card-outline">
            <div className="small-muted">Leg B · Buy NO</div>
            <div className="leg-title">BTC above $100k</div>
            <div className="kv-grid">
              <div className="muted">Token</div><div className="right">NO @ $0.58</div>
              <div className="muted">Shares</div><div className="right">172</div>
              <div className="muted">Cost</div><div className="right">$99.76</div>
              <div className="muted">Max gain</div><div className="right kpi-green">+$72.24</div>
            </div>
          </div>
        </div>

        <div className="subsection-title">Market depth</div>
        <div className="depth-grid">
          <div className="soft-card">
            <div className="soft-card-title">BTC &gt;$90k YES</div>
            <div className="kv-grid compact">
              <div className="muted">Best ask</div><div className="right">$0.39</div>
              <div className="muted">Spread</div><div className="right">1.8%</div>
              <div className="muted">Depth at ask</div><div className="right">$48k</div>
              <div className="muted">Est. fill (263 sh)</div><div className="right">$0.391</div>
              <div className="muted">Slippage</div><div className="right sev-warn">0.3%</div>
            </div>
          </div>
          <div className="soft-card">
            <div className="soft-card-title">BTC &gt;$100k NO</div>
            <div className="kv-grid compact">
              <div className="muted">Best ask</div><div className="right">$0.59</div>
              <div className="muted">Spread</div><div className="right">2.1%</div>
              <div className="muted">Depth at ask</div><div className="right">$32k</div>
              <div className="muted">Est. fill (172 sh)</div><div className="right">$0.594</div>
              <div className="muted">Slippage</div><div className="right sev-warn">0.7%</div>
            </div>
          </div>
        </div>

        <div className="subsection-title">P&L vs. partial repair</div>
        <div className="chart-box chart-mid">
          <canvas ref={pnlChartRef} />
        </div>

        <div className="legend-row">
          <span className="legend-item"><span className="legend-swatch swatch-pnl" />Net P&L after fees</span>
          <span className="legend-item"><span className="legend-line" />Break-even line</span>
        </div>

        <div className="mini-kpi-grid">
          <div className="mini-kpi-card">
            <div className="mini-kpi-label">Net cost</div>
            <div className="mini-kpi-value">$199.70</div>
          </div>
          <div className="mini-kpi-card">
            <div className="mini-kpi-label">All-in friction</div>
            <div className="mini-kpi-value sev-warn">$4.82</div>
          </div>
          <div className="mini-kpi-card">
            <div className="mini-kpi-label">Break-even repair</div>
            <div className="mini-kpi-value">1.2pp</div>
          </div>
          <div className="mini-kpi-card">
            <div className="mini-kpi-label">Edge after spread</div>
            <div className="mini-kpi-value kpi-green">2.8pp</div>
          </div>
        </div>

        <div className="subsection-title">Evidence (PIT, leave-one-out)</div>
        <div className="soft-card evidence-card">
          <div className="evidence-grid">
            <div><div className="muted">Episodes</div><div className="strong">8 (high confidence)</div></div>
            <div><div className="muted">LOO wins</div><div className="strong">6/8 (75%)</div></div>
            <div><div className="muted">Median P&L</div><div className="strong kpi-green">+$8.40 / $100</div></div>
            <div><div className="muted">25th pctl</div><div className="strong sev-warn">-$4.20 / $100</div></div>
            <div><div className="muted">Worst loss</div><div className="strong sev-bad">-$18.50 / $100</div></div>
            <div><div className="muted">Friction scenario</div><div className="strong">Base (1.0×)</div></div>
          </div>
        </div>

        <div className="subsection-title">Model risk</div>
        <div className="alert alert-warning">
          Friction is a conservative proxy (current spreads, not historical). Structural constraint is definitional for identically-worded strike markets. Sample: 8 episodes over 30 days.
        </div>

        <div className="button-grid">
          <button type="button" className="btn btn-primary">Build spread order</button>
          <button type="button" className="btn btn-secondary">View replay (best + worst)</button>
        </div>
      </div>
    </div>
  );
}
