// src/lib/dashboard.config.ts
// ★ THIS IS THE FILE YOU EDIT TO CHANGE THE DASHBOARD. ★
//
// The dashboard is a list of widgets. Each widget declares its type, title,
// and which data it shows (by referencing a key from queries.ts). The renderer
// reads this list and draws everything — you never touch rendering code to add
// or rearrange widgets.
//
// Widget types:
//   "stat"  — a single big number. Needs `metric` (a key in metrics{}).
//   "chart" — a line or bar chart. Needs `query` + `chartType` + axis keys.
//   "table" — a data table. Needs `query` + `columns`.
//
// To add a widget: add an object here. If it needs new data, add a function
// in queries.ts first and reference its key. That's the whole workflow.

// `region` controls layout: "side" pins a widget to the right-hand sidebar;
// everything else fills the wide main area. Within the main area, `wide` makes
// a widget span the full main width (otherwise it takes half).

export type Widget =
  | {
      type: "stat";
      title: string;
      metric: string; // key in metrics{} from queries.ts
      format?: "currency" | "percent" | "number";
      region?: "main" | "side";
    }
  | {
      type: "chart";
      title: string;
      query: string; // key in queries{} from queries.ts
      chartType: "line" | "bar";
      xKey: string; // field name for the x-axis
      yKey: string; // field name for the y-axis
      wide?: boolean; // span the full main-area width
      region?: "main" | "side";
      // Line colour. Bars auto-colour green/red per value sign regardless.
      color?: "positive" | "negative";
    }
  | {
      type: "table";
      title: string;
      query: string; // key in queries{} from queries.ts
      wide?: boolean; // span the full main-area width (otherwise half)
      region?: "main" | "side";
      columns: {
        key: string;
        label: string;
        format?: "currency" | "percent" | "number";
      }[];
      // Optional headline figure shown above the table (e.g. a win ratio).
      headerStat?: {
        metric: string; // key in metrics{} from queries.ts
        label: string;
        format?: "currency" | "percent" | "number";
      };
    };

export const dashboardConfig: { title: string; widgets: Widget[] } = {
  title: "IG Trading Dashboard",
  widgets: [
    {
      type: "table",
      title: "Cumulative Summary",
      query: "cumulativeSummary",
      headerStat: { metric: "winRatio", label: "Win Ratio", format: "percent" },
      columns: [
        { key: "label", label: "" },
        { key: "count", label: "Trades", format: "number" },
        { key: "value", label: "£ Value", format: "currency" },
      ],
    },
    {
      type: "table",
      title: "Cash Flow",
      query: "cashFlowSummary",
      columns: [
        { key: "label", label: "" },
        { key: "value", label: "£ Value", format: "currency" },
      ],
    },
    {
      type: "chart",
      title: "Equity Curve",
      query: "pnlByDay",
      chartType: "line",
      xKey: "date",
      yKey: "cumulative",
      wide: true,
      color: "positive",
    },
    {
      type: "table",
      title: "Performance by Week",
      query: "weeklyPerformance",
      region: "side",
      columns: [
        { key: "week", label: "Week" },
        { key: "trades", label: "Trades", format: "number" },
        { key: "won", label: "Won", format: "number" },
        { key: "lost", label: "Lost", format: "number" },
        { key: "winPct", label: "Win %", format: "percent" },
        { key: "pnlWon", label: "£ Won", format: "currency" },
        { key: "pnlLost", label: "£ Lost", format: "currency" },
        { key: "pnl", label: "£ Profit/Loss", format: "currency" },
      ],
    },
    {
      type: "chart",
      title: "Weekly Profit / Loss",
      query: "weeklyPerformance",
      chartType: "bar",
      xKey: "week",
      yKey: "pnl",
      wide: true,
    },
    {
      type: "table",
      title: "Instruments",
      query: "instrumentRanking",
      region: "side",
      columns: [
        { key: "instrument", label: "Instrument" },
        { key: "pnl", label: "Profit/Loss", format: "currency" },
        { key: "rank", label: "Rank", format: "number" },
      ],
    },
  ],
};