"use client";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotImplemented } from "@/components/ui/feedback";

export default function SessionProfilesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <>
      <PageHeader
        title="Session profiles"
        description="Control the browser state each run starts with."
        crumbs={[{ href: `/projects/${projectId}`, label: "Project" }, { label: "Session profiles" }]}
      />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Fresh session — available</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Every run starts in a new, isolated browser with empty cookies and local storage. This is the default for all executions today. A fresh browser
            context is not a unique real user or physical device.
          </CardContent>
        </Card>
        <NotImplemented feature="Returning sessions, authenticated test accounts and multi-account allocation" phase="Phase 3 (repeated execution)" />
      </div>
    </>
  );
}
