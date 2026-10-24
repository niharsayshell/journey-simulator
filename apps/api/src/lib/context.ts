import type { Queues, Redis } from "@js/queue";
import type { StorageAdapter } from "@js/storage";
import type { SecretBox } from "@js/security";
import type { ApiConfig } from "../config";

export interface AppContext {
  config: ApiConfig;
  redis: Redis;
  /** Dedicated connection for SSE subscriptions. */
  createSubscriber: () => Redis;
  queues: Queues;
  storage: StorageAdapter;
  secrets: SecretBox;
}
