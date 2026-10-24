"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Domain, Paginated } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Alert, ErrorAlert } from "@/components/ui/feedback";
import { ScenarioEditor, starterScenario, validateDraft, type ScenarioDraft } from "@/components/scenario-editor";
import { demoShopCheckout } from "@/lib/templates";

export default function NewScenarioPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { data: domains } = useApi<Paginated<Domain>>(`/domains?projectId=${projectId}&limit=100`);
  const verified = domains?.items.filter((d) => d.status === "VERIFIED") ?? [];
  const firstOrigin = verified[0] ? `${verified[0].scheme}://${verified[0].host}/` : "https://";
  const [draft, setDraft] = useState<ScenarioDraft | null>(null);
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const current = draft ?? starterScenario(firstOrigin);
  const demoDomain = verified.find((d) => ["localhost", "127.0.0.1", "demo-site"].includes(d.hostname));

  async function save() {
    const v = validateDraft(current);
    setIssues(v);
    if (v.length) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ scenario: { id: string } }>("/scenarios", {
        method: "POST",
        body: { projectId, name: current.name, description: current.description || undefined, definition: current.definition },
      });
      router.push(`/projects/${projectId}/scenarios/${res.scenario.id}`);
    } catch (err) {
      setError(err);
      if (err instanceof ApiError) setIssues(err.issues.map((i) => ({ ...i, path: i.path.replace(/^definition\./, "") })));
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New scenario"
        crumbs={[{ href: `/projects/${projectId}`, label: "Project" }, { href: `/projects/${projectId}/scenarios`, label: "Scenarios" }, { label: "New" }]}
        actions={
          <>
            {demoDomain && (
              <Button variant="outline" onClick={() => setDraft(demoShopCheckout(`${demoDomain.scheme}://${demoDomain.host}`))}>
                Load Demo Shop example
              </Button>
            )}
            <Button onClick={save} loading={saving}>
              Save scenario
            </Button>
          </>
        }
      />
      {domains && verified.length === 0 && (
        <Alert variant="warning" title="No verified domains" className="mb-4">
          Scenarios can only target verified domains. Authorize a website first.
        </Alert>
      )}
      <div className="mb-4">
        <ErrorAlert error={error} title="Could not save scenario" />
      </div>
      <ScenarioEditor draft={current} onChange={setDraft} issues={issues} />
    </>
  );
}
