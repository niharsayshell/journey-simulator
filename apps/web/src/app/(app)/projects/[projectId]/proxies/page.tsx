"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Network, Pencil, PlugZap, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Paginated, ProxyProfile } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, NativeSelect } from "@/components/ui/input";
import { Alert, EmptyState, ErrorAlert, Spinner } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface TestResult {
  ok: boolean;
  egressIp?: string;
  latencyMs?: number;
  error?: string;
  errorCategory?: string;
  checkedUrl: string;
}

const EMPTY = { name: "", type: "HTTP", host: "", port: "8080", username: "", password: "", regionLabel: "" };

function ProxyCard({ p, onChange, onEdit }: { p: ProxyProfile; onChange: () => void; onEdit: () => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function test() {
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<{ result: TestResult }>(`/proxy-profiles/${p.id}/test`, { method: "POST" });
      setResult(r.result);
      onChange();
    } catch (err) {
      setError(err);
    } finally {
      setTesting(false);
    }
  }
  async function remove() {
    if (!confirm(`Delete proxy profile "${p.name}"?`)) return;
    try {
      await api(`/proxy-profiles/${p.id}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {p.name}
            <Badge variant="secondary">{p.type}</Badge>
            {p.regionLabel && <Badge variant="info">{p.regionLabel}</Badge>}
            {p.lastTest && <Badge variant={p.lastTest.ok ? "success" : "destructive"}>{p.lastTest.ok ? "reachable" : "failed"}</Badge>}
          </CardTitle>
          <CardDescription className="mt-1 font-mono">
            {p.host}:{p.port} {p.hasCredentials && <span className="font-sans">· credentials stored (encrypted)</span>}
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="outline" onClick={test} loading={testing}>
            <PlugZap /> Test
          </Button>
          <Button size="icon" variant="ghost" aria-label="Edit" onClick={onEdit}>
            <Pencil />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Delete" onClick={remove}>
            <Trash2 />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {p.lastTest && !result && (
          <p className="text-xs text-muted-foreground">
            Last test {formatDate(p.lastTest.at)}:{" "}
            {p.lastTest.ok ? `observed egress IP ${p.lastTest.egressIp ?? "unknown"} · ${p.lastTest.latencyMs} ms` : p.lastTest.error}
          </p>
        )}
        {result && (
          <Alert variant={result.ok ? "success" : "error"} title={result.ok ? "Proxy works" : `Proxy test failed${result.errorCategory ? ` (${result.errorCategory.toLowerCase()})` : ""}`}>
            {result.ok ? (
              <p>
                Observed egress IP <strong>{result.egressIp ?? "not reported"}</strong> in {result.latencyMs} ms via {result.checkedUrl}.
                {p.regionLabel && <> The region label “{p.regionLabel}” is what you entered; it is not verified by this check.</>}
              </p>
            ) : (
              <p>{result.error}</p>
            )}
          </Alert>
        )}
        <ErrorAlert error={error} />
      </CardContent>
    </Card>
  );
}

export default function ProxiesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, error, isLoading, mutate } = useApi<Paginated<ProxyProfile>>(`/proxy-profiles?projectId=${projectId}&limit=100`);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<ProxyProfile | null>(null);
  const [clearCreds, setClearCreds] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    const body: Record<string, unknown> = {
      name: form.name,
      type: form.type,
      host: form.host.trim(),
      port: Number(form.port),
      regionLabel: form.regionLabel,
    };
    if (form.username || form.password) {
      body.username = form.username;
      body.password = form.password;
    }
    try {
      if (editing) await api(`/proxy-profiles/${editing.id}`, { method: "PATCH", body: { ...body, clearCredentials: clearCreds || undefined } });
      else await api("/proxy-profiles", { method: "POST", body: { projectId, ...body } });
      setForm(EMPTY);
      setEditing(null);
      setClearCreds(false);
      void mutate();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Proxy profiles"
        description="Named network routes for regional QA. Credentials are encrypted at rest and never returned by the API."
        crumbs={[{ href: `/projects/${projectId}`, label: "Project" }, { label: "Proxy profiles" }]}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {isLoading && <Spinner />}
          <ErrorAlert error={error} />
          {data?.items.length === 0 && (
            <EmptyState
              icon={Network}
              title="No proxy profiles"
              description={
                <>
                  Runs use a direct connection unless you pick a proxy. For a local try-out, start the bundled test proxy with <code>pnpm dev:proxy</code> and add host{" "}
                  <code>127.0.0.1</code>, port <code>8899</code>.
                </>
              }
            />
          )}
          {data?.items.map((p) => (
            <ProxyCard
              key={p.id}
              p={p}
              onChange={() => void mutate()}
              onEdit={() => {
                setEditing(p);
                setForm({ name: p.name, type: p.type, host: p.host, port: String(p.port), username: "", password: "", regionLabel: p.regionLabel ?? "" });
              }}
            />
          ))}
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{editing ? `Edit “${editing.name}”` : "New proxy profile"}</CardTitle>
            <CardDescription>Use proxies you are entitled to use, for regional QA of your own sites.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-3">
              <Field label="Name" htmlFor="pxname">
                <Input id="pxname" required value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="EU QA gateway" />
              </Field>
              <Field label="Type" htmlFor="pxtype">
                <NativeSelect id="pxtype" value={form.type} onChange={(e) => set({ type: e.target.value })}>
                  <option value="HTTP">HTTP</option>
                  <option value="HTTPS">HTTPS</option>
                  <option value="SOCKS5">SOCKS5 (no authentication in Chromium)</option>
                </NativeSelect>
              </Field>
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <Field label="Host" htmlFor="pxhost">
                  <Input id="pxhost" required value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="proxy.example.net" />
                </Field>
                <Field label="Port" htmlFor="pxport">
                  <Input id="pxport" required type="number" min={1} max={65535} value={form.port} onChange={(e) => set({ port: e.target.value })} />
                </Field>
              </div>
              <Field label="Region label" htmlFor="pxregion" hint="Your own label, e.g. “Frankfurt”. Reports show it next to the observed egress IP.">
                <Input id="pxregion" value={form.regionLabel} onChange={(e) => set({ regionLabel: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Username" htmlFor="pxuser">
                  <Input id="pxuser" autoComplete="off" value={form.username} onChange={(e) => set({ username: e.target.value })} />
                </Field>
                <Field label="Password" htmlFor="pxpass">
                  <Input id="pxpass" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} />
                </Field>
              </div>
              {editing?.hasCredentials && (
                <>
                  <p className="text-xs text-muted-foreground">Stored credentials are kept unless you enter new ones.</p>
                  <Checkbox label="Remove stored credentials" checked={clearCreds} onChange={(e) => setClearCreds(e.target.checked)} />
                </>
              )}
              <ErrorAlert error={saveError} title="Could not save" />
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" loading={saving}>
                  {editing ? "Save changes" : "Add proxy"}
                </Button>
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditing(null);
                      setForm(EMPTY);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
