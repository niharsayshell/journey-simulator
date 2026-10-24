"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { Copy, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { Domain, Paginated } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input, NativeSelect } from "@/components/ui/input";
import { Alert, EmptyState, ErrorAlert, Spinner } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/status";
import { formatDate } from "@/lib/utils";

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{value}</code>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Copy />
      </Button>
      {copied && <span className="text-xs text-muted-foreground">Copied</span>}
    </div>
  );
}

function DomainCard({ d, onChange }: { d: Domain; onChange: () => void }) {
  const [busy, setBusy] = useState<"verify" | "delete" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  async function verify() {
    setBusy("verify");
    setError(null);
    try {
      const r = await api<{ result: { ok: boolean; detail: string } }>(`/domains/${d.id}/verify`, { method: "POST" });
      setResult(r.result);
      onChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!confirm(`Remove ${d.host}? Scenarios targeting it will stop running.`)) return;
    setBusy("delete");
    try {
      await api(`/domains/${d.id}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="truncate">{d.host}</span> <StatusBadge status={d.status} />
          </CardTitle>
          <CardDescription className="mt-1">
            {d.allowSubdomains ? "Includes subdomains · " : ""}
            {d.method === "DNS_TXT" ? "DNS TXT record" : "Hosted verification file"}
            {d.verifiedAt ? ` · verified ${formatDate(d.verifiedAt)}` : ""}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={d.status === "VERIFIED" ? "outline" : "default"} onClick={verify} loading={busy === "verify"}>
            <RefreshCw /> {d.status === "VERIFIED" ? "Re-check" : "Verify now"}
          </Button>
          <Button size="icon" variant="ghost" onClick={remove} disabled={busy !== null} aria-label={`Remove ${d.host}`}>
            <Trash2 />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {d.status !== "VERIFIED" &&
          (d.method === "DNS_TXT" ? (
            <div className="space-y-2">
              <p>
                Add a <strong>TXT</strong> record named:
              </p>
              <CopyValue value={d.instructions.dns.name} />
              <p>with the value:</p>
              <CopyValue value={d.instructions.dns.value} />
            </div>
          ) : (
            <div className="space-y-2">
              <p>Publish a plain-text file at:</p>
              <CopyValue value={d.instructions.file.url} />
              <p>containing exactly:</p>
              <CopyValue value={d.instructions.file.contents} />
              {(["localhost", "demo-site"].includes(d.hostname) || d.hostname.startsWith("demo.")) && (
                <p className="text-xs text-muted-foreground">
                  Using the bundled Demo Shop? Open{" "}
                  <a className="underline" href={d.hostname.startsWith("demo.") ? `${d.scheme}://${d.host}/owner` : `http://localhost:${d.port ?? 4100}/owner`} target="_blank" rel="noreferrer">
                    its owner page
                  </a>{" "}
                  and paste the value to publish it.
                </p>
              )}
            </div>
          ))}
        {result && (
          <Alert variant={result.ok ? "success" : "error"} title={result.ok ? "Verified" : "Verification failed"}>
            {result.detail}
          </Alert>
        )}
        {!result && d.lastCheckError && d.status !== "VERIFIED" && <Alert variant="warning" title="Last check failed">{d.lastCheckError}</Alert>}
        <ErrorAlert error={error} />
      </CardContent>
    </Card>
  );
}

export default function DomainsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, error, isLoading, mutate } = useApi<Paginated<Domain>>(`/domains?projectId=${projectId}&limit=100`);
  const [host, setHost] = useState("");
  const [method, setMethod] = useState<"HTTP_FILE" | "DNS_TXT">("HTTP_FILE");
  const [scheme, setScheme] = useState<"https" | "http">("https");
  const [allowSubdomains, setAllowSubdomains] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api("/domains", { method: "POST", body: { projectId, host: host.trim(), method, scheme, allowSubdomains } });
      setHost("");
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
        title="Website authorization"
        description="Only verified domains can be used as automation targets. Navigation to any other host is blocked during runs."
        crumbs={[{ href: `/projects/${projectId}`, label: "Project" }, { label: "Website authorization" }]}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {isLoading && <Spinner />}
          <ErrorAlert error={error} />
          {data?.items.length === 0 && (
            <EmptyState icon={ShieldCheck} title="No domains yet" description="Add a website you own or have explicit permission to test, then verify ownership." />
          )}
          {data?.items.map((d) => <DomainCard key={d.id} d={d} onChange={() => void mutate()} />)}
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Add a website</CardTitle>
            <CardDescription>For the bundled demo, use host <code>localhost:4100</code> with scheme http.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="space-y-4">
              <Field label="Host" htmlFor="host" hint="Hostname with optional port. No scheme or path.">
                <Input id="host" required value={host} onChange={(e) => setHost(e.target.value)} placeholder="shop.example.com" />
              </Field>
              <Field label="Verification method" htmlFor="method">
                <NativeSelect id="method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                  <option value="HTTP_FILE">Hosted file (/.well-known/…)</option>
                  <option value="DNS_TXT">DNS TXT record</option>
                </NativeSelect>
              </Field>
              {method === "HTTP_FILE" && (
                <Field label="Scheme" htmlFor="scheme">
                  <NativeSelect id="scheme" value={scheme} onChange={(e) => setScheme(e.target.value as typeof scheme)}>
                    <option value="https">https</option>
                    <option value="http">http</option>
                  </NativeSelect>
                </Field>
              )}
              <Checkbox label="Also authorize subdomains" checked={allowSubdomains} onChange={(e) => setAllowSubdomains(e.target.checked)} />
              <p className="text-xs text-muted-foreground">
                By adding a domain you confirm you own it or have explicit permission to run automated tests against it.
              </p>
              <ErrorAlert error={saveError} title="Could not add domain" />
              <Button type="submit" loading={saving} className="w-full">
                Add website
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
