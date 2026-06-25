/**
 * backfill.ts — one-off historical backfill (open-aware)
 * ------------------------------------------------------
 * Same result as ingest.ts, but for a long history. Two differences:
 *
 *  1. It pages the history backwards in fixed windows (IG caps how far a
 *     single /history/* call reaches), with a polite pause and 403 backoff.
 *
 *  2. It collects ALL activities across every window FIRST, then resolves
 *     opens. This matters: a trade's opening activity often sits in a
 *     different window than its close, so per-window resolution would miss it.
 *     With the full set in one map, every close can find its open regardless
 *     of which window each landed in — so openDate / openLevel / direction /
 *     durationSecs fill in correctly across the whole period.
 *
 * Run once:   npx tsx scripts/backfill.ts
 * Then use ingest.ts (LOOKBACK_DAYS = 10) for nightly runs.
 *
 * Safe to re-run / overlap: every upsert keys on openId.
 *
 * Edge: a trade whose OPEN is older than TOTAL_DAYS but whose CLOSE is within
 * it will still record the close, but its open fields stay null (the opening
 * activity is beyond the fetched range). Widen TOTAL_DAYS to capture those.
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const BASE =
  process.env.IG_ACC_TYPE === "LIVE"
    ? "https://api.ig.com/gateway/deal"
    : "https://demo-api.ig.com/gateway/deal";

const API_KEY = process.env.IG_API_KEY!;
const USERNAME = process.env.IG_USERNAME!;
const PASSWORD = process.env.IG_PASSWORD!;

// ---- backfill controls ----
const TOTAL_DAYS = 350; // how far back in total
const CHUNK_DAYS = 30; // window size per request (stay under IG's cap)
const CHUNK_PAUSE_MS = 2000; // delay between windows (avoids the 403 rate limit)

// ----------------------------------------------------------------- types ----
interface Tokens {
  cst: string;
  securityToken: string;
}
interface IgActivity {
  date: string;
  epic?: string;
  dealId: string;
  details?: {
    marketName?: string;
    direction?: string;
    size?: number;
    level?: number;
    currency?: string;
    actions?: { actionType: string; affectedDealId: string }[];
  };
}
interface IgTransaction {
  reference: string;
  profitAndLoss?: string;
}
interface IgPosition {
  position: {
    dealId: string;
    direction?: string;
    size?: number;
    level?: number;
    currency?: string;
    createdDateUTC?: string;
    createdDate?: string;
  };
  market: { instrumentName?: string; epic?: string };
}

// ------------------------------------------------------------- helpers ------
function parseAmount(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function igTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createSession(): Promise<Tokens> {
  const res = await fetch(`${BASE}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-IG-API-KEY": API_KEY,
      Version: "2",
    },
    body: JSON.stringify({ identifier: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Session failed: ${res.status} ${res.statusText}`);
  const cst = res.headers.get("CST");
  const securityToken = res.headers.get("X-SECURITY-TOKEN");
  if (!cst || !securityToken) throw new Error("Missing auth tokens in response headers");
  return { cst, securityToken };
}

// GET with 403 backoff: IG rate-limits history calls, so on a 403 we wait and
// retry the same request a few times (escalating the wait) instead of dying.
async function igGet(
  path: string,
  tokens: Tokens,
  version: string,
  attempt = 1,
): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "X-IG-API-KEY": API_KEY,
      CST: tokens.cst,
      "X-SECURITY-TOKEN": tokens.securityToken,
      Version: version,
    },
  });

  if (res.status === 403 && attempt <= 5) {
    const wait = attempt * 10_000; // 10s, 20s, 30s...
    console.log(`  403 — backing off ${wait / 1000}s (attempt ${attempt})`);
    await sleep(wait);
    return igGet(path, tokens, version, attempt + 1);
  }

  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

// ------------------------------------------------- collect the full history --
async function collectHistory(
  tokens: Tokens,
): Promise<{ activities: IgActivity[]; transactions: IgTransaction[] }> {
  const activities: IgActivity[] = [];
  const transactions: IgTransaction[] = [];

  for (let offset = 0; offset < TOTAL_DAYS; offset += CHUNK_DAYS) {
    const to = igTimestamp(new Date(Date.now() - offset * 86_400_000));
    const from = igTimestamp(
      new Date(Date.now() - Math.min(offset + CHUNK_DAYS, TOTAL_DAYS) * 86_400_000),
    );

    const actData = (await igGet(
      `/history/activity?from=${from}&to=${to}&detailed=true`,
      tokens,
      "3",
    )) as { activities: IgActivity[] };
    const txData = (await igGet(
      `/history/transactions?from=${from}&to=${to}`,
      tokens,
      "2",
    )) as { transactions: IgTransaction[] };

    const a = actData.activities ?? [];
    const t = txData.transactions ?? [];
    activities.push(...a);
    transactions.push(...t);

    console.log(`  ${from} → ${to}: ${a.length} activities, ${t.length} transactions`);
    await sleep(CHUNK_PAUSE_MS);
  }

  return { activities, transactions };
}

// ----------------------------------------- resolve + write from full history --
async function writeCloses(
  activities: IgActivity[],
  transactions: IgTransaction[],
): Promise<{ matched: number; closes: number }> {
  // closeId -> P&L (whole period)
  const pnlByCloseId = new Map<string, number | null>();
  for (const t of transactions) pnlByCloseId.set(t.reference, parseAmount(t.profitAndLoss));

  // dealId -> activity (whole period), so any close finds its open by openId.
  const activityByDealId = new Map<string, IgActivity>();
  for (const a of activities) activityByDealId.set(a.dealId, a);

  let matched = 0;
  let closes = 0;

  for (const a of activities) {
    const action = a.details?.actions?.find(
      (x) =>
        x.actionType === "POSITION_CLOSED" ||
        x.actionType === "POSITION_PARTIALLY_CLOSED",
    );
    const openId = action?.affectedDealId;
    if (!openId) continue;

    closes++;
    const closeId = a.dealId;
    const closeDate = new Date(a.date);
    const closeLevel = a.details?.level ?? null;
    const profitLoss = pnlByCloseId.get(closeId) ?? null;
    if (profitLoss != null) matched++;

    const openAct = activityByDealId.get(openId);
    const existing = await prisma.trade.findUnique({ where: { openId } });

    const openDate =
      (openAct ? new Date(openAct.date) : null) ?? existing?.openDate ?? null;
    const openLevel = openAct?.details?.level ?? existing?.openLevel ?? null;
    const direction =
      openAct?.details?.direction ??
      existing?.direction ??
      a.details?.direction ??
      null;
    const durationSecs = openDate
      ? Math.round((closeDate.getTime() - openDate.getTime()) / 1000)
      : (existing?.durationSecs ?? null);

    const resolved = {
      closeId,
      closeDate,
      closeLevel,
      profitLoss,
      openDate,
      openLevel,
      direction,
      durationSecs,
    };

    await prisma.trade.upsert({
      where: { openId },
      update: resolved,
      create: {
        openId,
        instrument:
          openAct?.details?.marketName ?? a.details?.marketName ?? a.epic ?? "unknown",
        size: openAct?.details?.size ?? a.details?.size ?? null,
        currency: a.details?.currency ?? null,
        ...resolved,
      },
    });
  }
  return { matched, closes };
}

async function ingestOpenPositions(tokens: Tokens): Promise<number> {
  const data = (await igGet("/positions", tokens, "2")) as { positions: IgPosition[] };
  const positions = data.positions ?? [];
  for (const { position: p, market: m } of positions) {
    const openFields = {
      instrument: m.instrumentName ?? m.epic ?? "unknown",
      direction: p.direction ?? null,
      size: p.size ?? null,
      openLevel: p.level ?? null,
      openDate: new Date(p.createdDateUTC ?? p.createdDate ?? Date.now()),
      currency: p.currency ?? null,
    };
    await prisma.trade.upsert({
      where: { openId: p.dealId },
      create: { openId: p.dealId, ...openFields },
      update: openFields,
    });
  }
  return positions.length;
}

// ----------------------------------------------------------------- main -----
async function main() {
  const tokens = await createSession();

  console.log("Collecting history...");
  const { activities, transactions } = await collectHistory(tokens);
  console.log(
    `\nCollected ${activities.length} activities, ${transactions.length} transactions.`,
  );

  console.log("Resolving opens and writing closes...");
  const { matched, closes } = await writeCloses(activities, transactions);

  const opened = await ingestOpenPositions(tokens);

  console.log(`\nBackfill complete.`);
  console.log(`Open positions upserted: ${opened}`);
  console.log(`Total closes processed:  ${closes} (P&L matched: ${matched})`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });