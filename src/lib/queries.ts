// src/lib/queries.ts
// The data layer. Each function computes one piece of dashboard data from the
// trades table. Widgets in dashboard.config.ts reference these by the keys in
// the `metrics` and `queries` maps at the bottom.
//
// To add a new widget's data: write a function here, register it in the right
// map below, then reference its key from dashboard.config.ts. Nothing else
// needs to change.

import { prisma } from "./prisma";

// --- Stat metrics: each returns a single number -------------------------

async function totalPnl(): Promise<number> {
  const result = await prisma.trade.aggregate({
    _sum: { profitLoss: true },
  });
  return result._sum.profitLoss ?? 0;
}

async function tradeCount(): Promise<number> {
  return prisma.trade.count();
}

async function winRate(): Promise<number> {
  const total = await prisma.trade.count();
  if (total === 0) return 0;
  const wins = await prisma.trade.count({
    where: { profitLoss: { gt: 0 } },
  });
  return (wins / total) * 100;
}

async function avgPnl(): Promise<number> {
  const result = await prisma.trade.aggregate({
    _avg: { profitLoss: true },
  });
  return result._avg.profitLoss ?? 0;
}

// Win ratio = winning trades / (winning + losing trades), as a percentage.
// Break-even and still-open trades (profitLoss null or 0) are excluded so the
// figure reflects decided trades only.
async function winRatio(): Promise<number> {
  const wins = await prisma.trade.count({ where: { profitLoss: { gt: 0 } } });
  const losses = await prisma.trade.count({ where: { profitLoss: { lt: 0 } } });
  const decided = wins + losses;
  if (decided === 0) return 0;
  return (wins / decided) * 100;
}

// --- Chart / table queries: each returns an array of rows ---------------

// Cumulative P&L over time: trades ordered by close date, running total.
async function pnlByDay(): Promise<{ date: string; cumulative: number }[]> {
  const trades = await prisma.trade.findMany({
    orderBy: { closeDate: "asc" },
    select: { closeDate: true, profitLoss: true },
  });
  let running = 0;
  return trades.filter((t) => t.closeDate != null).map((t) => {
    running += t.profitLoss ?? 0;
    return {
      date: t.closeDate!.toISOString().slice(0, 10),
      cumulative: Math.round(running * 100) / 100,
    };
  });
}

// Drawdown over time: how far current equity sits below its running peak.
// Always <= 0; touches 0 whenever the account makes a new high.
async function drawdownByDay(): Promise<{ date: string; drawdown: number }[]> {
  const trades = await prisma.trade.findMany({
    where: { closeDate: { not: null } },
    orderBy: { closeDate: "asc" },
    select: { closeDate: true, profitLoss: true },
  });
  let running = 0;
  let peak = 0;
  return trades.map((t) => {
    running += t.profitLoss ?? 0;
    if (running > peak) peak = running;
    return {
      date: t.closeDate!.toISOString().slice(0, 10),
      drawdown: Math.round((running - peak) * 100) / 100,
    };
  });
}

// Total P&L grouped by instrument, biggest absolute swing first.
async function pnlByInstrument(): Promise<{ instrument: string; pnl: number }[]> {
  const grouped = await prisma.trade.groupBy({
    by: ["instrument"],
    _sum: { profitLoss: true },
  });
  return grouped
    .map((g) => ({
      instrument: g.instrument,
      pnl: Math.round((g._sum.profitLoss ?? 0) * 100) / 100,
    }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}

// Most recent closed trades for the table.
async function recentTrades() {
  const trades = await prisma.trade.findMany({
    where: { closeDate: { not: null } },  // only closed trades
    orderBy: { closeDate: "desc" },
    take: 20,
    select: {
      closeDate: true,
      instrument: true,
      direction: true,
      profitLoss: true,
    },
  });
  return trades.map((t) => ({
    date: t.closeDate!.toISOString().slice(0, 10),
    instrument: t.instrument,
    direction: t.direction ?? "",
    pnl: Math.round((t.profitLoss ?? 0) * 100) / 100,
  }));
}

// Cumulative summary: one row per outcome. Won/lost rows carry a trade count
// and a £ value; the Profit/Loss row carries only a £ value (count left blank).
async function cumulativeSummary() {
  const won = await prisma.trade.aggregate({
    where: { profitLoss: { gt: 0 } },
    _count: true,
    _sum: { profitLoss: true },
  });
  const lost = await prisma.trade.aggregate({
    where: { profitLoss: { lt: 0 } },
    _count: true,
    _sum: { profitLoss: true },
  });
  const total = await prisma.trade.aggregate({ _sum: { profitLoss: true } });

  const round = (n: number) => Math.round(n * 100) / 100;

  return [
    {
      label: "Total trades won",
      count: won._count,
      value: round(won._sum.profitLoss ?? 0),
    },
    {
      label: "Total trades lost",
      count: lost._count,
      value: round(lost._sum.profitLoss ?? 0),
    },
    {
      label: "Profit / Loss",
      count: null,
      value: round(total._sum.profitLoss ?? 0),
    },
  ];
}

// Monday-based week start (UTC) for a given date, as an ISO yyyy-mm-dd string.
function weekStart(d: Date): string {
  const dt = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  const day = dt.getUTCDay(); // 0=Sun .. 6=Sat
  const shift = day === 0 ? -6 : 1 - day; // move back to Monday
  dt.setUTCDate(dt.getUTCDate() + shift);
  return dt.toISOString().slice(0, 10);
}

// Performance per week: one row for each week that has closed trades.
async function weeklyPerformance() {
  const trades = await prisma.trade.findMany({
    where: { closeDate: { not: null } },
    select: { closeDate: true, profitLoss: true },
  });

  type Acc = {
    week: string;
    trades: number;
    won: number;
    lost: number;
    pnlWon: number;
    pnlLost: number;
  };
  const byWeek = new Map<string, Acc>();

  for (const t of trades) {
    if (!t.closeDate) continue;
    const week = weekStart(t.closeDate);
    const row =
      byWeek.get(week) ??
      { week, trades: 0, won: 0, lost: 0, pnlWon: 0, pnlLost: 0 };
    row.trades += 1;
    const pnl = t.profitLoss ?? 0;
    if (pnl > 0) {
      row.won += 1;
      row.pnlWon += pnl;
    } else if (pnl < 0) {
      row.lost += 1;
      row.pnlLost += pnl;
    }
    byWeek.set(week, row);
  }

  const round = (n: number) => Math.round(n * 100) / 100;

  return [...byWeek.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((r) => {
      const decided = r.won + r.lost;
      return {
        week: r.week,
        trades: r.trades,
        won: r.won,
        lost: r.lost,
        winPct: decided === 0 ? 0 : round((r.won / decided) * 100),
        pnlWon: round(r.pnlWon),
        pnlLost: round(r.pnlLost),
        pnl: round(r.pnlWon + r.pnlLost),
      };
    });
}

// P&L per instrument with an Excel-style rank (RANK descending: highest P&L =
// rank 1; ties share a rank; the next rank skips accordingly).
async function instrumentRanking() {
  const grouped = await prisma.trade.groupBy({
    by: ["instrument"],
    _sum: { profitLoss: true },
  });

  const rows = grouped.map((g) => ({
    instrument: g.instrument,
    pnl: Math.round((g._sum.profitLoss ?? 0) * 100) / 100,
  }));

  return rows
    .map((r) => ({
      ...r,
      rank: rows.filter((o) => o.pnl > r.pnl).length + 1,
    }))
    .sort((a, b) => a.rank - b.rank);
}

// Cash flow summary from the CashTransaction table. Money-out rows are shown as
// positive magnitudes so the statement reads in / out / net cleanly, with
// net flow = total in − total out.
async function cashFlowSummary() {
  const sumWhere = async (
    where: Record<string, unknown>
  ): Promise<number> => {
    const r = await prisma.cashTransaction.aggregate({
      _sum: { amount: true },
      where,
    });
    return r._sum.amount ?? 0;
  };
  const round = (n: number) => Math.round(n * 100) / 100;

  const deposits = await sumWhere({ type: "DEPOSIT" });
  const interest = await sumWhere({ type: "FINANCING", amount: { gt: 0 } });
  const totalIn = deposits + interest;

  // Withdrawals and charges are stored signed (negative) and shown as such, so
  // they render red. Total out is therefore negative too.
  const withdrawals = await sumWhere({ type: "WITHDRAWAL" });
  const charges = await sumWhere({ type: "FINANCING", amount: { lt: 0 } });
  const totalOut = withdrawals + charges;

  // Out-flows are negative, so net flow = in + out (= total in − |total out|).
  const netFlow = totalIn + totalOut;

  return [
    { label: "Bank deposits", value: round(deposits) },
    { label: "Interest received", value: round(interest) },
    { label: "Total in", value: round(totalIn) },
    { label: "Withdrawals", value: round(withdrawals), __tone: "negative" },
    { label: "Charges", value: round(charges), __tone: "negative" },
    { label: "Total out", value: round(totalOut), __tone: "negative" },
    { label: "Net flow", value: round(netFlow) },
  ];
}

// --- Registries: the config file references these string keys -----------

export const metrics: Record<string, () => Promise<number>> = {
  totalPnl,
  tradeCount,
  winRate,
  winRatio,
  avgPnl,
};

export const queries: Record<string, () => Promise<unknown[]>> = {
  pnlByDay,
  drawdownByDay,
  pnlByInstrument,
  recentTrades,
  cumulativeSummary,
  cashFlowSummary,
  weeklyPerformance,
  instrumentRanking,
};