# Deployment

Nothing in this repository provisions cloud resources. The steps below describe what you would create yourself.

## Services to run

| Service | Image | Scaling | Notes |
|---|---|---|---|
| web | `infrastructure/docker/node.Dockerfile` (`BUILD_WEB=true`) | 1+ (stateless) | set `API_INTERNAL_URL` |
| api | `node.Dockerfile` | 1+ (stateless) | `TRUST_PROXY=true` and `COOKIE_SECURE=true` behind TLS |
| worker | `infrastructure/docker/worker.Dockerfile` (Playwright image with all browsers) | **independently, N replicas** | give each replica about 1 GB shared memory and ~1 vCPU / 1.5 GB RAM per concurrent browser |
| migrate | `node.Dockerfile`, `cd packages/database && npx prisma migrate deploy` | one-off per release | run before the api/worker roll out |
| PostgreSQL 16 | managed service | — | |
| Redis 7 | managed service | — | `maxmemory-policy noeviction` (required by BullMQ) |
| Object storage | any S3-compatible service | — | `STORAGE_DRIVER=s3`, `S3_*` variables |

The demo site and test proxy are for development only.

## Typical cloud layout

* Containers on ECS/Fargate, Cloud Run (api/web) with GCE or GKE Autopilot for workers, Azure Container Apps, or plain VMs running Compose.
* Put workers in a **separate subnet** whose egress allows only the public internet (no route to the database's private network apart from Postgres/Redis, and no metadata endpoint access, for example IMDSv2 hop limit 1 or a blocked 169.254.169.254). This is defence in depth on top of the in-app SSRF policy.
* Terminate TLS at a load balancer that routes `/` to web. The API does not need to be public, because web proxies `/api/v1`.

## Scaling limits

* Throughput ≈ `workers × WORKER_CONCURRENCY` simultaneous browsers, capped by `LIMIT_MAX_ACTIVE_RUNS_SYSTEM`.
* Raise the `LIMIT_*` values only together with worker capacity. They are deliberately conservative by default (100 iterations, 3 parallel per batch, 10 system-wide).
* The dispatcher's maintenance loop scans at most 50 active batches every 5 s per worker.

## Operations

* **Health:** `GET /api/v1/health` (database and Redis). Workers log JSON (pino) and announce their engines in Redis (`js:worker-engines`).
* **Graceful shutdown:** on SIGTERM workers hand in-flight runs back to the queue. Use a stop grace period of at least 30 s.
* **Stuck runs** recover automatically after `WORKER_STALE_AFTER_MS` (default 60 s).
* **Key rotation:** `EncryptedSecret.keyVersion` is reserved for rotation. A rotation command is not implemented yet, so changing `ENCRYPTION_KEY` makes stored proxy credentials unreadable (re-enter them).
* **Backups:** back up Postgres and the artifact bucket. Redis holds only transient queue state.
* **Monitoring and alerts** (queue depth, failure rate, worker count) are planned for Phase 6.
