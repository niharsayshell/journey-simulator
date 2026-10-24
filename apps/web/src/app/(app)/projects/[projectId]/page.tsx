"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Circle, ListChecks, Network, ShieldCheck } from "lucide-react";
import { useApi } from "@/lib/hooks";
import type { Batch, Domain, Paginated, Project, ProxyProfile, ScenarioListItem } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert, Spinner } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { relativeTime } from "@/lib/utils";

export default function ProjectOverview() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: p, error } = useApi<{ project: Project }>(`/projects/${projectId}`);
  const { data: domains } = useApi<Paginated<Domain>>(`/domains?projectId=${projectId}&limit=100`);
  const { data: scenarios } = useApi<Paginated<ScenarioListItem>>(`/scenarios?projectId=${projectId}&limit=100`);
  const { data: proxies } = useApi<Paginated<ProxyProfile>>(`/proxy-profiles?projectId=${projectId}&limit=100`);
  const { data: batches } = useApi<Paginated<Batch>>(`/batches?projectId=${projectId}&limit=10`, { refreshInterval: 4000 });

  if (error) return <ErrorAlert error={error} />;
  if (!p) return <Spinner />;
  const base = `/projects/${projectId}`;
  const verified = domains?.items.filter((d) => (d.status === "VERIFIED" || d.status === "ATTESTED")).length ?? 0;
  const steps = [
    { done: verified > 0, label: "Authorize a website", href: `${base}/domains`, icon: ShieldCheck },
    { done: (scenarios?.items.length ?? 0) > 0, label: "Create a scenario", href: `${base}/scenarios/new`, icon: ListChecks },
    { done: (batches?.items.length ?? 0) > 0, label: "Run it", href: `${base}/scenarios`, icon: ListChecks },
    { done: (proxies?.items.length ?? 0) > 0, label: "Optional: add a proxy profile", href: `${base}/proxies`, icon: Network },
  ];

  return (
    <>
      <PageHeader title={p.project.name} description={p.project.description ?? "Project overview"} crumbs={[{ href: "/projects", label: "Projects" }, { label: p.project.name }]} />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent executions</CardTitle>
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/batches`}>View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0">
            {!batches && <Spinner />}
            {batches && batches.items.length === 0 && <p className="px-5 text-sm text-muted-foreground">No executions yet.</p>}
            {batches && batches.items.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>Scenario</TH>
                    <TH>Status</TH>
                    <TH>Passed</TH>
                    <TH>Started</TH>
                  </TR>
                </THead>
                <TBody>
                  {batches.items.map((b) => (
                    <TR key={b.id}>
                      <TD>
                        <Link className="font-medium hover:underline" href={`${base}/batches/${b.id}`}>
                          {b.scenario.name}
                        </Link>
                        <span className="text-xs text-muted-foreground"> v{b.scenarioVersion.version}</span>
                      </TD>
                      <TD>
                        <StatusBadge status={b.status} />
                      </TD>
                      <TD>
                        {b.counts?.passed ?? 0}/{b.counts?.total ?? b.iterations}
                      </TD>
                      <TD className="text-muted-foreground">{relativeTime(b.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Setup checklist</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-2">
                  {s.done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}
                  <Link href={s.href} className={s.done ? "text-muted-foreground line-through" : "hover:underline"}>
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
