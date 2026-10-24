import { describe, expect, it } from "vitest";
import { computeBatchStats, percentile, toCsv } from "@js/reporting";

describe("percentile", () => {
  it("interpolates", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4], 50)).toBe(3); // 2.5 rounds to 3
    expect(percentile([10, 20, 30, 40, 50], 90)).toBe(46);
  });
});

describe("batch stats", () => {
  it("excludes cancelled and unfinished runs from pass rate and timings", () => {
    const s = computeBatchStats([
      { status: "PASSED", durationMs: 100 },
      { status: "PASSED", durationMs: 300 },
      { status: "FAILED", durationMs: 200 },
      { status: "TIMED_OUT", durationMs: 900 },
      { status: "CANCELLED", durationMs: 5 },
      { status: "RUNNING", durationMs: null },
    ]);
    expect(s).toMatchObject({ total: 6, passed: 2, failed: 2, cancelled: 1, finished: 5, passRate: 0.5 });
    expect(s.durationMs.min).toBe(100);
    expect(s.durationMs.max).toBe(900);
  });
  it("reports null pass rate before any run finishes", () => {
    expect(computeBatchStats([{ status: "QUEUED", durationMs: null }]).passRate).toBeNull();
  });
});

describe("CSV", () => {
  it("quotes and neutralises spreadsheet formulas", () => {
    const csv = toCsv(["a", "b"], [["=HYPERLINK(1)", 'he said "hi", ok'], [null, 3]]);
    expect(csv).toBe('a,b\r\n\'=HYPERLINK(1),"he said ""hi"", ok"\r\n,3\r\n');
  });
});
