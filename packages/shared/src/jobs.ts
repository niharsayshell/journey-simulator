import type { BrowserEngine, ProxyType } from "./enums";

/** BullMQ payloads. Keep them small: workers load everything else from the database. */
export interface RunJobData {
  runId: string;
}

export interface ProxyTestJobData {
  proxyProfileId: string;
}

export interface ProxyTestResult {
  ok: boolean;
  egressIp?: string;
  latencyMs?: number;
  checkedUrl: string;
  error?: string;
  errorCategory?: "NETWORK" | "TIMEOUT" | "AUTH" | "SECURITY" | "INFRASTRUCTURE";
  engine: BrowserEngine;
  proxyType: ProxyType;
  testedAt: string;
}
