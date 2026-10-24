"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Globe } from "lucide-react";
import { useApi, useProjectEvents } from "@/lib/hooks";
import type { Batch, Paginated } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorAlert, Spinner } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

export default function BatchHistory() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, error, isLoading, mutate } = useApi<Paginated<Batch>>(`/batches?projectId=${projectId}&limit=100`, { refreshInterval: 10000 });
  useProjectEvents(projectId, (type) => type === "batch.updated" && void mutate());
  const base = `/projects/${projectId}`;

  return (
    <>
      <PageHeader title="Executions" description="Every batch of repeated runs, newest first. Updates live." crumbs={[{ href: base, label: "Project" }, { label: "Executions" }]} />
      <ErrorAlert error={error} />
      {isLoading && <Spinner />}
      {data?.items.length === 0 && <EmptyState icon={Globe} title="No executions yet" description="Open a scenario and press Run." />}
      {data && data.items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Scenario</TH>
                  <TH>Status</TH>
                  <TH>Progress</TH>
                  <TH>Browser / network</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <TBody>
                {data.items.map((b) => {
                  const c = b.counts;
                  return (
                    <TR key={b.id}>
                      <TD>
                        <Link href={`${base}/batches/${b.id}`} className="font-medium hover:underline">
                          {b.scenario.name}
                        </Link>
                        <span className="text-xs text-muted-foreground"> v{b.scenarioVersion.version}</span>
                      </TD>
                      <TD>
                        <StatusBadge status={b.status} />
                      </TD>
                      <TD className="text-xs">
                        {c ? (
                          <>
                            <span className="text-emerald-700">{c.passed} passed</span> · <span className="text-red-700">{c.failed} failed</span>
                            {c.cancelled > 0 && <> · {c.cancelled} cancelled</>} · {c.running + c.queued} pending / {c.total}
                          </>
                        ) : (
                          `${b.iterations} runs`
                        )}
                      </TD>
                      <TD className="text-xs text-muted-foreground">
                        {b.configSnapshot.browserProfile?.name ?? "Default desktop"} · {b.configSnapshot.proxy?.name ?? "Direct"}
                      </TD>
                      <TD className="text-xs text-muted-foreground">{formatDate(b.createdAt)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
