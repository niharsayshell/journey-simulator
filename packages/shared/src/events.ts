import type { BatchStatus, RunStatus, StepStatus } from "./enums";

/** Events published by workers / API on Redis and forwarded to browsers via SSE. */
export type PlatformEvent =
  | { type: "batch.updated"; projectId: string; batchId: string; status: BatchStatus; counts: BatchCounts }
  | { type: "run.updated"; projectId: string; batchId: string; runId: string; status: RunStatus }
  | {
      type: "step.completed";
      projectId: string;
      batchId: string;
      runId: string;
      stepIndex: number;
      status: StepStatus;
    };

export interface BatchCounts {
  total: number;
  queued: number;
  running: number;
  passed: number;
  failed: number;
  cancelled: number;
}
