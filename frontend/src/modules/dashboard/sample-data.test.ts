import { describe, expect, it } from "vitest";

import { sampleSalesOverview } from "./sample-data";

const AFTERNOON = new Date(2026, 9, 31, 14, 30); // 2:30 pm local
const EARLY = new Date(2026, 9, 31, 5, 0); // before opening

describe("sample sales overview", () => {
  it("is marked as sample data and follows the contract", () => {
    const overview = sampleSalesOverview("today", AFTERNOON);

    expect(overview.is_sample).toBe(true);
    expect(overview.series.bucket).toBe("hour");
    expect(overview.kpis.sales.value).toMatch(/^\d+\.\d{4}$/);
    expect(overview.best_sellers.length).toBeGreaterThan(0);
    expect(overview.recent_transactions[0].receipt_number).toMatch(/^T0[12]-\d{6}$/);
  });

  it("is deterministic for the same day and range", () => {
    expect(sampleSalesOverview("7d", AFTERNOON)).toEqual(sampleSalesOverview("7d", AFTERNOON));
  });

  it("never shows hours that have not happened yet", () => {
    const points = sampleSalesOverview("today", AFTERNOON).series.points;
    expect(points.at(-1)?.label).toBe("2pm");
    expect(sampleSalesOverview("today", EARLY).series.points).toHaveLength(0);
    expect(sampleSalesOverview("today", EARLY).recent_transactions).toHaveLength(0);
  });

  it("uses one bucket per day for multi-day ranges", () => {
    expect(sampleSalesOverview("7d", AFTERNOON).series.points).toHaveLength(7);
    expect(sampleSalesOverview("30d", AFTERNOON).series.points).toHaveLength(30);
  });

  it("orders best sellers by sales", () => {
    const sales = sampleSalesOverview("30d", AFTERNOON).best_sellers.map((p) => Number(p.sales));
    expect([...sales].sort((a, b) => b - a)).toEqual(sales);
  });
});
