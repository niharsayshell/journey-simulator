# Architecture

## Components

```
Browser ──► web (Next.js :3000) ──rewrite /api/v1/*──► api (Fastify :4000) ──► PostgreSQL
                    ▲                                         │   │
                    └──────── SSE (/events/stream) ◄──────────┤   └──► Redis (BullMQ queues, pub/sub, rate limits)
                                                              │              ▲
                                               storage (disk / S3) ◄── worker(s) ──► Playwright browsers ──► authorized sites
```

* **web** only talks to its own origin; Next.js forwards `/api/v1/*` to the API, so the session cookie is first-party and no CORS is needed.
* **api** validates and authorizes every request, writes records, enqueues work and streams events. It never launches browsers.
* **worker** processes `journey-runs` and `journey-proxy-tests` jobs. Scale horizontally; each process runs `WORKER_CONCURRENCY` browsers.
* **Redis** is used for BullMQ queues, `journey:events` (worker → API → SSE), `journey:cancel` (API → workers), rate limiting, and worker engine announcements.

## Package responsibilities

| Package | Responsibility | Depends on |
|---|---|---|
| `@js/shared` | Zod schemas for scenarios and API inputs, enums, limits, event/job types. Isomorphic (also used by the web app). | zod |
| `@js/database` | Prisma schema, migrations, shared client | Prisma |
| `@js/security` | URL parsing, authorized-host matching, SSRF checks, DNS-pinned safe fetch, domain verification, AES-256-GCM secrets, scrypt passwords | shared |
| `@js/scenario-engine` | Deterministic interpreter: timeouts, retries, failure policies, cancellation, run deadline, error classification | shared, playwright |
| `@js/browser-engine` | Launch engines, device presets, proxies, network guard, proxy connectivity test | security, playwright |
| `@js/queue` | Queue factories, batch dispatcher (concurrency, launch delay, limits, failure threshold), cancellation, event publishing | database, bullmq |
| `@js/reporting` | Pass rate, percentiles, CSV with formula-injection protection | — |
| `@js/storage` | `StorageAdapter` with local-disk and S3 implementations | aws-sdk |

The scenario engine has no database access and the API never touches Playwright browsers, so each layer can be tested on its own.

## Execution lifecycle

1. `POST /batches` validates the scenario version, limits, domain authorization (with DNS) and profiles; it snapshots browser/proxy configuration into `TestBatch.configSnapshot` and creates one `TestRun` per iteration (`QUEUED`).
2. `dispatchBatch` (inside a transaction with a per-batch Postgres advisory lock) moves up to `concurrency − active` runs to `DISPATCHED`, honouring per-domain and system-wide limits and the launch delay (BullMQ job `delay`). The job id equals the run id, so enqueueing is idempotent.
3. A worker **claims** the run atomically (`DISPATCHED → RUNNING`); a run that is no longer dispatchable is skipped. The worker re-checks domain authorization, decrypts proxy credentials, launches an isolated browser, installs the network guard and interprets the steps. Step results are saved as they complete and published as events.
4. A heartbeat every 5 s updates `heartbeatAt` and polls `cancelRequested`. Cancellation also arrives through Redis pub/sub and closes the browser context so the current step stops at once.
5. The final status is written only if the run is still owned by this worker. Browsers are always closed in `finally`. The worker then calls `dispatchBatch` to start the next run and finalize the batch.
6. A maintenance loop on every worker requeues runs with stale heartbeats (bounded by `WORKER_MAX_INFRA_ATTEMPTS`, then `FAILED/INFRASTRUCTURE`), re-enqueues runs whose job went missing, and dispatches batches waiting on capacity. Worker shutdown hands in-flight runs back to the queue instead of marking them cancelled.

Run statuses: `QUEUED → DISPATCHED → RUNNING → PASSED | FAILED | TIMED_OUT | CANCELLED`. A run is `PASSED` only if every step passed. Error categories: `INFRASTRUCTURE, NETWORK, SITE_ERROR, ASSERTION, TIMEOUT, SECURITY, CANCELLED, VALIDATION`.

## Data model

```
User ─< ProjectMembership >─ Project
User ─< AuthSession                          (only token hashes stored)
Project ─< VerifiedDomain
Project ─< Scenario ─< ScenarioVersion ─< ScenarioStep     (versions are immutable)
Project ─< BrowserProfile
Project ─< SessionProfile ─? TestAccount                  (Phase 3)
Project ─< ProxyProfile ─? EncryptedSecret                (credentials)
Project ─< EncryptedSecret                                 (never selected by the API)
Project ─< TestBatch ─< TestRun ─< StepResult
                          TestRun ─< Artifact >?─ StepResult
TestBatch >─ ScenarioVersion, BrowserProfile?, ProxyProfile?, SessionProfile?, ScheduledTask?
Project ─< ScheduledTask                                   (Phase 6)
Project/User ─< AuditLog
```

Every foreign key and the hot query paths are indexed (for example `TestRun(batchId,status)`, `TestRun(status,heartbeatAt)`, `TestRun(targetHost,status)` and `Artifact(expiresAt)`). See `packages/database/prisma/schema.prisma`.

## REST API (`/api/v1`)

All endpoints use JSON. Errors look like `{ "error": { "code", "message", "details?" } }`. Lists use cursor pagination: `?limit=&cursor=` → `{ items, nextCursor }`. Project-scoped resources return **404** to non-members.

| Method & path | Role | Notes |
|---|---|---|
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | — | httpOnly SameSite=Lax session cookie; 10 req/min on auth |
| `POST /projects`, `GET /projects`, `GET /projects/:id` | any member | creator becomes OWNER |
| `PATCH /projects/:id/settings`, `GET /projects/:id/audit-logs` | ADMIN | test header settings |
| `POST /domains`, `GET /domains?projectId`, `POST /domains/:id/verify`, `DELETE /domains/:id` | ADMIN (read: VIEWER) | returns verification instructions |
| `POST /scenarios`, `GET /scenarios?projectId&search`, `GET /scenarios/:id?version`, `PUT /scenarios/:id`, `DELETE /scenarios/:id` | MEMBER | `PUT` with a changed definition creates version n+1 |
| `POST /browser-profiles`, `GET /browser-profiles?projectId`, `DELETE /browser-profiles/:id`, `GET /browser-profiles/devices` | MEMBER | |
| `POST /proxy-profiles`, `GET /proxy-profiles?projectId`, `PATCH /proxy-profiles/:id`, `DELETE /proxy-profiles/:id` | ADMIN | credentials write-only |
| `POST /proxy-profiles/:id/test` | MEMBER | runs on a worker through a real browser |
| `POST /batches` (`dryRun` supported), `GET /batches?projectId`, `GET /batches/:id`, `GET /batches/:id/runs`, `POST /batches/:id/cancel` | MEMBER | 422 with `details[]` when rejected |
| `GET /runs/:id`, `GET /runs/:id/steps`, `GET /runs/:id/artifacts`, `POST /runs/:id/cancel` | VIEWER / MEMBER | |
| `GET /artifacts/:id/content` | VIEWER | streamed after an access check; storage keys are never exposed |
| `GET /reports?batchId&format=json|csv&level=runs|steps` | VIEWER | |
| `GET /events/stream?projectId&batchId?` | VIEWER | Server-Sent Events |
| `GET /health`, `GET /system/info` | — / any user | |

Example batch request:

```json
POST /api/v1/batches
{ "scenarioId": "…", "iterations": 10, "concurrency": 2, "launchDelayMs": 1000,
  "browserProfileId": "…", "proxyProfileId": "…", "captureTrace": true, "maxFailures": 3, "dryRun": false }
```

## Security model

* **Authorization of targets.** A domain becomes usable only after ownership is proven: a TXT record at `_journey-simulator.<host>` or the file `/.well-known/journey-simulator-verification.txt`. Authorization is per hostname, with optional subdomains, and per port (a registered port must match exactly; otherwise only 80/443). Checks run when a scenario is saved, when a batch is created (including DNS), **again in the worker before every run**, and on **every browser request**.
* **SSRF.** Only http(s) URLs are allowed; URLs with embedded credentials are rejected. Hostnames are resolved and every address must be public (private, loopback, link-local, CGNAT, ULA and IPv4-mapped ranges are blocked). Cloud metadata IPs and hostnames are always blocked. Development hosts are allowed only through the administrator setting `PRIVATE_HOST_ALLOWLIST`.
* **Redirects and off-site navigation.** Browsers follow redirects internally, so the network guard fetches each request with redirects disabled and validates the `Location` before the browser may follow it. Top-level navigation to unauthorized hosts fails the run with `SECURITY`. Third-party sub-resources (CDNs) may be allowed with `ALLOW_THIRD_PARTY_SUBRESOURCES`, but they are still SSRF-checked. Service workers are blocked so that no request bypasses interception.
* **Verification fetches** use a DNS lookup hook that validates the IP actually connected to (no rebinding), never follow redirects, and read at most 1 KB.
* **No code execution.** Scenarios are declarative; unknown step types and fields are rejected or stripped by Zod; nothing from a scenario is passed to `page.evaluate`.
* **Secrets.** Proxy credentials (and future storage states and test-account credentials) live in `EncryptedSecret` (AES-256-GCM, key from `ENCRYPTION_KEY`), are never selected by API queries and never logged. Errors from proxy tests are scrubbed of `user:pass@`.
* **Sessions and CSRF.** Random 256-bit tokens with only their SHA-256 hash stored; httpOnly SameSite=Lax cookies (Secure in production). Mutating requests must be `application/json` and, if an `Origin` is present, it must match `APP_ORIGIN`.
* **Abuse limits.** Administrator-controlled caps on iterations, per-batch concurrency, active batches per project, active runs per domain and system-wide, plus a minimum launch delay. Rate limiting is backed by Redis.
* **Analytics isolation.** A configurable header (default `X-Journey-Simulator: synthetic`) is added only to requests sent to authorized hosts.
* **Audit log** records security-relevant actions with non-sensitive metadata.
