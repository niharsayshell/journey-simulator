"use client";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Ban, Download, Image as ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useApi, useProjectEvents } from "@/lib/hooks";
import type { Artifact, RunDetail, StepResult } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, ErrorAlert, Spinner } from "@/components/ui/feedback";
import { CategoryBadge, StatusBadge } from "@/components/status";
import { cn, formatDate, formatDuration } from "@/lib/utils";

function Screenshot({ a, onOpen }: { a: Artifact; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(a.id)} className="group relative block overflow-hidden rounded-md border" title="Open screenshot">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/v1/artifacts/${a.id}/content`} alt="Step screenshot" className="h-28 w-44 object-cover object-top transition group-hover:opacity-90" loading="lazy" />
    </button>
  );
}

export default function RunInspector() {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>();
  const isRunning = (s?: string) => Boolean(s && ["QUEUED", "DISPATCHED", "RUNNING"].includes(s));
  const { data, error, mutate } = useApi<{ run: RunDetail }>(`/runs/${runId}`, { refreshInterval: (l) => (isRunning(l?.run.status) ? 3000 : 0) });
  const running = isRunning(data?.run.status);
  const { data: steps, mutate: mutateSteps } = useApi<{ items: StepResult[] }>(`/runs/${runId}/steps`, { refreshInterval: running ? 3000 : 0 });
  const { data: artifacts, mutate: mutateArtifacts } = useApi<{ items: Artifact[] }>(`/runs/${runId}/artifacts`, { refreshInterval: running ? 3000 : 0 });
  useProjectEvents(projectId, (_t, evt) => {
    if (evt.runId === runId) {
      void mutate();
      void mutateSteps();
      void mutateArtifacts();
    }
  });
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<unknown>(null);

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Spinner />;
  const run = data.run;
  const base = `/projects/${projectId}`;
  const trace = artifacts?.items.find((a) => a.kind === "TRACE");
  const stepless = artifacts?.items.filter((a) => a.kind === "SCREENSHOT" && !a.stepResultId) ?? [];
  const totalMs = steps?.items.reduce((n, s) => n + s.durationMs, 0) ?? 0;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            Run {run.iteration} <StatusBadge status={run.status} />
          </span>
        }
        description={`${run.batch.scenario.name} v${run.batch.scenarioVersion.version} · run ${run.id}`}
        crumbs={[
          { href: base, label: "Project" },
          { href: `${base}/batches`, label: "Executions" },
          { href: `${base}/batches/${run.batch.id}`, label: "Batch" },
          { label: `Run ${run.iteration}` },
        ]}
        actions={
          <>
            {trace && (
              <Button variant="outline" asChild>
                <a href={`/api/v1/artifacts/${trace.id}/content`}>
                  <Download /> Playwright trace
                </a>
              </Button>
            )}
            {running && (
              <Button
                variant="destructive"
                onClick={async () => {
                  setCancelError(null);
                  try {
                    await api(`/runs/${runId}/cancel`, { method: "POST" });
                    void mutate();
                  } catch (err) {
                    setCancelError(err);
                  }
                }}
              >
                <Ban /> Cancel run
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-6">
        <ErrorAlert error={cancelError} />
        {run.errorMessage && (
          <Alert variant={run.status === "PASSED" ? "info" : run.status === "CANCELLED" ? "warning" : "error"} title={run.errorCategory ? `${run.errorCategory.replace(/_/g, " ")} error` : "Note"}>
            {run.errorMessage}
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Timing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Duration: <strong>{formatDuration(run.durationMs)}</strong></p>
              <p className="text-muted-foreground">Started {formatDate(run.startedAt)}</p>
              <p className="text-muted-foreground">Finished {formatDate(run.finishedAt)}</p>
              {run.attempt > 1 && <p className="text-muted-foreground">Attempt {run.attempt}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Browser (observed)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {run.observed ? (
                <>
                  <p>
                    {run.observed.engine} {run.observed.browserVersion}
                    {run.observed.viewport ? ` · ${run.observed.viewport.width}×${run.observed.viewport.height}` : ""}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">{run.observed.userAgent}</p>
                </>
              ) : (
                <p className="text-muted-foreground">Not available (browser did not start).</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Network</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                Selected: {run.batch.configSnapshot.proxy ? `${run.batch.configSnapshot.proxy.name} (${run.batch.configSnapshot.proxy.host}:${run.batch.configSnapshot.proxy.port})` : "Direct connection"}
              </p>
              {run.batch.configSnapshot.proxy?.regionLabel && (
                <p className="text-xs text-muted-foreground">Region label (user-entered): {run.batch.configSnapshot.proxy.regionLabel}</p>
              )}
              <p className="text-xs text-muted-foreground">Observed egress IP is measured by the proxy connectivity test, not per run.</p>
              {(run.observed?.blockedRequests?.length ?? 0) > 0 && (
                <p className="text-xs text-amber-700">{run.observed!.blockedRequests!.length} request(s) blocked by the network policy</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Step timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {!steps && <Spinner />}
            {steps && steps.items.length === 0 && <p className="text-sm text-muted-foreground">{running ? "Waiting for the first step…" : "No steps were recorded."}</p>}
            <ol className="relative space-y-4 border-l pl-6">
              {steps?.items.map((s) => (
                <li key={s.id} className="relative">
                  <span
                    className={cn(
                      "absolute -left-[31px] top-1 size-3 rounded-full border-2 border-card",
                      s.status === "PASSED" ? "bg-emerald-500" : s.status === "FAILED" ? "bg-red-500" : "bg-slate-300",
                    )}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">#{s.stepIndex + 1}</span>
                    <span className="font-medium">{s.label || s.type}</span>
                    {s.label && <span className="text-xs text-muted-foreground">{s.type}</span>}
                    <StatusBadge status={s.status} />
                    <CategoryBadge category={s.errorCategory} />
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {formatDuration(s.durationMs)}
                      {s.attempts > 1 ? ` · ${s.attempts} attempts` : ""}
                    </span>
                  </div>
                  {totalMs > 0 && s.durationMs > 0 && (
                    <div className="mt-1 h-1 rounded bg-muted">
                      <div className="h-1 rounded bg-primary/50" style={{ width: `${Math.max(1, (s.durationMs / totalMs) * 100)}%` }} />
                    </div>
                  )}
                  {s.url && <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{s.url}</p>}
                  {s.errorMessage && <p className={cn("mt-1 text-sm", s.status === "FAILED" ? "text-red-700" : "text-muted-foreground")}>{s.errorMessage}</p>}
                  {s.detail && (s.detail.expected !== undefined || s.detail.actual !== undefined) && (
                    <div className="mt-1 grid gap-1 rounded bg-muted/50 p-2 font-mono text-xs sm:grid-cols-2">
                      {s.detail.expected !== undefined && <p>expected: {JSON.stringify(s.detail.expected)}</p>}
                      {s.detail.actual !== undefined && <p>actual: {JSON.stringify(s.detail.actual)}</p>}
                    </div>
                  )}
                  {s.artifacts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.artifacts.map((a) => (
                        <Screenshot key={a.id} a={a} onOpen={setLightbox} />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {stepless.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {stepless.map((a) => (
                  <Screenshot key={a.id} a={a} onOpen={setLightbox} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {run.navigationUrls && run.navigationUrls.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Navigation history</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-1 pl-5 font-mono text-xs">
                {run.navigationUrls.map((u, i) => (
                  <li key={i} className="break-all">
                    {u}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        )}

        {(run.observed?.blockedRequests?.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Blocked by network policy</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs">
                {run.observed!.blockedRequests!.map((b, i) => (
                  <li key={i} className="break-all">
                    <span className="font-mono">{b.url}</span> — {b.reason}
                    {b.isNavigation && <strong> (navigation)</strong>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setLightbox(null)} role="dialog" aria-label="Screenshot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/v1/artifacts/${lightbox}/content`} alt="Screenshot" className="max-h-full max-w-full rounded-lg shadow-2xl" />
          <span className="absolute right-4 top-4 flex items-center gap-1 text-sm text-white">
            <ImageIcon className="size-4" /> click to close
          </span>
        </div>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        <Link href={`${base}/batches/${run.batch.id}`} className="hover:underline">
          ← Back to batch
        </Link>
      </p>
    </>
  );
}
