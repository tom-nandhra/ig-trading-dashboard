// src/app/page.tsx
import { dashboardConfig } from "../lib/dashboard.config";
import { metrics, queries } from "../lib/queries";
import DashboardClient from "../components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { title, widgets } = dashboardConfig;

  const neededMetrics = new Set<string>();
  const neededQueries = new Set<string>();
  for (const w of widgets) {
    if (w.type === "stat") {
      neededMetrics.add(w.metric);
    } else {
      neededQueries.add(w.query);
      if (w.type === "table" && w.headerStat) {
        neededMetrics.add(w.headerStat.metric);
      }
    }
  }

  const metricData: Record<string, number> = {};
  await Promise.all(
    [...neededMetrics].map(async (key) => {
      const fn = metrics[key];
      if (fn) metricData[key] = await fn();
    })
  );

  const queryData: Record<string, Record<string, unknown>[]> = {};
  await Promise.all(
    [...neededQueries].map(async (key) => {
      const fn = queries[key];
      if (fn) queryData[key] = (await fn()) as Record<string, unknown>[];
    })
  );

  return (
    <DashboardClient
      title={title}
      widgets={widgets}
      data={{ metrics: metricData, queries: queryData }}
    />
  );
}
