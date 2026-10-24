"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import {
  ARIA_ROLES,
  IMPLEMENTED_STEP_TYPES,
  LOCATOR_STRATEGIES,
  PLANNED_STEP_TYPES,
  scenarioDefinitionSchema,
  type Locator,
  type ScenarioDefinitionInput,
  type StepInput,
  type StepType,
} from "@js/shared";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Checkbox, Field, Input, NativeSelect, Textarea } from "./ui/input";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/feedback";
import { cn } from "@/lib/utils";

type AnyStep = StepInput & Record<string, unknown>;

const STEP_INFO: Record<StepType, { label: string; help: string }> = {
  NAVIGATE: { label: "Navigate", help: "Open a URL or path on an authorized domain" },
  WAIT: { label: "Wait", help: "Pause for a fixed or random time" },
  CLICK: { label: "Click", help: "Click an element" },
  SCROLL: { label: "Scroll", help: "Scroll the page or bring an element into view" },
  HOVER: { label: "Hover", help: "Move the mouse over an element" },
  TYPE: { label: "Type text", help: "Fill a text field" },
  SELECT: { label: "Select option", help: "Choose an option in a dropdown" },
  ASSERT_VISIBLE: { label: "Assert visible", help: "Check an element is (or is not) visible" },
  ASSERT_TEXT: { label: "Assert text", help: "Check an element's text" },
  ASSERT_URL: { label: "Assert URL", help: "Check the current page URL" },
  SCREENSHOT: { label: "Screenshot", help: "Capture the page" },
};

const STRATEGY_LABEL: Record<(typeof LOCATOR_STRATEGIES)[number], string> = {
  role: "Accessible role (recommended)",
  label: "Form label",
  testId: "Test ID (data-testid)",
  text: "Visible text",
  placeholder: "Placeholder",
  css: "CSS selector (fragile)",
};

let idCounter = 0;
export function newStepId() {
  idCounter++;
  return `s${Date.now().toString(36)}${idCounter}`;
}

function defaultStep(type: StepType): AnyStep {
  const id = newStepId();
  const target: Locator = { strategy: "role", value: "button", name: "" };
  switch (type) {
    case "NAVIGATE":
      return { id, type, url: "/" };
    case "WAIT":
      return { id, type, durationMs: 1000 };
    case "CLICK":
    case "HOVER":
      return { id, type, target };
    case "SCROLL":
      return { id, type, deltaY: 800, steps: 4 };
    case "TYPE":
      return { id, type, target: { strategy: "label", value: "" }, text: "" };
    case "SELECT":
      return { id, type, target: { strategy: "label", value: "" }, option: "" };
    case "ASSERT_VISIBLE":
      return { id, type, target: { strategy: "role", value: "heading", name: "" } };
    case "ASSERT_TEXT":
      return { id, type, target: { strategy: "role", value: "heading", name: "" }, expected: "", match: "contains" };
    case "ASSERT_URL":
      return { id, type, expected: "/", match: "pathEquals" };
    case "SCREENSHOT":
      return { id, type, fullPage: false };
  }
}

function describeLocator(l?: Locator) {
  if (!l) return "";
  if (l.strategy === "role") return `${l.value}${l.name ? ` "${l.name}"` : ""}`;
  return `${l.strategy}: ${l.value}`;
}

function summary(s: AnyStep): string {
  const t = s.target as Locator | undefined;
  switch (s.type) {
    case "NAVIGATE":
      return String(s.url ?? "");
    case "WAIT":
      return s.randomMaxMs ? `${s.durationMs}–${s.randomMaxMs} ms` : `${s.durationMs} ms`;
    case "SCROLL":
      return t ? `to ${describeLocator(t)}` : `${s.deltaY}px`;
    case "TYPE":
      return `${describeLocator(t)} ← "${String(s.text ?? "").slice(0, 30)}"`;
    case "SELECT":
      return `${describeLocator(t)} = ${s.option}`;
    case "ASSERT_TEXT":
      return `${describeLocator(t)} ${s.match ?? "contains"} "${s.expected}"`;
    case "ASSERT_URL":
      return `${s.match ?? "contains"} ${s.expected}`;
    case "ASSERT_VISIBLE":
      return `${describeLocator(t)}${s.negate ? " is hidden" : " is visible"}`;
    case "SCREENSHOT":
      return s.fullPage ? "full page" : "viewport";
    default:
      return describeLocator(t);
  }
}

function num(v: string, fallback?: number) {
  if (v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function LocatorEditor({ value, onChange, idPrefix }: { value: Locator; onChange: (l: Locator) => void; idPrefix: string }) {
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
      <Field label="Find element by" htmlFor={`${idPrefix}-strategy`}>
        <NativeSelect
          id={`${idPrefix}-strategy`}
          value={value.strategy}
          onChange={(e) => {
            const strategy = e.target.value as Locator["strategy"];
            onChange({ strategy, value: strategy === "role" ? "button" : "", name: strategy === "role" ? "" : undefined });
          }}
        >
          {LOCATOR_STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {STRATEGY_LABEL[s]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {value.strategy === "role" ? (
        <Field label="Role" htmlFor={`${idPrefix}-role`}>
          <NativeSelect id={`${idPrefix}-role`} value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })}>
            {ARIA_ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </NativeSelect>
        </Field>
      ) : (
        <Field label={value.strategy === "css" ? "Selector" : "Value"} htmlFor={`${idPrefix}-value`}>
          <Input id={`${idPrefix}-value`} value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })} />
        </Field>
      )}
      {value.strategy === "role" && (
        <Field label="Accessible name" htmlFor={`${idPrefix}-name`} hint="The button/link text or aria-label.">
          <Input id={`${idPrefix}-name`} value={value.name ?? ""} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </Field>
      )}
      <Field label="Match # (optional)" htmlFor={`${idPrefix}-nth`} hint="0 = first match.">
        <Input
          id={`${idPrefix}-nth`}
          type="number"
          min={0}
          max={100}
          value={value.nth ?? ""}
          onChange={(e) => onChange({ ...value, nth: num(e.target.value) })}
        />
      </Field>
      {value.strategy !== "css" && value.strategy !== "testId" && (
        <Checkbox label="Exact match" checked={Boolean(value.exact)} onChange={(e) => onChange({ ...value, exact: e.target.checked || undefined })} />
      )}
    </div>
  );
}

function StepFields({ step, onChange }: { step: AnyStep; onChange: (s: AnyStep) => void }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...step, ...patch } as AnyStep);
  const p = step.id;
  const hasTarget = ["CLICK", "HOVER", "TYPE", "SELECT", "ASSERT_VISIBLE", "ASSERT_TEXT"].includes(step.type);
  return (
    <div className="space-y-4">
      <Field label="Label (optional)" htmlFor={`${p}-label`}>
        <Input id={`${p}-label`} value={(step.label as string) ?? ""} onChange={(e) => set({ label: e.target.value || undefined })} placeholder={STEP_INFO[step.type].label} />
      </Field>

      {step.type === "NAVIGATE" && (
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <Field label="URL or path" htmlFor={`${p}-url`} hint="Paths like /products are resolved against the start URL.">
            <Input id={`${p}-url`} value={String(step.url ?? "")} onChange={(e) => set({ url: e.target.value })} />
          </Field>
          <Field label="Wait until" htmlFor={`${p}-wu`}>
            <NativeSelect id={`${p}-wu`} value={String(step.waitUntil ?? "load")} onChange={(e) => set({ waitUntil: e.target.value })}>
              <option value="load">load</option>
              <option value="domcontentloaded">DOM content loaded</option>
              <option value="networkidle">network idle</option>
              <option value="commit">commit</option>
            </NativeSelect>
          </Field>
        </div>
      )}

      {step.type === "WAIT" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Duration (ms)" htmlFor={`${p}-dur`}>
            <Input id={`${p}-dur`} type="number" min={0} max={300000} value={String(step.durationMs ?? 0)} onChange={(e) => set({ durationMs: num(e.target.value, 0) })} />
          </Field>
          <Field label="Random up to (ms, optional)" htmlFor={`${p}-rnd`} hint="Waits a random time between the two values.">
            <Input id={`${p}-rnd`} type="number" min={0} max={300000} value={step.randomMaxMs === undefined ? "" : String(step.randomMaxMs)} onChange={(e) => set({ randomMaxMs: num(e.target.value) })} />
          </Field>
        </div>
      )}

      {step.type === "SCROLL" && (
        <>
          <Checkbox
            label="Scroll an element into view instead of by pixels"
            checked={Boolean(step.target)}
            onChange={(e) => set({ target: e.target.checked ? { strategy: "text", value: "" } : undefined })}
          />
          {!step.target && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Distance (px, negative = up)" htmlFor={`${p}-dy`}>
                <Input id={`${p}-dy`} type="number" value={String(step.deltaY ?? 800)} onChange={(e) => set({ deltaY: num(e.target.value, 0) })} />
              </Field>
              <Field label="Increments" htmlFor={`${p}-inc`} hint="Scroll gradually in this many steps.">
                <Input id={`${p}-inc`} type="number" min={1} max={50} value={String(step.steps ?? 1)} onChange={(e) => set({ steps: num(e.target.value, 1) })} />
              </Field>
            </div>
          )}
        </>
      )}

      {(hasTarget || (step.type === "SCROLL" && step.target)) && (
        <LocatorEditor idPrefix={`${p}-loc`} value={step.target as Locator} onChange={(target) => set({ target })} />
      )}

      {step.type === "CLICK" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Button" htmlFor={`${p}-btn`}>
            <NativeSelect id={`${p}-btn`} value={String(step.button ?? "left")} onChange={(e) => set({ button: e.target.value })}>
              <option value="left">left</option>
              <option value="right">right</option>
              <option value="middle">middle</option>
            </NativeSelect>
          </Field>
          <Field label="Click count" htmlFor={`${p}-cc`}>
            <Input id={`${p}-cc`} type="number" min={1} max={3} value={String(step.clickCount ?? 1)} onChange={(e) => set({ clickCount: num(e.target.value, 1) })} />
          </Field>
        </div>
      )}

      {step.type === "TYPE" && (
        <>
          <Field label="Text" htmlFor={`${p}-text`} hint="Use test data only — never real personal or payment details.">
            <Textarea id={`${p}-text`} rows={2} value={String(step.text ?? "")} onChange={(e) => set({ text: e.target.value })} />
          </Field>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Key delay (ms)" htmlFor={`${p}-kd`} className="w-40">
              <Input id={`${p}-kd`} type="number" min={0} max={1000} value={String(step.keyDelayMs ?? 0)} onChange={(e) => set({ keyDelayMs: num(e.target.value, 0) })} />
            </Field>
            <Checkbox label="Clear field first" checked={step.clear !== false} onChange={(e) => set({ clear: e.target.checked })} />
            <Checkbox label="Press Enter after" checked={Boolean(step.pressEnter)} onChange={(e) => set({ pressEnter: e.target.checked })} />
          </div>
        </>
      )}

      {step.type === "SELECT" && (
        <Field label="Option value or label" htmlFor={`${p}-opt`}>
          <Input id={`${p}-opt`} value={String(step.option ?? "")} onChange={(e) => set({ option: e.target.value })} />
        </Field>
      )}

      {step.type === "ASSERT_VISIBLE" && (
        <Checkbox label="Assert the element is NOT visible" checked={Boolean(step.negate)} onChange={(e) => set({ negate: e.target.checked })} />
      )}

      {step.type === "ASSERT_TEXT" && (
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <Field label="Expected text" htmlFor={`${p}-exp`}>
            <Input id={`${p}-exp`} value={String(step.expected ?? "")} onChange={(e) => set({ expected: e.target.value })} />
          </Field>
          <Field label="Match" htmlFor={`${p}-m`}>
            <NativeSelect id={`${p}-m`} value={String(step.match ?? "contains")} onChange={(e) => set({ match: e.target.value })}>
              <option value="contains">contains</option>
              <option value="equals">equals</option>
            </NativeSelect>
          </Field>
          <Checkbox label="Case sensitive" checked={Boolean(step.caseSensitive)} onChange={(e) => set({ caseSensitive: e.target.checked })} />
        </div>
      )}

      {step.type === "ASSERT_URL" && (
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <Field label="Expected" htmlFor={`${p}-uexp`}>
            <Input id={`${p}-uexp`} value={String(step.expected ?? "")} onChange={(e) => set({ expected: e.target.value })} />
          </Field>
          <Field label="Match" htmlFor={`${p}-um`}>
            <NativeSelect id={`${p}-um`} value={String(step.match ?? "contains")} onChange={(e) => set({ match: e.target.value })}>
              <option value="contains">URL contains</option>
              <option value="equals">URL equals</option>
              <option value="pathEquals">Path equals</option>
            </NativeSelect>
          </Field>
        </div>
      )}

      {step.type === "SCREENSHOT" && <Checkbox label="Capture the full page" checked={Boolean(step.fullPage)} onChange={(e) => set({ fullPage: e.target.checked })} />}

      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">Timeout, retries &amp; failure policy</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="Timeout (ms)" htmlFor={`${p}-to`}>
            <Input id={`${p}-to`} type="number" min={100} max={120000} value={String(step.timeoutMs ?? 10000)} onChange={(e) => set({ timeoutMs: num(e.target.value, 10000) })} />
          </Field>
          <Field label="Retries" htmlFor={`${p}-rt`}>
            <Input id={`${p}-rt`} type="number" min={0} max={3} value={String(step.retries ?? 0)} onChange={(e) => set({ retries: num(e.target.value, 0) })} />
          </Field>
          <Field label="On failure" htmlFor={`${p}-of`}>
            <NativeSelect id={`${p}-of`} value={String(step.onFailure ?? "STOP")} onChange={(e) => set({ onFailure: e.target.value })}>
              <option value="STOP">Stop the run</option>
              <option value="CONTINUE">Continue (run still fails)</option>
            </NativeSelect>
          </Field>
          <Field label="Screenshot" htmlFor={`${p}-ss`}>
            <NativeSelect id={`${p}-ss`} value={String(step.screenshot ?? "ON_FAILURE")} onChange={(e) => set({ screenshot: e.target.value })}>
              <option value="ON_FAILURE">On failure</option>
              <option value="ALWAYS">Always</option>
              <option value="NEVER">Never</option>
            </NativeSelect>
          </Field>
        </div>
      </details>
    </div>
  );
}

export interface ScenarioDraft {
  name: string;
  description: string;
  definition: ScenarioDefinitionInput;
}

export function ScenarioEditor({ draft, onChange, issues }: { draft: ScenarioDraft; onChange: (d: ScenarioDraft) => void; issues: Array<{ path: string; message: string }> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const steps = draft.definition.steps as AnyStep[];
  const settings = draft.definition.settings ?? {};

  const setDef = (patch: Partial<ScenarioDefinitionInput>) => onChange({ ...draft, definition: { ...draft.definition, ...patch } });
  const setSteps = (next: AnyStep[]) => setDef({ steps: next as StepInput[] });

  const stepIssues = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const i of issues) {
      const match = i.path.match(/steps\.(\d+)/);
      if (match) {
        const idx = Number(match[1]);
        m.set(idx, [...(m.get(idx) ?? []), `${i.path.replace(/^(definition\.)?steps\.\d+\.?/, "") || "step"}: ${i.message}`]);
      }
    }
    return m;
  }, [issues]);
  const otherIssues = issues.filter((i) => !/steps\.\d+/.test(i.path));

  function addStep(type: StepType) {
    const s = defaultStep(type);
    setSteps([...steps, s]);
    setOpen(s.id);
  }
  function move(i: number, d: -1 | 1) {
    const next = [...steps];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSteps(next);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Scenario</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="sc-name">
            <Input id="sc-name" required maxLength={120} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Start URL" htmlFor="sc-start" hint="Must be on an authorized website of this project.">
            <Input id="sc-start" value={draft.definition.startUrl} onChange={(e) => setDef({ startUrl: e.target.value })} placeholder="https://shop.example.com/" />
          </Field>
          <Field label="Description" htmlFor="sc-desc" className="sm:col-span-2">
            <Textarea id="sc-desc" rows={2} value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} />
          </Field>
          <Field label="Intended session duration (seconds)" htmlFor="sc-min" hint="If steps finish sooner, the browser stays on the last page until this time has passed. 0 = off.">
            <Input
              id="sc-min"
              type="number"
              min={0}
              max={1800}
              value={Math.round((settings.minSessionDurationMs ?? 0) / 1000)}
              onChange={(e) => setDef({ settings: { ...settings, minSessionDurationMs: (num(e.target.value, 0) ?? 0) * 1000 } })}
            />
          </Field>
          <Field label="Maximum run duration (seconds)" htmlFor="sc-max" hint="Runs exceeding this are stopped and reported as timed out.">
            <Input
              id="sc-max"
              type="number"
              min={5}
              max={3600}
              value={Math.round((settings.maxDurationMs ?? 300000) / 1000)}
              onChange={(e) => setDef({ settings: { ...settings, maxDurationMs: (num(e.target.value, 300) ?? 300) * 1000 } })}
            />
          </Field>
        </CardContent>
      </Card>

      {otherIssues.length > 0 && (
        <Alert variant="error" title="Fix these problems before saving">
          <ul className="list-disc pl-4">
            {otherIssues.map((i, n) => (
              <li key={n}>
                <code className="text-xs">{i.path}</code> {i.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Steps ({steps.length})</CardTitle>
            <CardDescription className="mt-1">Steps run top to bottom in a fresh, isolated browser.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!jsonMode) {
                setJsonText(JSON.stringify(draft.definition, null, 2));
                setJsonError(null);
              }
              setJsonMode(!jsonMode);
            }}
          >
            {jsonMode ? "Back to visual editor" : "Edit as JSON"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {jsonMode ? (
            <div className="space-y-2">
              <Textarea rows={22} className="font-mono text-xs" value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} />
              {jsonError && <Alert variant="error">{jsonError}</Alert>}
              <Button
                size="sm"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(jsonText) as unknown;
                    const r = scenarioDefinitionSchema.safeParse(parsed);
                    if (!r.success) {
                      setJsonError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
                      return;
                    }
                    setDef(parsed as ScenarioDefinitionInput);
                    setJsonMode(false);
                  } catch (err) {
                    setJsonError(`Invalid JSON: ${(err as Error).message}`);
                  }
                }}
              >
                Apply JSON
              </Button>
            </div>
          ) : (
            <>
              {steps.length === 0 && <p className="text-sm text-muted-foreground">No steps yet. Add one below.</p>}
              <ol className="space-y-2">
                {steps.map((s, i) => {
                  const expanded = open === s.id;
                  const errs = stepIssues.get(i);
                  return (
                    <li key={s.id} className={cn("rounded-lg border bg-card", errs && "border-destructive/60")}>
                      <div className="flex items-center gap-2 p-2">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => setOpen(expanded ? null : s.id)}
                          aria-expanded={expanded}
                        >
                          {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                          <span className="w-6 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                          <Badge variant={s.type.startsWith("ASSERT") ? "warning" : "secondary"}>{STEP_INFO[s.type].label}</Badge>
                          <span className="truncate text-sm">{(s.label as string) || summary(s)}</span>
                        </button>
                        <div className="flex shrink-0 items-center">
                          <Button size="icon" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                            <ArrowUp />
                          </Button>
                          <Button size="icon" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === steps.length - 1}>
                            <ArrowDown />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Duplicate"
                            onClick={() => {
                              const copy = { ...structuredClone(s), id: newStepId() };
                              setSteps([...steps.slice(0, i + 1), copy, ...steps.slice(i + 1)]);
                            }}
                          >
                            <Copy />
                          </Button>
                          <Button size="icon" variant="ghost" aria-label="Delete step" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                      {errs && (
                        <ul className="mx-3 mb-2 list-disc pl-4 text-xs text-destructive">
                          {errs.map((e, n) => (
                            <li key={n}>{e}</li>
                          ))}
                        </ul>
                      )}
                      {expanded && (
                        <div className="border-t p-4">
                          <p className="mb-3 text-xs text-muted-foreground">{STEP_INFO[s.type].help}</p>
                          <StepFields step={s} onChange={(next) => setSteps(steps.map((x, j) => (j === i ? next : x)))} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              <div className="rounded-lg border border-dashed p-3">
                <p className="mb-2 flex items-center gap-1 text-sm font-medium">
                  <Plus className="size-4" /> Add step
                </p>
                <div className="flex flex-wrap gap-2">
                  {IMPLEMENTED_STEP_TYPES.map((t) => (
                    <Button key={t} size="sm" variant="outline" onClick={() => addStep(t)} title={STEP_INFO[t].help}>
                      {STEP_INFO[t].label}
                    </Button>
                  ))}
                  {PLANNED_STEP_TYPES.map((t) => (
                    <Button key={t} size="sm" variant="outline" disabled title="Planned for Phase 5 (advanced builder)">
                      {t.replace("_", " ").toLowerCase()} <Badge variant="secondary">soon</Badge>
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Client-side validation mirroring the API. */
export function validateDraft(d: ScenarioDraft): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  if (!d.name.trim()) issues.push({ path: "name", message: "Name is required" });
  const r = scenarioDefinitionSchema.safeParse(d.definition);
  if (!r.success) issues.push(...r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return issues;
}

export function starterScenario(startUrl: string): ScenarioDraft {
  return {
    name: "",
    description: "",
    definition: {
      startUrl,
      settings: { minSessionDurationMs: 0, maxDurationMs: 300000 },
      steps: [{ id: newStepId(), type: "NAVIGATE", url: "/" }],
    },
  };
}
