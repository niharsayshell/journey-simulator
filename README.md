# Journey Simulator

A cloud-based platform for **authorized** website user-journey testing: verify that you control a site, build a journey with a no-code step editor, run it repeatedly in isolated real browsers (optionally through a proxy), and inspect step results, screenshots and Playwright traces.

> Only test websites you own or have explicit permission to test. Every target domain must be verified by DNS TXT record or hosted file, and the platform blocks navigation anywhere else.

## Status

This is the **first delivery**: Phase 1 (foundation) plus the basic execution path from Phases 2–4 that you asked for, so the platform is usable end to end. See [Known limitations](#known-limitations) and [docs/roadmap.md](docs/roadmap.md).

| Area | State |
|---|---|
| Accounts, projects, roles (OWNER/ADMIN/MEMBER/VIEWER enforced in API) | ✅ |
| Website authorization (DNS TXT / hosted file), SSRF and redirect protection | ✅ |
| Scenario CRUD, versioning, visual step editor + JSON mode | ✅ |
| 11 step types: NAVIGATE, WAIT, CLICK, SCROLL, HOVER, TYPE, SELECT, ASSERT_VISIBLE, ASSERT_TEXT, ASSERT_URL, SCREENSHOT | ✅ |
| Repeated execution: iterations, parallel browsers, launch delay, failure threshold, dry run | ✅ |
| BullMQ queue, worker heartbeats, stale-run recovery, cancellation (batch / run / step) | ✅ |
| Fresh isolated sessions | ✅ |
| Browser profiles and device emulation (Chromium verified; Firefox/WebKit when installed) | ✅ |
| Proxy profiles (HTTP/HTTPS/SOCKS5, encrypted credentials, connectivity test, egress IP) | ✅ |
| Live monitor (SSE), batch report with pass rate and p50/p90/p95, run inspector, CSV/JSON export | ✅ |
| Screenshots and Playwright traces (local disk or S3-compatible storage) | ✅ |
| Analytics isolation header, audit log | ✅ |
| Returning / authenticated / multi-account sessions | ⏳ Phase 3 (shown as "not yet implemented") |
| CONDITION, LOOP, END, ASSERT_RESPONSE, drag-and-drop, record & replay | ⏳ Phase 5 |
| Scheduling, retention clean-up job, team management UI, monitoring/alerts | ⏳ Phase 6 |

## Go live on a server

Non-technical step-by-step guide: **[GO-LIVE.md](GO-LIVE.md)**. One command installs everything on a fresh Ubuntu server with automatic HTTPS.

## Quick start (local, without Docker)

Requirements: Node 22+, pnpm 10, PostgreSQL 16, Redis 7, and a Playwright Chromium (`npx playwright install chromium` if you don't have one).

```bash
pnpm install
cp .env.example .env
# set ENCRYPTION_KEY in .env:  openssl rand -base64 32
pnpm db:migrate          # applies Prisma migrations to DATABASE_URL
pnpm dev                 # web :3000, api :4000, worker, Demo Shop :4100
pnpm dev:proxy           # optional: local test proxy on 127.0.0.1:8899
```

Open http://localhost:3000, create an account (the first account becomes platform admin), then:

1. **Projects → New project.**
2. **Website authorization:** add host `localhost:4100`, scheme `http`. Copy the verification value, open http://localhost:4100/owner (the Demo Shop's "site owner" page), paste it, publish, then press **Verify now**.
3. **Scenarios → New scenario → Load Demo Shop example → Save.**
4. Optional: **Proxy profiles** → host `127.0.0.1`, port `8899` → **Test** (requires `pnpm dev:proxy`).
5. Open the scenario → **Run** → choose iterations / parallel browsers / proxy → **Dry run**, then **Start**.
6. Watch the batch live; click a run for the step timeline, screenshots and trace download.

## Quick start (Docker Compose)

```bash
cp .env.example .env     # set ENCRYPTION_KEY
docker compose up --build
docker compose --profile proxy up -d test-proxy   # optional test proxy
```

Inside Compose the worker reaches the demo site as `demo-site:4100`, so register the host **`demo-site:4100`** (scheme http) and, for the proxy, host `test-proxy` port `8899`. Use http://localhost:4100/owner to publish the verification value. Scale browsers with `docker compose up --scale worker=3`.

> The Compose files were written but **could not be built in the development sandbox** (no Docker daemon). The same services were run natively and pass the full test suite.

## Tests

```bash
pnpm test               # unit (includes real-browser action-handler tests)
pnpm test:integration   # needs Postgres + Redis (uses database journey_test, Redis db 1)
pnpm test:e2e           # API + queue + worker + browsers + Demo Shop + test proxy
pnpm test:all
```

Create the test database once: `createdb -O journey journey_test`. Override with `TEST_DATABASE_URL` / `TEST_REDIS_URL`.

Last run: **121 passed, 2 skipped** (Firefox and WebKit engine tests skip automatically when those browsers are not installed).

## Repository layout

```
apps/
  web/          Next.js 15 + React 19 + Tailwind 4 + shadcn/ui-style components
  api/          Fastify 5 REST API (/api/v1), sessions, SSE
  worker/       BullMQ worker: runs scenarios in Playwright, proxy tests, recovery
  demo-site/    Bundled Demo Shop used for demos and e2e tests
packages/
  shared/           Zod schemas (scenarios, API inputs), enums, limits, event types
  database/         Prisma schema, migrations, client
  security/         URL/SSRF policy, domain verification, AES-GCM secrets, password hashing
  scenario-engine/  Deterministic step interpreter (no arbitrary JS)
  browser-engine/   Browser launch, device profiles, proxies, network guard
  queue/            Queues, batch dispatcher, cancellation, event bus
  reporting/        Statistics (percentiles) and CSV export
  storage/          Local-disk and S3-compatible artifact storage
infrastructure/docker/  Dockerfiles      tests/{unit,integration,e2e}      docs/
```

More: [docs/architecture.md](docs/architecture.md) (modules, data model, API contracts, security model), [docs/deployment.md](docs/deployment.md), [docs/roadmap.md](docs/roadmap.md).

## Known limitations

- **Session modes:** only `FRESH_SESSION`. Returning/authenticated/multi-account modes are modelled in the database and rejected by the API until Phase 3.
- **Browsers:** Chromium is verified. Firefox and WebKit code paths exist, but those browsers were not installed in the build sandbox, so they are untested; the API rejects runs for engines no online worker reports.
- **Egress IP** is measured by the proxy connectivity test, not on every run. Region labels are user-entered and are shown as such.
- **DNS rebinding:** the API's verification fetch pins the validated IP. In the browser, every request is checked (DNS resolved and verified public) before it is fetched, but the fetch resolves DNS again, so a very short TTL rebinding attack has a small time window. Run workers in a network segment without access to internal services for defence in depth.
- **Fidelity trade-off:** to stop redirects to unauthorized or private hosts (Chromium does not re-route redirects through Playwright's interceptor), the network guard fetches requests through Playwright's `route.fetch` with redirects disabled. Pages still render normally, but browser HTTP caching and HTTP/2 behaviour differ from a plain browser.
- **SOCKS5 proxies** cannot use username/password in Chromium (a Playwright limitation).
- **Artifact retention:** artifacts get an `expiresAt` timestamp; the clean-up job arrives in Phase 6.
- **Payment safeguards:** the Demo Shop checkout is a sandbox. Automatic detection of live payment providers is not implemented yet. Point checkout journeys only at staging or sandbox payment configurations.
- **Team management:** roles are enforced by the API, but inviting members has no UI or endpoint yet.
- **Production runtime:** services run TypeScript through `tsx` rather than a compiled bundle.
