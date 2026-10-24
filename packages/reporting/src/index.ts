/** Pure reporting helpers: statistics and export formatting. No I/O. */

export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  // Linear interpolation between closest ranks.
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const lower = sortedAsc[lo]!;
  const upper = sortedAsc[hi]!;
  return Math.round(lower + (upper - lower) * (rank - lo));
}

export interface RunLike {
  status: string;
  durationMs: number | null;
}

export interface BatchStats {
  total: number;
  finished: number;
  passed: number;
  failed: number;
  cancelled: number;
  /** passed / (passed + failed + timedOut); null until a run has finished. Cancelled runs are excluded. */
  passRate: number | null;
  durationMs: { min: number | null; p50: number | null; p90: number | null; p95: number | null; max: number | null };
}

export function computeBatchStats(runs: RunLike[]): BatchStats {
  const passed = runs.filter((r) => r.status === "PASSED").length;
  const failed = runs.filter((r) => r.status === "FAILED" || r.status === "TIMED_OUT").length;
  const cancelled = runs.filter((r) => r.status === "CANCELLED").length;
  const durations = runs
    .filter((r) => (r.status === "PASSED" || r.status === "FAILED" || r.status === "TIMED_OUT") && r.durationMs !== null)
    .map((r) => r.durationMs as number)
    .sort((a, b) => a - b);
  const judged = passed + failed;
  return {
    total: runs.length,
    finished: passed + failed + cancelled,
    passed,
    failed,
    cancelled,
    passRate: judged === 0 ? null : passed / judged,
    durationMs: {
      min: durations[0] ?? null,
      p50: percentile(durations, 50),
      p90: percentile(durations, 90),
      p95: percentile(durations, 95),
      max: durations.length ? durations[durations.length - 1]! : null,
    },
  };
}

/** RFC 4180 CSV with formula-injection protection for spreadsheet apps. */
export function toCsv(headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
