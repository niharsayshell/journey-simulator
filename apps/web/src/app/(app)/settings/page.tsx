"use client";
import { useApi } from "@/lib/hooks";
import { PageHeader } from "@/components/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert, NotImplemented, Spinner } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/auth";

interface SystemInfo {
  limits: Record<string, number>;
  workerEngines: string[];
  privateHostAllowlist: string[];
  features: { stepTypes: string[]; plannedStepTypes: string[]; sessionModes: string[] };
}

const LIMIT_LABELS: Record<string, string> = {
  maxIterationsPerBatch: "Iterations per batch",
  maxConcurrencyPerBatch: "Parallel browsers per batch",
  maxActiveBatchesPerProject: "Active batches per project",
  maxActiveRunsPerDomain: "Active runs per domain",
  maxActiveRunsSystem: "Active runs system-wide",
  minLaunchDelayMs: "Minimum delay between launches (ms)",
};

export default function AppSettings() {
  const { user } = useAuth();
  const { data, error } = useApi<SystemInfo>("/system/info", { refreshInterval: 15000 });
  return (
    <>
      <PageHeader title="Application settings" description={`Signed in as ${user.email}${user.isAdmin ? " (platform administrator)" : ""}`} />
      <ErrorAlert error={error} />
      {!data && !error && <Spinner />}
      {data && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Platform limits</CardTitle>
              <CardDescription>Set by an administrator through environment variables. Users cannot exceed them.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {Object.entries(data.limits).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{LIMIT_LABELS[k] ?? k}</dt>
                    <dd className="font-medium tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Workers &amp; network policy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">Browser engines on online workers</p>
                <div className="mt-1 flex gap-1">
                  {data.workerEngines.length ? data.workerEngines.map((e) => <Badge key={e}>{e}</Badge>) : <Badge variant="warning">no workers online</Badge>}
                </div>
              </div>
              <div>
                <p className="text-muted-foreground">Private hosts allowed (development)</p>
                <p className="font-mono text-xs">{data.privateHostAllowlist.join(", ") || "none"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Supported step types</p>
                <p className="text-xs">{data.features.stepTypes.join(", ")}</p>
                <p className="mt-1 text-xs text-muted-foreground">Planned: {data.features.plannedStepTypes.join(", ")}</p>
              </div>
            </CardContent>
          </Card>
          <div className="md:col-span-2">
            <NotImplemented feature="Team management, role assignment UI and scheduled executions" phase="Phase 6 (production features)" />
          </div>
        </div>
      )}
    </>
  );
}
