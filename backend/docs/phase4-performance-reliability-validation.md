# Phase 4: Performance, reliability and recovery

Measured 2026-10-13; resumed 2026-10-14 (Asia/Kolkata). Phase 2/3 reports and
the existing working tree were reviewed. Completed financial checks were reused;
only Cashfree tests affected by the new request bound were rerun.

## Verdict

**LOCAL PHASE 4: PASS WITH FINDINGS for the bounded checks below.** Baseline,
10/25/50-user load, browser, export, recovery and uninterrupted soak passed.
The provider deadline defect was fixed. Measurement limits are explicit below;
this verdict is not a maximum-capacity or long-term leak guarantee.

**PRODUCTION SIGN-OFF: BLOCKED.** Actual deployment pooler, Render ingress,
service/database regions and the original remote Closed/P2024 evidence remain
unverified. Local measurements do not establish Render capacity.

## Environment and isolation

- Apple M1, 8 logical CPUs, 8 GB RAM; macOS arm64, Node 22.13.1.
- Local PostgreSQL 17, existing disposable `flowlytiks_test_phase2` database on
  test port 55439. Prisma Client/CLI 6.19.2; one instrumented shared API client
  with a test-only connection limit of five. No pooler is present in this test.
- Real Express routers, authorization/session middleware and Prisma queries.
  Synthetic sessions for four roles; password logins were separately measured
  through the real routes. Virtual users share four synthetic role identities,
  so the concurrency figures describe closed-loop request users, not 50 separate
  logged-in accounts or maximum production capacity.
- Test guard requires explicit disposable acknowledgement, a local test database
  name, and rejects the application's configured database. Application `.env`
  was never used for test writes. No migration/reset/seed CLI command ran.
- Google is an injected strict mock; Cashfree/Resend fault tests replace only
  their provider boundary. Unexpected external fetches fail closed. Browser
  requests reach the real local Next rewrite and Express API; API responses are
  not fabricated. CRM status alone is mocked in the isolated frontend server.
- Next 16.3.8 Webpack production build used a temporary frontend copy, separate
  output and ephemeral port. Application `.next`, user servers, environment
  files and dependencies were preserved.

Synthetic dataset: 1,200 students, 7,200 cash fee-history records, 24 faculty,
six staff, 1,800 follow-ups, 2,016 daily ledger records, 480 class-history records,
four polling classes, 30 batches, multi-batch associations and 480 incentive
entries. Eight additional scheduling records were created in the initial smoke
run and replayed in the main baseline. No real personal data was copied.

Retained disposable fixtures from previous phases also exist. Original load
snapshot totals were 1,311 students, 7,329 payments and 504 classes; these are
distinct from the marker-scoped synthetic dataset. Subsequent focused tests add
isolated fixtures, which explains small increases in later snapshots.

## Baseline and load

All times below are milliseconds. Each read has one first-request sample and
12 warm samples; small-sample p95/p99 both select the maximum. First request
means cold route/client work, not an empty PostgreSQL/OS cache or a Render cold
start. Query counts include auth, transaction statements and session touches;
they exclude the measurement query itself. SQL/parameters were not logged.

| Real API read | First | Warm p50 | p95 | p99 | Queries/request | Maximum bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Heartbeat | 30.4 | 3.1 | 5.0 | 5.0 | 7 | 44 |
| Admin dashboard | 17.1 | 6.4 | 11.1 | 11.1 | 16 | 271 |
| Student profile/dashboard | 3.7 | 2.3 | 3.2 | 3.2 | 5 | 352 |
| Student payments | 4.5 | 2.7 | 3.8 | 3.8 | 5 | 3,833 |
| Faculty dashboard | 10.6 | 5.7 | 9.4 | 9.4 | 15 | 3,308 |
| Staff dashboard/student summary | 6.7 | 5.4 | 6.7 | 6.7 | 11 | 3,214 |
| Admin student search | 6.2 | 3.9 | 4.9 | 4.9 | 8 | 9,465 |
| Staff search/class/paid filter | 7.2 | 5.8 | 6.4 | 6.4 | 11 | 3,290 |
| Follow-up/payment timeline | 15.0 | 5.4 | 10.9 | 10.9 | 16 | 2,767 |
| Faculty class history | 8.8 | 5.7 | 6.1 | 6.1 | 11 | 26,646 |
| Admin class history | 13.1 | 12.1 | 13.4 | 13.4 | 11 | 44,515 |
| Batch-directory search | 3.0 | 2.2 | 2.3 | 2.3 | 4 | 2,448 |
| Attendance week | 13.7 | 10.9 | 13.8 | 13.8 | 8 | 138,857 |
| Faculty incentives | 6.2 | 4.0 | 4.6 | 4.6 | 10 | 11,542 |
| Complete ledger JSON export | 6.1 | 4.1 | 5.2 | 5.2 | 5 | 59,550 |

Eight fresh scheduling requests: p50 7.6, p95/p99 24.2; eight idempotent
replays: p50 5.7, p95/p99 16.0. Both sets returned 200. Saving scheduled classes
did not credit incentives.

Password login, eight samples per role, with established bcrypt cost 10:

| Role | First | Warm p50 | Warm p95/p99 |
| --- | ---: | ---: | ---: |
| Admin | 122.6 | 77.1 | 80.0 |
| Student | 81.6 | 76.2 | 80.4 |
| Faculty | 76.0 | 79.0 | 85.9 |
| Staff | 77.9 | 76.4 | 82.7 |

Each load stage lasted approximately 45 seconds with 450-597 ms think time,
four-role read mix and one complete ledger export per 45 requests. Concurrent
Meet checks used the saved synthetic classes, real persistence and a 40 ms
provider mock; the real worker remained sequential with a 30-second interval.

| Virtual users | Requests | Requests/sec | p50 | p95 | p99 | Unexpected errors | Queries |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 918 | 20.2 | 9.9 | 23.4 | 31.1 | 0 | 9,332 |
| 25 | 2,164 | 47.6 | 7.5 | 20.6 | 45.5 | 0 | 21,528 |
| 50 | 4,336 | 95.1 | 6.1 | 19.8 | 65.1 | 0 | 42,843 |

All 7,418 responses were 200, with no rate-limit/validation responses in this
read workload. Expected injected 429/5xx failures are reported separately below.
Sampled DB connections remained five in these stages. API CPU was approximately
21-29%, 40-42% and 60-67% of one core respectively; event-loop p99 was 22-25 ms
with 20 ms histogram resolution. Sampled RSS was 118-151 MB; heap varied with GC.
These are API-process measurements, not whole-machine or PostgreSQL CPU metrics.

## Browser and exports

Eleven routes, first/repeated page loads (22 observations): `/admin`, `/students`,
`/admin/online-classes`, `/admin/faculty/work-ledger`, `/student`, Faculty dashboard,
attendance and online classes, Staff dashboard, students and follow-ups.
All observed API responses were 200; no JavaScript errors or desktop horizontal
overflow were captured. DOMContentLoaded ranged 50-187 ms locally. Each page was
observed for 3.5 seconds after DOMContentLoaded; this is not a measured time to
interactive. The initial `networkidle` attempt timed out and was replaced with
bounded sampling. That test-runner wait failure is not an application outage.

- API response durations in the browser: maximum 126 ms on the first Admin
  page, otherwise generally 14-53 ms. Resource waterfalls show related requests
  started together; no sustained per-row HTTP request loop was observed.
- Faculty pages make two heartbeat requests; Student makes two profile reads.
  The existing global/portal session controls and profile fetching explain the
  observations. No measured degradation justified changing authentication hooks.
- JavaScript transfer totals: approximately 199 KiB Staff, 263 KiB Admin online
  classes, 269 KiB Students, 324 KiB Admin, 337 KiB Student, 446 KiB Faculty and
  501 KiB Work Ledger. The largest observed chunk was 330 KB decoded/106 KB
  transferred. No asset/bundle rewrite was performed.
- Request routing used to block external traffic disables Playwright browser
  HTTP caching. Repeated pages measure warm server/database/module state, not
  normal browser cache savings. No mobile/throttled-network capacity claim.
- Existing student/class pages use pagination; the complete ledger export is
  intentionally unpaginated. Class-filter metadata reads complete saved batch
  snapshots; attendance intentionally includes the shared faculty week grid.
  Their payloads are monitoring candidates, not demonstrated bottlenecks here.

Actual UI downloads: XLSX 420 ms/46,101 bytes, PDF 99 ms/143,475 bytes. XLSX has
all three sheets, 47 entries, entry sum 15,995, faculty sum 15,995 and weekly total
15,995. The five-page PDF parses and contains the same weekly total. Complete filtered
contents/authorization remain verified by the existing Phase 2/3 export tests.

Separate persisted 100-participant attendance PDF: first request 89 ms, five
warm exports p50 25.9/p95/p99 50.0 ms, 14,921 bytes. Thirty concurrent heartbeat
reads p50 5.5/p95 22.9/p99 26.1 ms, all 200. Exporting created no incentive.
This bounded workload showed no sustained API starvation from exports.

## Reliability and evidenced fix

| Case | Result and evidence |
| --- | --- |
| Pool pressure | Existing isolated test forces P2024 with a one-connection test pool, fails within the bound and recovers after releasing contention. No production pool setting changed. |
| Terminated DB connection | Existing direct PostgreSQL termination test passes; stored active-session count remains unchanged. |
| Transport interruption | A test-only TCP proxy drops its own connections. Real heartbeat returns 503/AUTH_SERVICE_UNAVAILABLE, never 401. Restored transport is independently confirmed through pg. The same Admin token recovers in 13.9 seconds; Student/Faculty/Staff then return 200 in about 5 ms. |
| Idle reconnect/client cancellation | Same sessions survive idle closed connections and 20 cancelled read requests; subsequent heartbeat returns 200. No pool reset is used. |
| Meet failures | Injected latency, 429, 500/503 and a real 15-second AbortSignal deadline pass. Backoff requests do not loop inline; revoked access refreshes once, then requires reconnection. |
| Cashfree/Resend failures | Strict mocks verify latency, 429/500/503, one call per operation, caller cancellation and a stalled response body. Actual 30-second Cashfree/payout and 15-second Resend abort deadlines fire against mocked stalled transports. No transfer/email is initiated. |
| Worker restart | Existing separate-process test kills only its test child after evidence persists, respects the unexpired lease, resumes after injected expiry and credits exactly once. Rerun during Phase 4 with mocked Google and disposable records. |
| Shutdown/session protection | The actual backend entrypoint starts against guarded PostgreSQL, completes schema checks, serves a request and exits cleanly on SIGTERM before its emergency deadline; its port then rejects connections. Workers are disabled for that startup test. Separate background-worker drain and auth-storage tests pass: active dispatch drains; 403/500/network/stale responses preserve login, genuine current-token 401 clears it. |

The missing provider-deadline check reproduced one defect: default
`fetchCashfreeOrder` and `fetchCashfreePaymentsForOrder` calls from verification
and webhook reconciliation supplied no AbortSignal. Checkout already supplied
30 seconds, and payout requests already had that bound. A stalled verification
request had no application-level deadline.

Smallest fix: one line in `services/cashfreeService.js` supplies
`signal || AbortSignal.timeout(30000)`. Existing caller signals, headers,
idempotency keys and accounting remain unchanged. No automatic provider retry
was added. The regression failed before the fix and passed afterward; actual
mocked transport stalls abort in approximately 30.0 seconds. Checkout and
verification/webhook integrity PostgreSQL regressions pass after this change.
Normal read-load calculations were not changed, so there is no claimed latency
optimization or misleading comparison of different workload stages.

## Soak and recovery after load

The initial artifact completed 5,578 successful requests but elapsed 1,930
seconds and contained a 910-second sampling gap. It is retained as interrupted
evidence, not accepted as 20 continuous minutes or evidence of a memory leak.
RSS fell after the pause, which is not a valid leak/recovery measurement.

Only the soak was resumed using the same synthetic dataset, 10 virtual users,
1.8-second think time, concurrent mock Meet polling and limited ledger exports.
A task-owned `caffeinate -i` prevents idle sleep; the harness stops if sampling
gaps exceed 20 seconds. Samples are persisted every 10 seconds so interruption
does not lose progress. Resource/error stop conditions remain bounded.

Final uninterrupted run: **passed**, 1,201.8 seconds, 6,502 responses, all 200;
5.41 requests/sec, p50 13.3 ms, p95 31.3 ms and p99 35.4 ms. There were 70,458
instrumented statements, including polling/measurement work, and 140 complete
ledger exports. All 120 resource samples were captured; largest gap 10.009
seconds. No error/resource stop condition was reached.

| Soak resource | Observed result |
| --- | --- |
| DB connections | Five throughout sampled load; pool warmed from two at startup. Five idle pooled connections after load, released on normal shutdown. |
| RSS | 78.5-143.6 MB; first/last approximately four-minute medians 115.9/113.5 MB. |
| Heap | 28.6-48.3 MB; first/last window medians 38.0/39.8 MB. Repeated GC drops, no sustained monotonic rise. |
| API CPU | Median 8.3% of one core, sampled range 6.3-12.6%; last-window median 8.2%. |
| Event-loop delay | Sampled p99 median 22.0 ms, maximum 27.3 ms at 20 ms resolution. |
| Polling | Forty worker cycles, 400 mocked provider calls; zero or one active cycle, never overlapping. |

Fifteen seconds after load: CPU 0.22%, RSS 72.2 MB, heap 41.0 MB, active polling
zero and event-loop p99 21.1 ms. Connections stayed pooled as expected; no forced
GC, pool reset or increased timeout was used. The process then exited normally.
Final independent read: synthetic students 1,200, payments 7,200, pending entries
480, ledger entries 2,016, linked class incentives zero and remaining leases zero.
No financial fixture drift or growing worker backlog was observed.

This is bounded evidence against a sustained leak in this workload, not proof
that every long-running workload is leak-free. Aggregate and per-route latency
percentiles are saved; per-time-bucket latency histograms and a fresh post-load
API latency series were not captured. Resource/query-volume trends and drain
are measured, but a claim that minute-by-minute p99 stayed flat would be unsupported.
Staging monitoring should include those series.

## Changed files and validation

Production change in this Phase 4 continuation:

- `backend/services/cashfreeService.js`: default 30-second provider deadline;
  all other existing edits in this file are preserved.

Phase 4 test/report files:

- `backend/tests/phase4ApiServer.js`: guarded synthetic fixture/API server,
  shared-client query/resource metrics, bounded mock polling and owned shutdown.
- `backend/tests/phase4Performance.mjs`: baseline/load/soak driver, artifact
  output, soak-only resume, serialized monitoring, pause detection and cleanup.
- `backend/tests/phase4Recovery.postgres.test.js`: real role login timings,
  isolated transport/idle recovery, cancellation, Meet provider failure bounds
  and the actual backend entrypoint's startup/SIGTERM check.
- `backend/tests/phase4Export.postgres.test.js`: persisted PDF generation while
  heartbeat reads continue; confirms no export-induced incentive.
- `backend/tests/phase4Providers.test.js`: new strict Cashfree/Resend fault and
  cancellation regression; unexpected provider destinations fail closed.
- `frontend/tests/phase4Browser.mjs`: isolated production build, real API browser
  observations/download timing, exact local-host network allowlist and cleanup.
- This report.

Completed checks, with the explicit test environment and guarded URL:

```sh
node backend/tests/phase4Performance.mjs
# Resume only the incomplete soak with PHASE4_SOAK_ONLY=true and its saved marker:
caffeinate -i node backend/tests/phase4Performance.mjs
node --test backend/tests/phase4Recovery.postgres.test.js
node --test backend/tests/phase4Export.postgres.test.js
node --test backend/tests/phase4Providers.test.js
node --import ./backend/tests/setupDisposableDatabase.js --test --test-concurrency=1 backend/tests/checkoutRoutes.postgres.test.js backend/tests/paymentIntegrity.postgres.test.js
node --test backend/tests/disposableDatabase.test.js
```

The recovery transport, Meet timeout and actual backend shutdown cases passed in focused runs;
two affected Cashfree PostgreSQL tests passed; guard test passed. Four worker/
auth-storage regressions and two pool/reconnect tests passed before interruption.
Final provider suite: **four passed, zero failed**, including real deadline timing.
An initial unprivileged run failed its local listener with EPERM; the authorized
isolated-listener rerun passed. No provider/application error was hidden.
Production Webpack build and TypeScript passed in the copied frontend (38 static
pages, final successful browser build 18.7 seconds). Targeted frontend harness
ESLint passed. Changed JS/MJS syntax and `git diff --check` passed. Backend has no
lint/type-check script; no warning suppression or unrelated lint cleanup.

Artifacts retained under `/tmp/flowlytiks-phase4-full`,
`/tmp/flowlytiks-phase4-browser`, `/tmp/flowlytiks-phase4-smoke` and
`/tmp/flowlytiks-phase4-soak-resume`. These contain measurements and synthetic
exports, not credentials/tokens. Browser build copies/servers are removed;
final test-service cleanup is confirmed after the soak. The task-owned PostgreSQL
cluster was stopped after checking zero other clients; its data is retained.
No Phase 4 API/browser/sleep-inhibitor processes or temporary build copies remain.
User development servers remained running.

## Finite checklist and production evidence still required

| Phase 4 item | Status |
| --- | --- |
| Isolated synthetic data, real API routes and provider block | Verified |
| Login/heartbeat, all-role dashboards, searches/timelines/classes/batches/scheduling/attendance/incentives/exports baseline | Verified, with sample-size limits above |
| 10/25/50-user mix, think time, Meet polling, limited exports and stop conditions | Verified locally |
| Production browser waterfalls, duplicates, payload/bundle sizes and exports | Verified locally; no mobile/network-throttle performance claim |
| Pool/transport/idle recovery, cancellation, provider bounds/backoff, worker crash/drain and valid-session survival | Verified in isolated/mocked cases; bounded recovery delay retained |
| Uninterrupted 20-minute soak and post-load resource/worker drain | Verified; finer latency trend series remain a measurement limitation |
| Actual pooler and remote Closed/P2024 cause | Unverified infrastructure |
| Render ingress, region alignment and continuously running deployment worker | Unverified dashboard configuration |

Required staging evidence:

1. Database provider, direct/pooled endpoint classification, pooler product,
   version/mode, TLS/prepared-statement settings and a separate disposable endpoint
   through that pooler. Direct local PostgreSQL is not actual/representative
   transaction-pooler validation.
2. Render frontend/backend service types, regions, instance counts, start commands,
   sleep/restart settings and worker enablement. Confirm the frontend rewrite
   destination and DB region/private network. [Render regions](https://render.com/docs/regions)
   and [workers](https://render.com/docs/background-workers) explain these hosting
   capabilities; repository defaults do not prove dashboard settings.
3. All public/custom/private Express paths, any CDN/proxy, sanitized socket-peer/
   forwarded chains, and proof ingress overwrites spoofed headers. Existing
   trust-proxy settings were not guessed or changed.
4. Original incident stacks, provider/pooler disconnect logs, Render restart
   timestamps, process/connection counts and transaction/query durations for
   remote Closed/P2024. The local outage test establishes recovery behavior only.
5. Authorized staging Google/Cashfree/Resend checks, realistic network latency
   and load on the actual service size. No real provider authorization, delivery,
   transfer or production database operation occurred in this task.

## Deployment smoke test and monitoring

- Verify all-role login/reload/heartbeat/logout and role isolation in staging;
  transient 5xx must preserve the valid session.
- Compare selected month/session counts and totals with canonical records;
  check attendance/incentive histories and PDF/XLSX download after deployment.
- Confirm Meet worker startup, non-overlapping leases, persisted progress across
  a controlled restart and safe reconciliation; authorize real provider checks
  separately with test accounts and stable references.
- Monitor route p50/p95/p99, unexpected 5xx, DB query/transaction duration,
  active/waiting connections, pool timeouts, RSS/heap, event-loop lag and worker
  due/leased/error/backoff counts. Establish thresholds on the actual Render
  environment instead of copying local capacity figures.
- Correlate disconnects with DB/pooler logs and deployment/restart times. Keep
  diagnostics sanitized; alert on sustained growth/backlog or repeated failures.

No application data, migration, environment, dependency, UI or business-rule
change was made. Existing user edits and previously authorized PhonePe deletions
are preserved. No commit, push or deployment was performed.
