import type { DashboardRange, SalesOverview } from "./types";

/**
 * SAMPLE DATA ONLY — there are no sales until the point of sale exists.
 *
 * Produces a realistic, deterministic SalesOverview so the dashboard can be
 * designed and tested. It is not a business calculation: the arithmetic here
 * only assembles plausible-looking numbers, and the real figures will come
 * from the server (types.ts). Delete this file when the sales endpoint lands.
 */

/** Deterministic PRNG (mulberry32): same range + day → same sample. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const money = (n: number) => n.toFixed(4);
const percent = (now: number, before: number) => (before === 0 ? null : (((now - before) / before) * 100).toFixed(1));

/** Demo catalog names (DemoDataSeeder) so the sample reads like this store. */
const PRODUCTS = [
  { name: "Lucky Me! Pancit Canton Original 80g", unit: "pc", price: 16 },
  { name: "Coca-Cola Regular 1.5L", unit: "pc", price: 75 },
  { name: "Fresh Eggs Large", unit: "pc", price: 9.5 },
  { name: "Jasmine Rice Per kg", unit: "kg", price: 58 },
  { name: "Coca-Cola Regular 330ml Can", unit: "pc", price: 35 },
  { name: "Century Tuna Flakes in Oil 155g", unit: "pc", price: 42.5 },
  { name: "Datu Puti Vinegar 1L", unit: "pc", price: 45 },
];

const CASHIERS = ["Juan Dela Cruz", "Ana Reyes"];
const METHODS = ["Cash", "Cash", "Cash", "GCash", "GCash", "Maya", "Card"] as const;

/** Hourly shape of a grocery day, 7:00–21:00 (weights). */
const HOUR_WEIGHTS = [3, 5, 7, 8, 9, 11, 9, 7, 7, 8, 10, 12, 11, 8, 5];
const OPEN_HOUR = 7;

interface Bucket {
  label: string;
  startsAt: Date;
  sales: number;
  transactions: number;
}

function hourlyBuckets(now: Date, rand: () => number): Bucket[] {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return HOUR_WEIGHTS.flatMap((weight, i) => {
    const startsAt = new Date(day);
    startsAt.setHours(OPEN_HOUR + i);
    if (startsAt > now) return []; // the rest of today has not happened yet
    const transactions = Math.round(weight * (2.2 + rand()));
    const hour = OPEN_HOUR + i;
    const label = `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "am" : "pm"}`;
    return [{ label, startsAt, transactions, sales: transactions * (240 + rand() * 160) }];
  });
}

function dailyBuckets(now: Date, days: number, rand: () => number): Bucket[] {
  return Array.from({ length: days }, (_, i) => {
    const startsAt = new Date(now);
    startsAt.setHours(0, 0, 0, 0);
    startsAt.setDate(startsAt.getDate() - (days - 1 - i));
    const weekend = startsAt.getDay() === 0 || startsAt.getDay() === 6;
    const transactions = Math.round((weekend ? 330 : 250) * (0.85 + rand() * 0.3));
    const label = startsAt.toLocaleDateString("en-PH", days > 7 ? { day: "numeric", month: "short" } : { weekday: "short" });
    return { label, startsAt, transactions, sales: transactions * (285 + rand() * 60) };
  });
}

export function sampleSalesOverview(range: DashboardRange, now = new Date()): SalesOverview {
  const daySeed = Number(`${now.getFullYear()}${now.getMonth() + 1}${now.getDate()}`);
  const rand = random(daySeed * 31 + range.length);
  const buckets = range === "today" ? hourlyBuckets(now, rand) : dailyBuckets(now, range === "7d" ? 7 : 30, rand);

  const sales = buckets.reduce((sum, b) => sum + b.sales, 0);
  const transactions = buckets.reduce((sum, b) => sum + b.transactions, 0);
  const previousSales = sales * (0.88 + rand() * 0.18);
  const previousTransactions = Math.round(transactions * (0.9 + rand() * 0.15));
  const profit = sales * 0.2;
  const previousProfit = previousSales * 0.195;
  const avg = transactions === 0 ? 0 : sales / transactions;
  const previousAvg = previousTransactions === 0 ? 0 : previousSales / previousTransactions;

  const scale = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const bestSellers = PRODUCTS.slice(0, 5).map((p, i) => {
    const quantity = Math.round((140 - i * 22) * scale * (0.9 + rand() * 0.2) * (transactions > 0 ? 1 : 0));
    return { sku_id: `sample-sku-${i}`, name: p.name, quantity_sold: quantity.toFixed(4), unit: p.unit, sales: money(quantity * p.price) };
  }).sort((a, b) => Number(b.sales) - Number(a.sales));

  const recent = Array.from({ length: Math.min(8, transactions) }, (_, i) => {
    const occurredAt = new Date(now.getTime() - (i * 7 + Math.floor(rand() * 6)) * 60_000);
    const terminal = i % 3 === 2 ? "T02" : "T01";
    const items = 1 + Math.floor(rand() * 14);
    return {
      id: `sample-sale-${i}`,
      receipt_number: `${terminal}-${String(1284 - i).padStart(6, "0")}`,
      occurred_at: occurredAt.toISOString(),
      cashier_name: terminal === "T01" ? CASHIERS[0] : CASHIERS[1],
      terminal_code: terminal,
      item_count: items,
      payment_method: METHODS[Math.floor(rand() * METHODS.length)],
      total: money(Math.round(items * (35 + rand() * 60) * 100) / 100),
      status: i === 4 ? ("voided" as const) : ("completed" as const),
    };
  });

  const comparedPoints = buckets.map((b) => ({
    label: b.label,
    starts_at: b.startsAt.toISOString(),
    sales: money(Math.round(b.sales)),
    transactions: b.transactions,
  }));

  return {
    range,
    is_sample: true,
    generated_at: now.toISOString(),
    kpis: {
      sales: { value: money(sales), previous: money(previousSales), change_percent: percent(sales, previousSales) },
      transactions: { value: transactions, previous: previousTransactions, change_percent: percent(transactions, previousTransactions) },
      average_transaction_value: { value: money(avg), previous: money(previousAvg), change_percent: percent(avg, previousAvg) },
      gross_profit: {
        value: money(profit),
        previous: money(previousProfit),
        change_percent: percent(profit, previousProfit),
        margin_percent: sales === 0 ? "0.0" : ((profit / sales) * 100).toFixed(1),
      },
    },
    series: { bucket: range === "today" ? "hour" : "day", points: comparedPoints },
    best_sellers: bestSellers,
    recent_transactions: recent,
  };
}
