"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Project } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { Alert, ErrorAlert, Spinner } from "@/components/ui/feedback";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

interface AuditRow {
  id: string;
  action: string;
  targetType: string | null;
  createdAt: string;
  user: { email: string } | null;
  metadata: unknown;
}

export default function ProjectSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, error, mutate } = useApi<{ project: Project }>(`/projects/${projectId}`);
  const canAdmin = data && ["OWNER", "ADMIN"].includes(data.project.role);
  const { data: audit } = useApi<{ items: AuditRow[] }>(canAdmin ? `/projects/${projectId}/audit-logs?limit=50` : null);
  const [form, setForm] = useState<{ testHeaderEnabled: boolean; testHeaderName: string; testHeaderValue: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && !form) setForm({ testHeaderEnabled: data.project.testHeaderEnabled, testHeaderName: data.project.testHeaderName, testHeaderValue: data.project.testHeaderValue });
  }, [data, form]);

  if (error) return <ErrorAlert error={error} />;
  if (!data || !form) return <Spinner />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await api(`/projects/${projectId}/settings`, { method: "PATCH", body: form });
      setSaved(true);
      void mutate();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Project settings" crumbs={[{ href: `/projects/${projectId}`, label: "Project" }, { label: "Settings" }]} />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Analytics isolation</CardTitle>
            <CardDescription>
              Adds a request header to every request sent to your authorized domains (never to third parties), so your analytics and ad tags can exclude
              synthetic traffic. Configure your analytics to drop hits carrying this header or point tests at a staging environment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-4">
              <Checkbox label="Send the test identification header" checked={form.testHeaderEnabled} onChange={(e) => setForm({ ...form, testHeaderEnabled: e.target.checked })} disabled={!canAdmin} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Header name" htmlFor="hn">
                  <Input id="hn" value={form.testHeaderName} onChange={(e) => setForm({ ...form, testHeaderName: e.target.value })} disabled={!canAdmin} />
                </Field>
                <Field label="Header value" htmlFor="hv">
                  <Input id="hv" value={form.testHeaderValue} onChange={(e) => setForm({ ...form, testHeaderValue: e.target.value })} disabled={!canAdmin} />
                </Field>
              </div>
              {!canAdmin && <Alert variant="info">Only project owners and admins can change settings.</Alert>}
              {saved && <Alert variant="success">Settings saved. New batches will use them.</Alert>}
              <ErrorAlert error={saveError} />
              <Button type="submit" loading={saving} disabled={!canAdmin}>
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Artifact retention</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Screenshots and traces are stamped with an expiry of {data.project.artifactRetentionDays} days. The automatic clean-up job and an editable
            retention period arrive in Phase 6.
          </CardContent>
        </Card>
        {canAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Audit log</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!audit && <Spinner />}
              {audit && (
                <Table>
                  <THead>
                    <TR>
                      <TH>When</TH>
                      <TH>Who</TH>
                      <TH>Action</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {audit.items.map((a) => (
                      <TR key={a.id}>
                        <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(a.createdAt)}</TD>
                        <TD className="text-xs">{a.user?.email ?? "system"}</TD>
                        <TD>
                          <code className="text-xs">{a.action}</code>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
