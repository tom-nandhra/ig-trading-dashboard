// src/components/DashboardClient.tsx
// Client component: receives already-computed data from the server page and
// renders the widgets. Charts run here because Recharts needs the browser.
// This file is the "renderer" — you rarely touch it. It knows how to draw each
// widget type; what to draw comes from dashboard.config.ts + queries.ts.

"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Widget } from "../lib/dashboard.config";

type Theme = "dark" | "light";

type ChartColors = {
  accent: string;
  neg: string;
  grid: string;
  textDim: string;
  tooltipBg: string;
  tooltipBorder: string;
  hover: string;
  text: string;
};

// Dark defaults — used for SSR and the first client render so hydration matches.
const DARK_COLORS: ChartColors = {
  accent: "#54d18c",
  neg: "#f06a6a",
  grid: "#1f2937",
  textDim: "#8b93a3",
  tooltipBg: "#0f131c",
  tooltipBorder: "rgba(255,255,255,0.07)",
  hover: "#131826",
  text: "#e6e9ef",
};

function gbp(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatValue(value: number, format?: string): string {
  if (format === "currency") return gbp(value);
  if (format === "percent") return `${value.toFixed(1)}%`;
  return value.toLocaleString("en-GB");
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

type RenderData = {
  metrics: Record<string, number>;
  queries: Record<string, Record<string, unknown>[]>;
};

export default function DashboardClient({
  title,
  widgets,
  data,
}: {
  title: string;
  widgets: Widget[];
  data: RenderData;
}) {
  const stats = widgets.filter((w) => w.type === "stat");
  const body = widgets.filter((w) => w.type !== "stat");
  const sideWidgets = body.filter((w) => w.region === "side");
  const mainWidgets = body.filter((w) => w.region !== "side");

  const [theme, setTheme] = useState<Theme>("dark");
  const [colors, setColors] = useState<ChartColors>(DARK_COLORS);

  // On mount, adopt whatever theme the no-flash script set on <html>.
  useEffect(() => {
    const initial = (document.documentElement.getAttribute("data-theme") ||
      "dark") as Theme;
    setTheme(initial);
  }, []);

  // Apply the theme to <html>, persist it, and read the resolved CSS variables
  // so the charts (which need real colour strings) match the active theme.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {}
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) =>
      cs.getPropertyValue(name).trim() || fallback;
    setColors({
      accent: v("--accent", DARK_COLORS.accent),
      neg: v("--neg", DARK_COLORS.neg),
      grid: v("--grid", DARK_COLORS.grid),
      textDim: v("--text-dim", DARK_COLORS.textDim),
      tooltipBg: v("--panel", DARK_COLORS.tooltipBg),
      tooltipBorder: v("--edge", DARK_COLORS.tooltipBorder),
      hover: v("--panel-2", DARK_COLORS.hover),
      text: v("--text", DARK_COLORS.text),
    });
  }, [theme]);

  const { accent, neg, grid, textDim, tooltipBg, tooltipBorder, hover, text } =
    colors;

  return (
    <div className="dash">
      <header className="dash-header">
        <span className="dash-eyebrow">LIVE ACCOUNT</span>
        <div className="dash-header-row">
          <h1 className="dash-title">{title}</h1>
          <div className="dash-actions">
            <button
              type="button"
              className={`theme-toggle${theme === "light" ? " is-light" : ""}`}
              onClick={() =>
                setTheme((t) => (t === "dark" ? "light" : "dark"))
              }
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              <span className="theme-toggle-knob">
                {theme === "dark" ? <MoonIcon /> : <SunIcon />}
              </span>
            </button>
            <a
              className="studio-link"
              href="http://localhost:5555"
              target="_blank"
              rel="noopener noreferrer"
              title="Run `npm run studio` in a terminal first, then click to open."
            >
              Open Prisma Studio →
            </a>
          </div>
        </div>
      </header>

      {stats.length > 0 && (
      <section className="stat-row">
        {stats.map((w) => {
          if (w.type !== "stat") return null;
          const value = data.metrics[w.metric] ?? 0;
          const negative = w.format === "currency" && value < 0;
          return (
            <div className="stat-card" key={w.title}>
              <span className="stat-label">{w.title}</span>
              <span
                className="stat-value"
                style={{
                  color: negative ? neg : text,
                }}
              >
                {formatValue(value, w.format)}
              </span>
            </div>
          );
        })}
      </section>
      )}

      <section className="dash-body">
        <div className="main-col">{mainWidgets.map(renderWidget)}</div>
        {sideWidgets.length > 0 && (
          <aside className="side-col">{sideWidgets.map(renderWidget)}</aside>
        )}
      </section>
    </div>
  );

  function renderWidget(w: Widget) {
    if (w.type === "chart") {
            const rows = data.queries[w.query] ?? [];
            const lineColor = w.color === "negative" ? neg : accent;
            const chartHeight = w.wide ? 340 : 260;
            return (
              <div
                className={`widget${w.wide ? " widget-wide" : ""}`}
                key={w.title}
              >
                <h2 className="widget-title">{w.title}</h2>
                <ResponsiveContainer width="100%" height={chartHeight}>
                  {w.chartType === "line" ? (
                    <LineChart data={rows}>
                      <CartesianGrid stroke={grid} vertical={false} />
                      <XAxis
                        dataKey={w.xKey}
                        stroke={textDim}
                        fontSize={11}
                        tickLine={false}
                      />
                      <YAxis
                        stroke={textDim}
                        fontSize={11}
                        tickLine={false}
                        width={70}
                        tickFormatter={(v) => gbp(Number(v))}
                      />
                      <Tooltip
                        contentStyle={{
                          background: tooltipBg,
                          border: `1px solid ${tooltipBorder}`,
                          fontSize: 12,
                        }}
                        formatter={(v) => gbp(Number(v))}
                      />
                      <Line
                        type="monotone"
                        dataKey={w.yKey}
                        stroke={lineColor}
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  ) : (
                    <BarChart data={rows}>
                      <CartesianGrid stroke={grid} vertical={false} />
                      <XAxis
                        dataKey={w.xKey}
                        stroke={textDim}
                        fontSize={10}
                        tickLine={false}
                        angle={-30}
                        textAnchor="end"
                        height={70}
                      />
                      <YAxis
                        stroke={textDim}
                        fontSize={11}
                        tickLine={false}
                        width={70}
                        tickFormatter={(v) => gbp(Number(v))}
                      />
                      <Tooltip
                        contentStyle={{
                          background: tooltipBg,
                          border: `1px solid ${tooltipBorder}`,
                          fontSize: 12,
                        }}
                        formatter={(v) => gbp(Number(v))}
                        cursor={{ fill: hover }}
                      />
                      <Bar dataKey={w.yKey}>
                        {rows.map((row, i) => (
                          <Cell
                            key={i}
                            fill={Number(row[w.yKey]) < 0 ? neg : accent}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            );
          }

          if (w.type === "table") {
            const rows = data.queries[w.query] ?? [];
            const headerValue = w.headerStat
              ? data.metrics[w.headerStat.metric] ?? 0
              : undefined;
            return (
              <div
                className={`widget${w.wide ? " widget-wide" : ""}`}
                key={w.title}
              >
                <h2 className="widget-title">{w.title}</h2>
                {w.headerStat && (
                  <div className="widget-headerstat">
                    <span className="widget-headerstat-label">
                      {w.headerStat.label}
                    </span>
                    <span className="widget-headerstat-value">
                      {formatValue(headerValue ?? 0, w.headerStat.format)}
                    </span>
                  </div>
                )}
                <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {w.columns.map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        {w.columns.map((c) => {
                          const raw = row[c.key];
                          const blank = raw === null || raw === undefined || raw === "";
                          const numeric =
                            c.format === "currency" ||
                            c.format === "percent" ||
                            c.format === "number";

                          let display = "";
                          if (!blank) {
                            if (c.format === "currency") display = gbp(Number(raw));
                            else if (c.format) display = formatValue(Number(raw), c.format);
                            else display = String(raw);
                          }

                          // A row can force its colour via __tone; otherwise
                          // currency cells colour by sign.
                          const tone = row.__tone;
                          const currencyColor =
                            tone === "negative"
                              ? neg
                              : tone === "positive"
                                ? accent
                                : Number(raw) < 0
                                  ? neg
                                  : accent;
                          const style = numeric
                            ? {
                                textAlign: "right" as const,
                                fontVariantNumeric: "tabular-nums" as const,
                                ...(c.format === "currency" && !blank
                                  ? { color: currencyColor }
                                  : {}),
                              }
                            : undefined;

                          return (
                            <td key={c.key} style={style}>
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            );
          }

    return null;
  }
}