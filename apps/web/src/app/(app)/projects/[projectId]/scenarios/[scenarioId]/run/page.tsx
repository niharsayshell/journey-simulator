"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FlaskConical, Play } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { BrowserProfile, Paginated, ProxyProfile, ScenarioDetail } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, NativeSelect } from "@/components/ui/input";
import { Alert, ErrorAlert, Spinner } from "@/components/ui/feedback";

interface SystemInfo {
  limits: { maxIterationsPerBatch: number; maxConcurrencyPerBatch: number; minLaunchDelayMs: number };
  workerEngines: string[];
}

interface DryRunResult {
  valid: boolean;
  issues: Array<{ path: string; message: string }>;
  plan: { scenarioVersion: number; iterations: number; concurrency: number; engine: string; proxy: string | null; workersOnline: boolean };
}

export default function RunConfigPage() {
  const { projectId, scenarioId } = useParams<{ projectId: string; scenarioId: string }>();
  const router = useRouter();
  const { data: sc } = useApi<ScenarioDetail>(`/scenarios/${scenarioId}`);
  const { data: info } = useApi<SystemInfo>("/system/info");
  const { data: browsers } = useApi<Paginated<BrowserProfile>>(`/browser-profiles?projectId=${projectId}&limit=100`);
  const { data: proxies } = useApi<Paginated<ProxyProfile>>(`/proxy-profiles?projectId=${projectId}&limit=100`);

  const [iterations, setIterations] = useState(3);
  const [concurrency, setConcurrency] = useState(1);
  const [launchDelaySec, setLaunchDelaySec] = useState(0);
  const [browserProfileId, setBrowserProfileId] = useState("");
  const [proxyProfileId, setProxyProfileId] = useState("");
  const [captureTrace, setCaptureTrace] = useState(false);
  const [maxFailures, setMaxFailures] = useState(0);
  const [busy, setBusy] = useState<"dry" | "run" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dry, setDry] = useState<DryRunResult | null>(null);

  if (!sc || !info || !browsers || !proxies) return <Spinner />;
  const lim = info.limits;
  const body = (dryRun: boolean) => ({
    scenarioId,
    iterations,
    concurrency,
    launchDelayMs: Math.round(launchDelaySec * 1000),
    browserProfileId: browserProfileId || undefined,
    proxyProfileId: proxyProfileId || undefined,
    sessionMode: "FRESH_SESSION",
    captureTrace,
    maxFailures,
    dryRun,
  });

  async function submit(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "run");
    setError(null);
    setDry(null);
    try {
      if (dryRun) setDry(await api<DryRunResult>("/batches", { method: "POST", body: body(true) }));
      else {
        const res = await api<{ batch: { id: string } }>("/batches", { method: "POST", body: body(false) });
        router.push(`/projects/${projectId}/batches/${res.batch.id}`);
        return;
      }
    } catch (err) {
      setError(err);
    }
    setBusy(null);
  }

  return (
    <>
      <PageHeader
        title="Execution configuration"
        description={`${sc.scenario.name} · version ${sc.scenario.latestVersion} · ${sc.scenario.definition.steps.length} steps`}
        crumbs={[
          { href: `/projects/${projectId}`, label: "Project" },
          { href: `/projects/${projectId}/scenarios`, label: "Scenarios" },
          { href: `/projects/${projectId}/scenarios/${scenarioId}`, label: sc.scenario.name },
          { label: "Run" },
        ]}
      />
      {info.workerEngines.length === 0 && (
        <Alert variant="warning" title="No browser workers online" className="mb-4">
          Runs will wait in the queue until a worker starts. Start one with <code>pnpm --filter @js/worker dev</code>.
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Repetition</CardTitle>
            <CardDescription>Each iteration is a separate run with its own record and a fresh, isolated browser.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Iterations" htmlFor="it" hint={`Maximum ${lim.maxIterationsPerBatch} (administrator limit).`}>
              <Input id="it" type="number" min={1} max={lim.maxIterationsPerBatch} value={iterations} onChange={(e) => setIterations(Number(e.target.value))} />
            </Field>
            <Field label="Parallel browsers" htmlFor="cc" hint={`Maximum ${lim.maxConcurrencyPerBatch}.`}>
              <Input id="cc" type="number" min={1} max={lim.maxConcurrencyPerBatch} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} />
            </Field>
            <Field label="Delay between launches (seconds)" htmlFor="ld">
              <Input id="ld" type="number" min={lim.minLaunchDelayMs / 1000} step="0.5" value={launchDelaySec} onChange={(e) => setLaunchDelaySec(Number(e.target.value))} />
            </Field>
            <Field label="Stop after N failed runs" htmlFor="mf" hint="0 = never stop early.">
              <Input id="mf" type="number" min={0} value={maxFailures} onChange={(e) => setMaxFailures(Number(e.target.value))} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Browser &amp; network</CardTitle>
            <CardDescription>Fresh session: empty cookies and storage for every run.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Browser profile" htmlFor="bp" hint={info.workerEngines.length ? `Engines on workers: ${info.workerEngines.join(", ")}` : undefined}>
              <NativeSelect id="bp" value={browserProfileId} onChange={(e) => setBrowserProfileId(e.target.value)}>
                <option value="">Default desktop (Chromium 1366×768)</option>
                {browsers.items.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {b.engine} {b.viewportWidth}×{b.viewportHeight}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Network" htmlFor="px">
              <NativeSelect id="px" value={proxyProfileId} onChange={(e) => setProxyProfileId(e.target.value)}>
                <option value="">Direct connection (no proxy)</option>
                {proxies.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.type} {p.host}:{p.port}
                    {p.regionLabel ? ` (${p.regionLabel})` : ""}
                    {p.lastTest ? (p.lastTest.ok ? " ✓" : " ✗ last test failed") : " (untested)"}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Session mode" htmlFor="sm" hint="Returning and authenticated sessions arrive in Phase 3.">
              <NativeSelect id="sm" value="FRESH_SESSION" disabled>
                <option value="FRESH_SESSION">Fresh session</option>
              </NativeSelect>
            </Field>
            <Checkbox label="Record Playwright trace for every run" checked={captureTrace} onChange={(e) => setCaptureTrace(e.target.checked)} />
          </CardContent>
        </Card>
      </div>
      <div className="mt-6 space-y-4">
        <ErrorAlert error={error} title="The batch was not started" />
        {dry && (
          <Alert variant={dry.valid ? "success" : "error"} title={dry.valid ? "Dry run passed — configuration is valid" : "Dry run found problems"}>
            {dry.valid ? (
              <p>
                {dry.plan.iterations} run(s) of v{dry.plan.scenarioVersion}, {dry.plan.concurrency} at a time on {dry.plan.engine}
                {dry.plan.proxy ? ` via ${dry.plan.proxy}` : ", direct connection"}. No browsers were launched.
              </p>
            ) : (
              <ul className="list-disc pl-4">
                {dry.issues.map((i, n) => (
                  <li key={n}>
                    <code className="text-xs">{i.path}</code> {i.message}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => submit(true)} loading={busy === "dry"} disabled={busy !== null}>
            <FlaskConical /> Dry run (validate only)
          </Button>
          <Button onClick={() => submit(false)} loading={busy === "run"} disabled={busy !== null}>
            <Play /> Start {iterations} run{iterations === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </>
  );
}
