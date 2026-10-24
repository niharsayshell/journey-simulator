"use client";
import Link from "next/link";
import { FolderKanban, ListChecks, Plus, ShieldCheck, PlayCircle } from "lucide-react";
import { useApi } from "@/lib/hooks";
import type { Batch, Paginated, Project } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorAlert, Skeleton } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/status";
import { relativeTime } from "@/lib/utils";
import { useAuth } from "@/components/auth";
import { QuickStart } from "@/components/quick-start";

function RecentBatches({ project }: { project: Project }) {
  const { data } = useApi<Paginated<Batch>>(`/batches?projectId=${project.id}&limit=5`, { refreshInterval: 5000 });
  if (!data) return <Skeleton className="h-16" />;
  if (data.items.length === 0) return <p className="text-sm text-muted-foreground">No executions yet.</p>;
  return (
    <ul className="divide-y text-sm">
      {data.items.map((b) => (
        <li key={b.id} className="flex items-center justify-between gap-2 py-2">
          <Link href={`/projects/${project.id}/batches/${b.id}`} className="min-w-0 truncate hover:underline">
            {b.scenario.name} <span className="text-muted-foreground">· {b.iterations}×</span>
          </Link>
          <span className="flex shrink-0 items-center gap-2">
            {b.counts && (
              <span className="text-xs text-muted-foreground">
                {b.counts.passed}/{b.counts.total} passed
              </span>
            )}
            <StatusBadge status={b.status} />
            <span className="w-16 text-right text-xs text-muted-foreground">{relativeTime(b.createdAt)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, error, isLoading } = useApi<Paginated<Project>>("/projects?limit=50");

  return (
    <>
      <PageHeader
        title={`Welcome${user.name ? `, ${user.name}` : ""}`}
        description="Overview of your projects and recent executions."
        actions={
          <Button asChild>
            <Link href="/projects">
              <Plus /> New project
            </Link>
          </Button>
        }
      />
      <QuickStart className="mb-6" />
      <ErrorAlert error={error} />
      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      )}
      {data && data.items.length === 0 && (
        <div className="space-y-6">
          <EmptyState
            icon={FolderKanban}
            title="Or create an empty project"
            description="A project groups the websites you are authorized to test, your scenarios and their execution history."
            action={
              <Button asChild>
                <Link href="/projects">Create a project</Link>
              </Button>
            }
          />
          <Card>
            <CardHeader>
              <CardTitle>How it works</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
              <div className="flex gap-3">
                <ShieldCheck className="size-5 shrink-0 text-primary" />
                <div>
                  <p className="font-medium">1. Add a website</p>
                  <p className="text-muted-foreground">Paste its address above and confirm you may test it. Optionally prove ownership with DNS or a hosted file.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <ListChecks className="size-5 shrink-0 text-primary" />
                <div>
                  <p className="font-medium">2. Build a scenario</p>
                  <p className="text-muted-foreground">Navigate, click, type, scroll and assert — no code required.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <PlayCircle className="size-5 shrink-0 text-primary" />
                <div>
                  <p className="font-medium">3. Run it repeatedly</p>
                  <p className="text-muted-foreground">Choose iterations, parallelism, browser and proxy, then watch results live.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      {data && data.items.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.items.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate">
                      <Link href={`/projects/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {p._count?.domains ?? 0} verified domains · {p._count?.scenarios ?? 0} scenarios · {p._count?.batches ?? 0} executions
                    </CardDescription>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/projects/${p.id}`}>Open</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <RecentBatches project={p} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
