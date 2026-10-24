# Next phase checklist

## Phase 2 completion (execution engine hardening)
- [ ] ASSERT_RESPONSE step (wait for a network response by URL pattern and status)
- [ ] Console and page-error capture as LOG artifacts
- [ ] Per-run egress IP probe (optional, adds one request per run)
- [ ] Detection of live payment providers, blocked unless a sandbox flag is set

## Phase 3 (repeated execution, sessions)
- [ ] Session profile CRUD and UI
- [ ] RETURNING_SESSION: load and save the encrypted storageState per session profile, with locking for concurrent runs
- [ ] AUTHENTICATED_TEST_ACCOUNT: encrypted credentials plus a login sub-scenario; credentials never sent to the frontend
- [ ] MULTI_ACCOUNT_TEST: lease and release accounts with `leasedByRunId` / `leaseExpiresAt`
- [ ] Bulk run cancellation from the monitor; queue depth view

## Phase 4 (browsers and network)
- [ ] Install and verify Firefox and WebKit in the worker image (already in the Playwright image) and enable the skipped tests
- [ ] Geolocation permission and coordinates in profiles
- [ ] Browser comparison and network-region comparison dashboards
- [ ] Proxy health history

## Phase 5 (advanced builder)
- [ ] Drag-and-drop ordering
- [ ] Record & replay (Playwright codegen in a sandboxed recorder session, converted to steps)
- [ ] CONDITION, bounded LOOP and END steps
- [ ] Optional natural-language scenario generation (Claude API), always producing schema-validated steps

## Phase 6 (production)
- [ ] Scheduler (ScheduledTask with cron, BullMQ repeatable jobs)
- [ ] Retention job that deletes expired artifacts; editable retention period
- [ ] Member invitations and role management UI
- [ ] Prometheus metrics, alerts, OpenTelemetry tracing
- [ ] Compiled production bundles instead of tsx; Terraform examples (not applied)
