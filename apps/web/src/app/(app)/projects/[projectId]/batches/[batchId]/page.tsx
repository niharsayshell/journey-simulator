"use client";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Ban, Download, RotateCw } from "lucide-react";
import type { BatchCounts } from "@js/shared";
import { api } from "@/lib/api";
import { useApi, useProjectEvents } from "@/lib/hooks";
import type { Batch, BatchStats, RunSummary } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert, Spinner } from "@/components/ui/feedback";
import { CategoryBadge, StatusBadge } from "@/components/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatDuration } from "@/lib/utils";

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ProgressBar({ c }: { c: BatchCounts }) {
  const pct = (n: number) => `${c.total ? (n / c.total) * 100 : 0}%`;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={c.total - c.queued - c.running} aria-valuemax={c.total}>
      <div className="bg-emerald-500" style={{ width: pct(c.passed) }} />
      <div className="bg-red-500" style={{ width: pct(c.failed) }} />
      <div className="bg-slate-400" style={{ width: pct(c.cancelled) }} />
      <div className="animate-pulse bg-sky-400" style={{ width: pct(c.running) }} />
    </div>
  );
}

export default function BatchMonitor() {
  const { projectId, batchId } = useParams<{ projectId: string; batchId: string }>();
  const isActive = (status?: string) => Boolean(status && ["QUEUED", "RUNNING", "CANCELLING"].includes(status));
  const { data, error, mutate } = useApi<{ batch: Batch; counts: BatchCounts; stats: BatchStats }>(`/batches/${batchId}`, {
    // Polling is a safety net in case the SSE connection drops.
    refreshInterval: (latest) => (isActive(latest?.batch.status) ? 3000 : 0),
  });
  const active = isActive(data?.batch.status);
  const { data: runs, mutate: mutateRuns } = useApi<{ items: RunSummary[]; total: number }>(`/batches/${batchId}/runs?limit=500`, {
    refreshInterval: active ? 3000 : 0,
  });
  // Live updates via SSE.
  useProjectEvents(
    projectId,
    () => {
      void mutate();
      void mutateRuns();
    },
    batchId,
  );
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<unknown>(null);

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Spinner />;
  const { batch, counts, stats } = data;
  const base = `/projects/${projectId}`;
  const cfg = batch.configSnapshot;

  async function cancel() {
    if (!confirm("Cancel this batch? Queued runs are cancelled and running browsers are stopped at the current step.")) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await api(`/batches/${batchId}/cancel`, { method: "POST" });
      await mutate();
    } catch (err) {
      setCancelError(err);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {batch.scenario.name} <StatusBadge status={batch.status} />
          </span>
        }
        description={`Batch ${batch.id} · scenario v${batch.scenarioVersion.version} · started by ${batch.createdBy?.email ?? "unknown"} ${formatDate(batch.createdAt)}`}
        crumbs={[{ href: base, label: "Project" }, { href: `${base}/batches`, label: "Executions" }, { label: batch.id }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/v1/reports?batchId=${batchId}&format=csv`}>
                <Download /> CSV
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/api/v1/reports?batchId=${batchId}&format=csv&level=steps`}>
                <Download /> Steps CSV
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/api/v1/reports?batchId=${batchId}&format=json`}>
                <Download /> JSON
              </a>
            </Button>
            {batch.scenario.id && (
              <Button variant="outline" asChild>
                <Link href={`${base}/scenarios/${batch.scenarioId}/run`}>
                  <RotateCw /> Run again
                </Link>
              </Button>
            )}
            {active && (
              <Button variant="destructive" onClick={cancel} loading={cancelling} disabled={batch.status === "CANCELLING"}>
                <Ban /> {batch.status === "CANCELLING" ? "Cancelling…" : "Cancel batch"}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4">
        <ErrorAlert error={cancelError} title="Could not cancel" />
      </div>
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-3 pt-5">
            <ProgressBar c={counts} />
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-emerald-700">{counts.passed} passed</span>
              <span className="text-red-700">{counts.failed} failed</span>
              <span>{counts.running} running</span>
              <span className="text-muted-foreground">{counts.queued} queued</span>
              <span className="text-muted-foreground">{counts.cancelled} cancelled</span>
              <span className="ml-auto text-muted-foreground">
                {counts.total} total · {batch.concurrency} parallel
                {batch.launchDelayMs ? ` · ${batch.launchDelayMs / 1000}s between launches` : ""}
              </span>
            </div>
            {batch.cancelReason && <p className="text-xs text-muted-foreground">Stopped: {batch.cancelReason}</p>}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Stat label="Pass rate" value={stats.passRate === null ? "—" : `${Math.round(stats.passRate * 100)}%`} sub="excludes cancelled runs" />
          <Stat label="p50 duration" value={formatDuration(stats.durationMs.p50)} />
          <Stat label="p90 duration" value={formatDuration(stats.durationMs.p90)} />
          <Stat label="p95 duration" value={formatDuration(stats.durationMs.p95)} />
          <Stat label="Min / max" value={<span className="text-base">{formatDuration(stats.durationMs.min)} / {formatDuration(stats.durationMs.max)}</span>} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Configuration used</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Browser profile</p>
              <p>
                {cfg.browserProfile
                  ? `${cfg.browserProfile.name} — ${cfg.browserProfile.engine}, ${cfg.browserProfile.viewportWidth}×${cfg.browserProfile.viewportHeight}`
                  : "Default desktop — chromium, 1366×768"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Network (selected)</p>
              <p>{cfg.proxy ? `${cfg.proxy.name} — ${cfg.proxy.type} ${cfg.proxy.host}:${cfg.proxy.port}${cfg.proxy.regionLabel ? ` · region label "${cfg.proxy.regionLabel}"` : ""}` : "Direct connection"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Session · analytics marker</p>
              <p>
                Fresh session · {cfg.testHeader ? `${cfg.testHeader.name}: ${cfg.testHeader.value}` : "no test header"}
                {batch.captureTrace ? " · traces on" : ""}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!runs && <Spinner />}
            {runs && (
              <Table>
                <THead>
                  <TR>
                    <TH>#</TH>
                    <TH>Status</TH>
                    <TH>Duration</TH>
                    <TH>Started</TH>
                    <TH>Error</TH>
                  </TR>
                </THead>
                <TBody>
                  {runs.items.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link href={`${base}/runs/${r.id}`} className="font-medium text-primary hover:underline">
                          Run {r.iteration}
                        </Link>
                        {r.attempt > 1 && <span className="text-xs text-muted-foreground"> (attempt {r.attempt})</span>}
                      </TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD className="tabular-nums">{formatDuration(r.durationMs)}</TD>
                      <TD className="text-xs text-muted-foreground">{formatDate(r.startedAt)}</TD>
                      <TD className="max-w-md">
                        <div className="flex items-center gap-2">
                          <CategoryBadge category={r.errorCategory} />
                          <span className="truncate text-xs text-muted-foreground" title={r.errorMessage ?? undefined}>
                            {r.errorMessage}
                          </span>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
