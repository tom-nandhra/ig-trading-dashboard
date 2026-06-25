// src/app/page.tsx
// The server page. On each request it reads the widget config, runs only the
// queries that config actually references, and hands the computed data to the
// client renderer. Because this is a server component, the database is queried
// on the server and the browser only receives finished numbers.

import { dashboardConfig } from "../lib/dashboard.config";
import { metrics, queries } from "../lib/queries";
import DashboardClient from "../components/DashboardClient";

export const dynamic = "force-dynamic"; // always fresh; no static caching

export default async function Page() {
  const { title, widgets } = dashboardConfig;

  // Collect the metric/query keys this config actually uses, so we only run
  // what's needed.
  const neededMetrics = new Set<string>();
  const neededQueries = new Set<string>();
  for (const w of widgets) {
    if (w.type === "stat") neededMetrics.add(w.metric);
    else neededQueries.add(w.query);
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