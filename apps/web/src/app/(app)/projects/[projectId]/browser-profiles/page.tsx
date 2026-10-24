"use client";
import { useState } from "react";
import { useParams } from "next/navigation";
import { MonitorSmartphone, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { BrowserProfile, Paginated } from "@/lib/types";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Alert, EmptyState, ErrorAlert, Spinner } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

interface DeviceInfo {
  devices: Array<{ name: string; viewportWidth: number; viewportHeight: number; isMobile: boolean; defaultBrowserType: string }>;
  engines: string[];
}

export default function BrowserProfilesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, error, isLoading, mutate } = useApi<Paginated<BrowserProfile>>(`/browser-profiles?projectId=${projectId}&limit=100`);
  const { data: devices } = useApi<DeviceInfo>("/browser-profiles/devices");
  const [form, setForm] = useState({
    name: "",
    engine: "chromium",
    devicePreset: "",
    viewportWidth: 1366,
    viewportHeight: 768,
    locale: "en-US",
    timezone: "UTC",
    colorScheme: "light",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api("/browser-profiles", { method: "POST", body: { projectId, ...form, devicePreset: form.devicePreset || undefined } });
      set({ name: "" });
      void mutate();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this browser profile?")) return;
    await api(`/browser-profiles/${id}`, { method: "DELETE" }).catch((err) => setSaveError(err));
    void mutate();
  }

  const engines = devices?.engines ?? [];
  return (
    <>
      <PageHeader
        title="Browser profiles"
        description="Browser engine and device emulation applied to runs. Emulation changes viewport, user agent and touch support; it is not a real physical device."
        crumbs={[{ href: `/projects/${projectId}`, label: "Project" }, { label: "Browser profiles" }]}
      />
      {devices && engines.length > 0 && engines.length < 3 && (
        <Alert variant="info" className="mb-4">
          Workers currently have these engines installed: <strong>{engines.join(", ")}</strong>. Profiles for other engines can be saved but runs using them will be
          rejected until a worker with that browser is online.
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardContent className="p-0">
            {isLoading && <Spinner />}
            <ErrorAlert error={error} />
            {data?.items.length === 0 && (
              <div className="p-4">
                <EmptyState icon={MonitorSmartphone} title="No browser profiles" />
              </div>
            )}
            {data && data.items.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Engine</TH>
                    <TH>Viewport</TH>
                    <TH>Locale / timezone</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((b) => (
                    <TR key={b.id}>
                      <TD>
                        <p className="font-medium">{b.name}</p>
                        {b.devicePreset && <p className="text-xs text-muted-foreground">{b.devicePreset}</p>}
                      </TD>
                      <TD>
                        <Badge variant={engines.length === 0 || engines.includes(b.engine) ? "secondary" : "warning"}>{b.engine}</Badge>
                      </TD>
                      <TD className="tabular-nums">
                        {b.viewportWidth}×{b.viewportHeight} {b.isMobile && <Badge variant="info">mobile</Badge>}
                      </TD>
                      <TD className="text-xs">
                        {b.locale} · {b.timezone} · {b.colorScheme}
                      </TD>
                      <TD className="text-right">
                        <Button size="icon" variant="ghost" aria-label={`Delete ${b.name}`} onClick={() => remove(b.id)}>
                          <Trash2 />
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>New profile</CardTitle>
            <CardDescription>Pick a device preset or set a custom viewport.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-3">
              <Field label="Name" htmlFor="bname">
                <Input id="bname" required value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="iPhone 13 Safari" />
              </Field>
              <Field label="Device preset" htmlFor="preset">
                <NativeSelect
                  id="preset"
                  value={form.devicePreset}
                  onChange={(e) => {
                    const d = devices?.devices.find((x) => x.name === e.target.value);
                    set(d ? { devicePreset: d.name, engine: d.defaultBrowserType, viewportWidth: d.viewportWidth, viewportHeight: d.viewportHeight } : { devicePreset: "" });
                  }}
                >
                  <option value="">Custom desktop</option>
                  {devices?.devices.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name} ({d.viewportWidth}×{d.viewportHeight})
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Engine" htmlFor="engine">
                <NativeSelect id="engine" value={form.engine} onChange={(e) => set({ engine: e.target.value })}>
                  {["chromium", "firefox", "webkit"].map((e) => (
                    <option key={e} value={e}>
                      {e}
                      {engines.length > 0 && !engines.includes(e) ? " (not installed on workers)" : ""}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {!form.devicePreset && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Width" htmlFor="vw">
                    <Input id="vw" type="number" min={320} max={3840} value={form.viewportWidth} onChange={(e) => set({ viewportWidth: Number(e.target.value) })} />
                  </Field>
                  <Field label="Height" htmlFor="vh">
                    <Input id="vh" type="number" min={320} max={2160} value={form.viewportHeight} onChange={(e) => set({ viewportHeight: Number(e.target.value) })} />
                  </Field>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Locale" htmlFor="loc">
                  <Input id="loc" value={form.locale} onChange={(e) => set({ locale: e.target.value })} />
                </Field>
                <Field label="Timezone" htmlFor="tz">
                  <Input id="tz" value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} placeholder="Europe/Berlin" />
                </Field>
              </div>
              <Field label="Color scheme" htmlFor="cs">
                <NativeSelect id="cs" value={form.colorScheme} onChange={(e) => set({ colorScheme: e.target.value })}>
                  <option value="light">light</option>
                  <option value="dark">dark</option>
                  <option value="no-preference">no preference</option>
                </NativeSelect>
              </Field>
              <ErrorAlert error={saveError} title="Could not save" />
              <Button type="submit" className="w-full" loading={saving}>
                Create profile
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
