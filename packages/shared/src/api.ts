import { z } from "zod";
import { BROWSER_ENGINES, PROXY_TYPES, SESSION_MODES, VERIFICATION_METHODS } from "./enums";
import { scenarioDefinitionSchema } from "./scenario";

const id = z.string().min(1).max(64);
const name = z.string().trim().min(1, "Name is required").max(120);

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(64).optional(),
});

export const registerInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  name: z.string().trim().max(120).optional(),
});
export const loginInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export const createProjectInput = z.object({
  name,
  description: z.string().max(1000).optional(),
});

export const updateProjectSettingsInput = z.object({
  testHeaderEnabled: z.boolean().optional(),
  testHeaderName: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/, "Header names may only contain letters, digits and dashes")
    .optional(),
  testHeaderValue: z.string().max(200).regex(/^[\x20-\x7E]*$/, "Printable ASCII only").optional(),
});

/** Hostname, optionally with a port ("shop.example.com", "localhost:4100"). */
export const createDomainInput = z.object({
  projectId: id,
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(260)
    .regex(/^[a-z0-9.-]+(:\d{1,5})?$/, "Enter a hostname such as shop.example.com (no scheme or path)"),
  allowSubdomains: z.boolean().default(false),
  method: z.enum(VERIFICATION_METHODS).default("HTTP_FILE"),
  /** Scheme used for HTTP_FILE verification. */
  scheme: z.enum(["https", "http"]).default("https"),
});

export const createScenarioInput = z.object({
  projectId: id,
  name,
  description: z.string().max(2000).optional(),
  definition: scenarioDefinitionSchema,
});
export const updateScenarioInput = z.object({
  name: name.optional(),
  description: z.string().max(2000).optional(),
  /** When provided, a new immutable version is created. */
  definition: scenarioDefinitionSchema.optional(),
  changeNote: z.string().max(500).optional(),
});

export const createBrowserProfileInput = z.object({
  projectId: id,
  name,
  engine: z.enum(BROWSER_ENGINES).default("chromium"),
  /** Playwright device descriptor name ("iPhone 13"), or omitted for a custom desktop profile. */
  devicePreset: z.string().max(100).optional(),
  viewportWidth: z.number().int().min(320).max(3840).default(1366),
  viewportHeight: z.number().int().min(320).max(2160).default(768),
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Locale like en-US").default("en-US"),
  timezone: z.string().max(64).default("UTC"),
  colorScheme: z.enum(["light", "dark", "no-preference"]).default("light"),
});

export const createProxyProfileInput = z.object({
  projectId: id,
  name,
  type: z.enum(PROXY_TYPES).default("HTTP"),
  host: z.string().trim().toLowerCase().min(1).max(253).regex(/^[a-z0-9.-]+$/, "Hostname or IPv4 address only"),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  regionLabel: z.string().max(80).optional(),
});
export const updateProxyProfileInput = createProxyProfileInput.omit({ projectId: true }).partial().extend({
  /** Explicitly remove stored credentials. */
  clearCredentials: z.boolean().optional(),
});

export const createBatchInput = z.object({
  scenarioId: id,
  /** Defaults to the latest version. */
  scenarioVersion: z.number().int().min(1).optional(),
  iterations: z.number().int().min(1).max(10_000).default(1),
  concurrency: z.number().int().min(1).max(100).default(1),
  launchDelayMs: z.number().int().min(0).max(600_000).default(0),
  browserProfileId: id.optional(),
  proxyProfileId: id.optional(),
  sessionMode: z.enum(SESSION_MODES).default("FRESH_SESSION"),
  captureTrace: z.boolean().default(false),
  /** Stop dispatching new runs once this many runs have failed. 0 disables. */
  maxFailures: z.number().int().min(0).max(10_000).default(0),
  /** Validate everything but do not launch browsers or create records. */
  dryRun: z.boolean().default(false),
});
export type CreateBatchInput = z.infer<typeof createBatchInput>;
