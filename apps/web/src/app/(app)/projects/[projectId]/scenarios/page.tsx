"use client";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { ListChecks, Play, Plus, Search } from "lucide-react";
import { useApi } from "@/lib/hooks";
import type { Paginated, ScenarioListItem } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorAlert, Spinner } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { relativeTime } from "@/lib/utils";

export default function ScenarioLibrary() {
  const { projectId } = useParams<{ projectId: string }>();
  const [search, setSearch] = useState("");
  const qs = new URLSearchParams({ projectId, limit: "100", ...(search ? { search } : {}) });
  const { data, error, isLoading } = useApi<Paginated<ScenarioListItem>>(`/scenarios?${qs}`);
  const base = `/projects/${projectId}`;

  return (
    <>
      <PageHeader
        title="Scenario library"
        description="Saved, versioned user journeys."
        crumbs={[{ href: base, label: "Project" }, { label: "Scenarios" }]}
        actions={
          <Button asChild>
            <Link href={`${base}/scenarios/new`}>
              <Plus /> New scenario
            </Link>
          </Button>
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search scenarios" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search scenarios" />
      </div>
      <ErrorAlert error={error} />
      {isLoading && <Spinner />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={ListChecks}
          title={search ? "No matching scenarios" : "No scenarios yet"}
          description="A scenario is a sequence of steps such as navigate, click, type and assert."
          action={
            <Button asChild>
              <Link href={`${base}/scenarios/new`}>Create a scenario</Link>
            </Button>
          }
        />
      )}
      {data && data.items.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Start URL</TH>
                  <TH>Steps</TH>
                  <TH>Version</TH>
                  <TH>Last run</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {data.items.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <Link href={`${base}/scenarios/${s.id}`} className="font-medium hover:underline">
                        {s.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">Updated {relativeTime(s.updatedAt)}</p>
                    </TD>
                    <TD className="max-w-56 truncate font-mono text-xs">{s.startUrl}</TD>
                    <TD>{s.stepCount}</TD>
                    <TD>v{s.latestVersion}</TD>
                    <TD>
                      {s.lastBatch ? (
                        <Link href={`${base}/batches/${s.lastBatch.id}`}>
                          <StatusBadge status={s.lastBatch.status} />
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">never</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`${base}/scenarios/${s.id}/run`}>
                          <Play /> Run
                        </Link>
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
