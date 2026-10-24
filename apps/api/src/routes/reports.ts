import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@js/database";
import { computeBatchStats, toCsv } from "@js/reporting";
import { requireProjectRole } from "../lib/access";
import { notFound, parse } from "../lib/errors";
import type { AppContext } from "../lib/context";

const reportQuery = z.object({
  batchId: z.string().min(1).max(64),
  format: z.enum(["json", "csv"]).default("json"),
  /** csv only: one row per run (default) or one row per step. */
  level: z.enum(["runs", "steps"]).default("runs"),
});

export async function reportRoutes(app: FastifyInstance, _ctx: AppContext) {
  app.get("/reports", async (req, reply) => {
    const q = parse(reportQuery, req.query);
    const batch = await prisma.testBatch.findUnique({
      where: { id: q.batchId },
      include: { scenario: { select: { name: true } }, scenarioVersion: { select: { version: true } } },
    });
    if (!batch) throw notFound("Batch");
    await requireProjectRole(req, batch.projectId);
    const runs = await prisma.testRun.findMany({
      where: { batchId: batch.id },
      orderBy: { iteration: "asc" },
      include: {
        steps: { orderBy: { stepIndex: "asc" } },
        artifacts: { select: { id: true, kind: true, stepResultId: true } },
      },
    });
    const snapshot = batch.configSnapshot as {
      browserProfile?: { name: string; engine: string } | null;
      proxy?: { name: string; regionLabel: string | null } | null;
    };
    const stats = computeBatchStats(runs);
    const filename = `batch-${batch.id}`;

    if (q.format === "json") {
      reply.header("content-disposition", `attachment; filename="${filename}.json"`);
      return {
        generatedAt: new Date().toISOString(),
        batch: {
          id: batch.id,
          scenario: batch.scenario.name,
          scenarioVersion: batch.scenarioVersion.version,
          status: batch.status,
          iterations: batch.iterations,
          concurrency: batch.concurrency,
          createdAt: batch.createdAt,
          startedAt: batch.startedAt,
          finishedAt: batch.finishedAt,
          config: batch.configSnapshot,
        },
        stats,
        runs: runs.map((r) => ({
          runId: r.id,
          iteration: r.iteration,
          status: r.status,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          durationMs: r.durationMs,
          errorCategory: r.errorCategory,
          errorMessage: r.errorMessage,
          navigationUrls: r.navigationUrls,
          observed: r.observed,
          screenshots: r.artifacts.filter((a) => a.kind === "SCREENSHOT").map((a) => a.id),
          trace: r.artifacts.find((a) => a.kind === "TRACE")?.id ?? null,
          steps: r.steps.map((s) => ({
            index: s.stepIndex,
            type: s.type,
            label: s.label,
            status: s.status,
            attempts: s.attempts,
            durationMs: s.durationMs,
            url: s.url,
            errorCategory: s.errorCategory,
            errorMessage: s.errorMessage,
            detail: s.detail,
          })),
        })),
      };
    }

    const common = (r: (typeof runs)[number]) => [
      batch.id,
      r.id,
      batch.scenarioVersion.version,
      r.iteration,
      r.status,
      r.startedAt?.toISOString(),
      r.finishedAt?.toISOString(),
      r.durationMs,
      snapshot.browserProfile?.name ?? "Default desktop",
      snapshot.browserProfile?.engine ?? "chromium",
      snapshot.proxy?.name ?? "Direct",
      snapshot.proxy?.regionLabel ?? "",
    ];
    const commonHeaders = [
      "batch_id",
      "run_id",
      "scenario_version",
      "iteration",
      "run_status",
      "started_at",
      "finished_at",
      "run_duration_ms",
      "browser_profile",
      "engine",
      "network_profile",
      "region_label",
    ];
    let csv: string;
    if (q.level === "runs") {
      csv = toCsv(
        [...commonHeaders, "error_category", "error_message", "final_url", "steps_passed", "steps_failed", "screenshots", "trace_artifact_id"],
        runs.map((r) => [
          ...common(r),
          r.errorCategory,
          r.errorMessage,
          r.finalUrl,
          r.steps.filter((s) => s.status === "PASSED").length,
          r.steps.filter((s) => s.status === "FAILED").length,
          r.artifacts.filter((a) => a.kind === "SCREENSHOT").length,
          r.artifacts.find((a) => a.kind === "TRACE")?.id,
        ]),
      );
    } else {
      csv = toCsv(
        [...commonHeaders, "step_index", "step_type", "step_label", "step_status", "attempts", "step_duration_ms", "step_url", "error_category", "error_message"],
        runs.flatMap((r) =>
          r.steps.map((s) => [...common(r), s.stepIndex + 1, s.type, s.label, s.status, s.attempts, s.durationMs, s.url, s.errorCategory, s.errorMessage]),
        ),
      );
    }
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}-${q.level}.csv"`)
      .send(csv);
  });
}
