"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Checkbox, Field, Input } from "./ui/input";
import { ErrorAlert } from "./ui/feedback";

/** Website URL → project + authorized website + starter scenario, in one step. */
export function QuickStart({ className }: { className?: string }) {
  const router = useRouter();
  const { data: info } = useApi<{ allowSelfAttested: boolean }>("/system/info");
  const [url, setUrl] = useState("");
  const [projectName, setProjectName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (info && !info.allowSelfAttested) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ project: { id: string }; scenarioId: string }>("/quick-start", {
        method: "POST",
        body: { url, projectName: projectName || undefined, attestation: confirmed },
      });
      router.push(`/projects/${r.project.id}/scenarios/${r.scenarioId}?welcome=1`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="size-4 text-primary" /> Quick start — test a website
        </CardTitle>
        <CardDescription>Paste a website address. We create the project and a first journey you can run or edit straight away.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Website address" htmlFor="qs-url">
              <Input id="qs-url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.example.com" inputMode="url" />
            </Field>
            <Field label="Project name (optional)" htmlFor="qs-name">
              <Input id="qs-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Uses the website name" />
            </Field>
          </div>
          <Checkbox
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            label="I own this website or have explicit permission to run automated tests on it. I understand this confirmation is recorded."
          />
          <ErrorAlert error={error} title="Could not set up the website" />
          <Button type="submit" loading={busy} disabled={!confirmed || !url.trim()}>
            Create project &amp; start testing
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
