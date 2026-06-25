/**
 * cash.ts — ingest deposits, withdrawals, and financing adjustments.
 *   npx tsx scripts/cash.ts
 * Safe to re-run / overlap: every upsert keys on the unique `reference`.
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

const TOTAL_DAYS = 400;
const CHUNK_DAYS = 30;
const PAUSE_MS = 2000;

interface Tokens { cst: string; securityToken: string }
interface RawTxn {
  date: string;
  dateUtc: string;        // e.g. "2026-06-25T08:15:41" — NO zone suffix (see note below)
  transactionType: string;
  instrumentName: string;
  profitAndLoss: string;  // e.g. "£-101.40", "£5,000.00"
  reference: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const igTimestamp = (d: Date) => d.toISOString().slice(0, 19);

// Strip everything that isn't a digit, dot, or minus: "£5,000.00" -> 5000, "£-101.40" -> -101.4.
// The ^ inside [...] negates the class. \- escapes the minus so it's literal, not a range.
function parseAmount(raw: string): number {
  const n = Number(raw.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

// Bank transfers are named "Bank Deposit" / "Bank Withdrawal"; everything else
// (financing, admin fees, interest, CRPREM) is a financing-type adjustment.
function classify(
  transactionType: string,
  instrumentName: string,
): "DEPOSIT" | "WITHDRAWAL" | "FINANCING" {
  if (instrumentName.startsWith("Bank ")) {
    return transactionType === "DEPO" ? "DEPOSIT" : "WITHDRAWAL";
  }
  return "FINANCING";
}

async function createSession(): Promise<Tokens> {
  const res = await fetch(`${BASE}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-IG-API-KEY": API_KEY, Version: "2" },
    body: JSON.stringify({ identifier: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Session failed: ${res.status} ${res.statusText}`);
  const cst = res.headers.get("CST");
  const securityToken = res.headers.get("X-SECURITY-TOKEN");
  if (!cst || !securityToken) throw new Error("Missing auth tokens in response headers");
  return { cst, securityToken };
}

async function igGet(path: string, tokens: Tokens, version: string, attempt = 1): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "X-IG-API-KEY": API_KEY,
      CST: tokens.cst,
      "X-SECURITY-TOKEN": tokens.securityToken,
      Version: version,
    },
  });
  if (res.status === 403 && attempt <= 5) {
    const wait = attempt * 10_000;
    console.log(`  403 — backing off ${wait / 1000}s (attempt ${attempt})`);
    await sleep(wait);
    return igGet(path, tokens, version, attempt + 1);
  }
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const tokens = await createSession();
  const all: RawTxn[] = [];

  for (let offset = 0; offset < TOTAL_DAYS; offset += CHUNK_DAYS) {
    const to = igTimestamp(new Date(Date.now() - offset * 86_400_000));
    const from = igTimestamp(
      new Date(Date.now() - Math.min(offset + CHUNK_DAYS, TOTAL_DAYS) * 86_400_000),
    );
    const data = (await igGet(`/history/transactions?from=${from}&to=${to}`, tokens, "2")) as {
      transactions: RawTxn[];
    };
    const rows = data.transactions ?? [];
    all.push(...rows);
    console.log(`  ${from} → ${to}: ${rows.length} transactions`);
    await sleep(PAUSE_MS);
  }

  // Whitelist the cash types — safer than "!== DEAL" if IG ever adds a new type.
  const cashRows = all.filter(
    (r) => r.transactionType === "DEPO" || r.transactionType === "WITH",
  );

  let written = 0;
  for (const r of cashRows) {
    await prisma.cashTransaction.upsert({
      where: { reference: r.reference },
      create: {
        type: classify(r.transactionType, r.instrumentName),
        amount: parseAmount(r.profitAndLoss),
        // dateUtc has no "Z", so JS would read it as LOCAL time (your BST trap).
        // Append "Z" to force UTC, which is what the field name promises.
        date: new Date(r.dateUtc + "Z"),
        reference: r.reference,
        description: r.instrumentName,
      },
      update: {}, // these rows never change, so nothing to update on re-run
    });
    written++;
  }

  console.log(`\nWrote/verified ${written} cash transactions (${all.length} rows scanned).`);
}

main()
  .catch((err) => {
    console.error("Cash ingest failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });