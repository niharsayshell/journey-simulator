import { z } from "zod";

/**
 * Scenario definition schema.
 *
 * Scenarios are pure data: a list of declarative steps interpreted by
 * @js/scenario-engine. There is deliberately no step type that accepts
 * JavaScript, and no field is ever passed to page.evaluate().
 */

export const IMPLEMENTED_STEP_TYPES = [
  "NAVIGATE",
  "WAIT",
  "CLICK",
  "SCROLL",
  "HOVER",
  "TYPE",
  "SELECT",
  "ASSERT_VISIBLE",
  "ASSERT_TEXT",
  "ASSERT_URL",
  "SCREENSHOT",
] as const;

/** Step types from the product spec that are not implemented yet (Phase 5). */
export const PLANNED_STEP_TYPES = ["ASSERT_RESPONSE", "CONDITION", "LOOP", "END"] as const;

export type StepType = (typeof IMPLEMENTED_STEP_TYPES)[number];

export const LOCATOR_STRATEGIES = ["role", "label", "testId", "text", "placeholder", "css"] as const;

/** ARIA roles accepted for role-based locators (subset most useful for journeys). */
export const ARIA_ROLES = [
  "button",
  "link",
  "heading",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "tab",
  "img",
  "navigation",
  "main",
  "dialog",
  "alert",
  "row",
  "cell",
  "list",
  "listitem",
  "searchbox",
  "spinbutton",
  "switch",
  "region",
  "banner",
  "contentinfo",
  "form",
  "article",
  "status",
  "note",
  "progressbar",
  "menu",
  "tabpanel",
  "table",
  "group",
  "tooltip",
] as const;

export const locatorSchema = z
  .object({
    strategy: z.enum(LOCATOR_STRATEGIES),
    value: z.string().trim().min(1, "Locator value is required").max(500),
    /** Accessible name for role locators. */
    name: z.string().max(500).optional(),
    exact: z.boolean().optional(),
    /** 0-based index when the locator matches several elements. */
    nth: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((loc, ctx) => {
    if (loc.strategy === "role" && !(ARIA_ROLES as readonly string[]).includes(loc.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `Unsupported ARIA role "${loc.value}"` });
    }
  });
export type Locator = z.infer<typeof locatorSchema>;

const baseStep = {
  id: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
  /** Per-attempt timeout for the step. */
  timeoutMs: z.number().int().min(100).max(120_000).default(10_000),
  /** Extra attempts after the first failure. */
  retries: z.number().int().min(0).max(3).default(0),
  /** What to do with the run when this step fails after all retries. */
  onFailure: z.enum(["STOP", "CONTINUE"]).default("STOP"),
  screenshot: z.enum(["NEVER", "ON_FAILURE", "ALWAYS"]).default("ON_FAILURE"),
};

export const navigateStep = z.object({
  ...baseStep,
  type: z.literal("NAVIGATE"),
  /** Absolute URL or a path ("/products") relative to the scenario start URL. */
  url: z.string().trim().min(1).max(2048),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).default("load"),
});

export const waitStep = z.object({
  ...baseStep,
  type: z.literal("WAIT"),
  /** Fixed delay. If randomMaxMs is set, the delay is uniformly random in [durationMs, randomMaxMs]. */
  durationMs: z.number().int().min(0).max(300_000),
  randomMaxMs: z.number().int().min(0).max(300_000).optional(),
});

export const clickStep = z.object({
  ...baseStep,
  type: z.literal("CLICK"),
  target: locatorSchema,
  button: z.enum(["left", "right", "middle"]).default("left"),
  clickCount: z.number().int().min(1).max(3).default(1),
});

export const scrollStep = z.object({
  ...baseStep,
  type: z.literal("SCROLL"),
  /** If target is set, the element is scrolled into view; otherwise the page scrolls by deltaY. */
  target: locatorSchema.optional(),
  deltaY: z.number().int().min(-50_000).max(50_000).default(800),
  /** Split the scroll into this many increments to mimic gradual reading. */
  steps: z.number().int().min(1).max(50).default(1),
});

export const hoverStep = z.object({ ...baseStep, type: z.literal("HOVER"), target: locatorSchema });

export const typeStep = z.object({
  ...baseStep,
  type: z.literal("TYPE"),
  target: locatorSchema,
  text: z.string().max(5000),
  /** Clear the field before typing. */
  clear: z.boolean().default(true),
  /** Delay between key presses; 0 fills instantly. */
  keyDelayMs: z.number().int().min(0).max(1000).default(0),
  pressEnter: z.boolean().default(false),
});

export const selectStep = z.object({
  ...baseStep,
  type: z.literal("SELECT"),
  target: locatorSchema,
  /** Option value or label to select. */
  option: z.string().max(500),
});

export const assertVisibleStep = z.object({
  ...baseStep,
  type: z.literal("ASSERT_VISIBLE"),
  target: locatorSchema,
  /** If true, assert that the element is NOT visible. */
  negate: z.boolean().default(false),
});

export const assertTextStep = z.object({
  ...baseStep,
  type: z.literal("ASSERT_TEXT"),
  target: locatorSchema,
  expected: z.string().max(5000),
  match: z.enum(["contains", "equals"]).default("contains"),
  caseSensitive: z.boolean().default(false),
});

export const assertUrlStep = z.object({
  ...baseStep,
  type: z.literal("ASSERT_URL"),
  expected: z.string().min(1).max(2048),
  /** "contains" / "equals" compare strings; "pathEquals" compares only the pathname. */
  match: z.enum(["contains", "equals", "pathEquals"]).default("contains"),
});

export const screenshotStep = z.object({
  ...baseStep,
  type: z.literal("SCREENSHOT"),
  fullPage: z.boolean().default(false),
});

export const stepSchema = z.discriminatedUnion("type", [
  navigateStep,
  waitStep,
  clickStep,
  scrollStep,
  hoverStep,
  typeStep,
  selectStep,
  assertVisibleStep,
  assertTextStep,
  assertUrlStep,
  screenshotStep,
]);
export type Step = z.infer<typeof stepSchema>;
export type StepInput = z.input<typeof stepSchema>;

export const scenarioSettingsSchema = z.object({
  /**
   * Intended session duration. If the steps finish sooner, the run idles on the
   * last page until this much time has elapsed. 0 disables.
   */
  minSessionDurationMs: z.number().int().min(0).max(30 * 60_000).default(0),
  /** Hard ceiling for one run; the run fails with TIMEOUT when exceeded. */
  maxDurationMs: z.number().int().min(5_000).max(60 * 60_000).default(5 * 60_000),
});
export type ScenarioSettings = z.infer<typeof scenarioSettingsSchema>;

export const scenarioDefinitionSchema = z
  .object({
    /** Absolute URL where every run starts. Must be on an authorized domain. */
    startUrl: z.string().url().max(2048),
    settings: scenarioSettingsSchema.default({}),
    steps: z.array(stepSchema).min(1, "Add at least one step").max(200),
  })
  .superRefine((def, ctx) => {
    const seen = new Set<string>();
    def.steps.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["steps", i, "id"], message: "Duplicate step id" });
      seen.add(s.id);
      if (s.type === "WAIT" && s.randomMaxMs !== undefined && s.randomMaxMs < s.durationMs) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["steps", i, "randomMaxMs"], message: "Random max must be ≥ duration" });
      }
    });
    try {
      const u = new URL(def.startUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startUrl"], message: "Only http(s) URLs are allowed" });
      }
    } catch {
      /* reported by .url() */
    }
  });
export type ScenarioDefinition = z.infer<typeof scenarioDefinitionSchema>;
export type ScenarioDefinitionInput = z.input<typeof scenarioDefinitionSchema>;

/** Resolve a NAVIGATE url (absolute or relative) against the scenario start URL. */
export function resolveStepUrl(url: string, startUrl: string): URL {
  return new URL(url, startUrl);
}

/** All absolute URLs a definition will navigate to directly (used for pre-flight authorization). */
export function collectNavigationUrls(def: ScenarioDefinition): URL[] {
  const urls = [new URL(def.startUrl)];
  for (const s of def.steps) if (s.type === "NAVIGATE") urls.push(resolveStepUrl(s.url, def.startUrl));
  return urls;
}
