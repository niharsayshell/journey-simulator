"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Archive, History, Play } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { ScenarioDetail } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Alert, ErrorAlert, Spinner } from "@/components/ui/feedback";
import { ScenarioEditor, validateDraft, type ScenarioDraft } from "@/components/scenario-editor";
import { formatDate } from "@/lib/utils";

export default function ScenarioPage() {
  const { projectId, scenarioId } = useParams<{ projectId: string; scenarioId: string }>();
  const router = useRouter();
  const welcome = useSearchParams().get("welcome") === "1";
  const { data, error, mutate } = useApi<ScenarioDetail>(`/scenarios/${scenarioId}`, { revalidateOnFocus: false });
  const [draft, setDraft] = useState<ScenarioDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && !draft) {
      setDraft({ name: data.scenario.name, description: data.scenario.description ?? "", definition: data.scenario.definition });
    }
  }, [data, draft]);

  if (error) return <ErrorAlert error={error} />;
  if (!data || !draft) return <Spinner />;

  async function save() {
    const v = validateDraft(draft!);
    setIssues(v);
    setSaved(null);
    if (v.length) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api<{ scenario: { latestVersion: number } }>(`/scenarios/${scenarioId}`, {
        method: "PUT",
        body: { name: draft!.name, description: draft!.description, definition: draft!.definition, changeNote: changeNote || undefined },
      });
      setSaved(`Saved as version ${res.scenario.latestVersion}`);
      setDirty(false);
      setChangeNote("");
      await mutate();
    } catch (err) {
      setSaveError(err);
      if (err instanceof ApiError) setIssues(err.issues.map((i) => ({ ...i, path: i.path.replace(/^definition\./, "") })));
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!confirm("Archive this scenario? Its execution history is kept.")) return;
    await api(`/scenarios/${scenarioId}`, { method: "DELETE" });
    router.push(`/projects/${projectId}/scenarios`);
  }

  return (
    <>
      <PageHeader
        title={data.scenario.name}
        description={`Version ${data.scenario.latestVersion} · updated ${formatDate(data.scenario.updatedAt)}`}
        crumbs={[{ href: `/projects/${projectId}`, label: "Project" }, { href: `/projects/${projectId}/scenarios`, label: "Scenarios" }, { label: data.scenario.name }]}
        actions={
          <>
            <Button variant="ghost" onClick={archive}>
              <Archive /> Archive
            </Button>
            <Button variant="outline" asChild disabled={dirty}>
              <Link href={`/projects/${projectId}/scenarios/${scenarioId}/run`} aria-disabled={dirty} onClick={(e) => dirty && e.preventDefault()}>
                <Play /> Run
              </Link>
            </Button>
            <Button onClick={save} loading={saving} disabled={!dirty}>
              Save new version
            </Button>
          </>
        }
      />
      <div className="mb-4 space-y-3">
        {welcome && !dirty && (
          <Alert variant="success" title="Your website is ready to test">
            We created this starter journey: open the page, pause, scroll and take a screenshot. Press <strong>Run</strong> to try it now, or add clicks,
            typing and checks below and save a new version.
          </Alert>
        )}
        {dirty && <Alert variant="warning">You have unsaved changes. Save them to run the new version.</Alert>}
        {saved && <Alert variant="success">{saved}</Alert>}
        <ErrorAlert error={saveError} title="Could not save" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_260px]">
        <ScenarioEditor
          draft={draft}
          onChange={(d) => {
            setDraft(d);
            setDirty(true);
            setSaved(null);
          }}
          issues={issues}
        />
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Change note</CardTitle>
            </CardHeader>
            <CardContent>
              <Field label="Describe this change" htmlFor="note">
                <Input id="note" maxLength={500} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="Optional" />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4" /> Versions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {data.versions.map((v) => (
                  <li key={v.version}>
                    <span className="font-medium">v{v.version}</span> <span className="text-xs text-muted-foreground">{formatDate(v.createdAt)}</span>
                    {v.changeNote && <p className="text-xs text-muted-foreground">{v.changeNote}</p>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
