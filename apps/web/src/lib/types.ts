import type { BatchCounts, ScenarioDefinition } from "@js/shared";

export interface User {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  testHeaderEnabled: boolean;
  testHeaderName: string;
  testHeaderValue: string;
  artifactRetentionDays: number;
  createdAt: string;
  _count?: { scenarios: number; domains: number; batches: number };
}

export interface Domain {
  id: string;
  hostname: string;
  port: number | null;
  host: string;
  allowSubdomains: boolean;
  method: "DNS_TXT" | "HTTP_FILE" | "SELF_ATTESTED";
  scheme: string;
  status: "PENDING" | "VERIFIED" | "ATTESTED" | "FAILED" | "REVOKED";
  verifiedAt: string | null;
  attestedAt: string | null;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
  createdAt: string;
  instructions: {
    dns: { recordType: string; name: string; value: string };
    file: { url: string; contents: string };
  };
}

export interface ScenarioListItem {
  id: string;
  name: string;
  description: string | null;
  latestVersion: number;
  updatedAt: string;
  startUrl?: string;
  stepCount: number;
  lastBatch: { id: string; status: string; createdAt: string } | null;
}

export interface ScenarioDetail {
  scenario: {
    id: string;
    projectId: string;
    name: string;
    description: string | null;
    latestVersion: number;
    version: number;
    definition: ScenarioDefinition;
    updatedAt: string;
  };
  versions: Array<{ version: number; changeNote: string | null; createdAt: string }>;
}

export interface BrowserProfile {
  id: string;
  name: string;
  engine: "chromium" | "firefox" | "webkit";
  devicePreset: string | null;
  viewportWidth: number;
  viewportHeight: number;
  isMobile: boolean;
  locale: string;
  timezone: string;
  colorScheme: string;
  createdAt: string;
}

export interface ProxyProfile {
  id: string;
  name: string;
  type: "HTTP" | "HTTPS" | "SOCKS5";
  host: string;
  port: number;
  hasCredentials: boolean;
  regionLabel: string | null;
  lastTest: { at: string; ok: boolean | null; egressIp: string | null; latencyMs: number | null; error: string | null } | null;
  createdAt: string;
}

export interface Batch {
  id: string;
  projectId: string;
  scenarioId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLING" | "CANCELLED";
  iterations: number;
  concurrency: number;
  launchDelayMs: number;
  maxFailures: number;
  captureTrace: boolean;
  sessionMode: string;
  configSnapshot: {
    browserProfile: { name: string; engine: string; devicePreset: string | null; viewportWidth: number; viewportHeight: number } | null;
    proxy: { name: string; host: string; port: number; type: string; regionLabel: string | null } | null;
    testHeader: { name: string; value: string } | null;
  };
  cancelReason: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  scenario: { id?: string; name: string };
  scenarioVersion: { version: number; startUrl?: string };
  createdBy?: { email: string } | null;
  counts?: BatchCounts;
}

export interface BatchStats {
  total: number;
  finished: number;
  passed: number;
  failed: number;
  cancelled: number;
  passRate: number | null;
  durationMs: { min: number | null; p50: number | null; p90: number | null; p95: number | null; max: number | null };
}

export interface RunSummary {
  id: string;
  iteration: number;
  status: "QUEUED" | "DISPATCHED" | "RUNNING" | "PASSED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorCategory: string | null;
  errorMessage: string | null;
  finalUrl: string | null;
}

export interface Artifact {
  id: string;
  kind: "SCREENSHOT" | "TRACE" | "LOG";
  contentType: string;
  sizeBytes: number;
  stepResultId: string | null;
  createdAt: string;
}

export interface StepResult {
  id: string;
  stepIndex: number;
  stepKey: string;
  type: string;
  label: string | null;
  status: "PASSED" | "FAILED" | "SKIPPED" | "CANCELLED";
  attempts: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  url: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  detail: Record<string, unknown> | null;
  artifacts: Artifact[];
}

export interface RunDetail extends RunSummary {
  batchId: string;
  navigationUrls: string[] | null;
  observed: {
    engine: string;
    browserVersion: string;
    userAgent: string;
    viewport: { width: number; height: number } | null;
    proxy: { server: string; regionLabel: string | null } | null;
    blockedRequests?: Array<{ url: string; reason: string; isNavigation: boolean }>;
  } | null;
  batch: {
    id: string;
    projectId: string;
    captureTrace: boolean;
    configSnapshot: Batch["configSnapshot"];
    scenario: { id: string; name: string };
    scenarioVersion: { version: number; startUrl: string };
  };
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}
