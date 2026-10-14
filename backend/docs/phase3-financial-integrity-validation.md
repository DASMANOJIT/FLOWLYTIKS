# Phase 3: Financial security and data integrity

Date: 2026-10-13. Resumed from the existing dirty working tree; Phase 1/2 fixes
and unrelated edits were preserved.

## Verdict

**LOCAL PHASE 3 PASSED for the finite checklist below.** The interrupted fixes
and remaining local financial mutation/recovery checks are verified. This is a
bounded test verdict, not proof of every possible interleaving.

**PRODUCTION SIGN-OFF: BLOCKED.** Actual pooler, Render ingress, remote
Closed/P2024 evidence and real provider/staging verification remain open.

## Confirmed defects and fixes

| Area | Reproduction | Minimal fix and verified result |
| --- | --- | --- |
| OTP attempts | Twelve concurrent wrong submissions persisted one attempt | Atomic conditional increment, capped at the existing ten-attempt limit; lock survives concurrent attempts. |
| OTP consumption | Read/compare/delete allowed competing verification requests | Conditional delete includes hash, expiry, attempt limit and lock state; four correct concurrent submissions yield exactly one success. Expired/replaced/consumed codes fail. |
| Cash weekly payout | Forced payment-record failure left payroll cycle PAID | Cycle, payroll, weekly record and lines share one transaction and week/attendance locks. Injected failure rolls everything back; concurrent requests pay once. Notifications remain outside transactions. |
| Cycle numbering | Different concurrent weeks collided on generated cycle number | Transaction-scoped cycle-number allocation lock. Existing numbering scheme retained. |
| Weekly online reservation | Cash payout succeeded while online dispatch was unresolved | Persist PROCESSING weekly record, lines and payout linkage before dispatch; release transaction before provider call. Cash and repeated weekly submission are rejected while unresolved. |
| Transfer dispatch | New PENDING payout skipped dispatch; concurrent dispatch could submit repeatedly | Optimistic atomic claim before network call; concurrent callers issue one transfer. Persist stable transfer reference before dispatch. |
| Uncertain transfer result | Lost/5xx response could be treated as retryable failure | Keep PROCESSING and existing reference; reconcile status rather than repeat transfer. Requests have a bounded abort signal. Missing configuration fails before claiming a payout. |
| Stale provider result | Late PENDING response/callback could overwrite SUCCESS | Conditional updates fence late responses; stale pending/failure callbacks cannot downgrade success. Explicit provider reversal handling remains separate. |
| Weekly reconciliation | Retained failed attempt inflated totals; duplicate SUCCESS could not repair an interrupted reconciliation | Count one effective attempt per payroll and transactionally update weekly record/lines. Replayed final status re-runs reconciliation without changing original paid timestamp. |
| Extra incentive payout | Provider call occurred before payment/entry reservation | Create payout, linked PROCESSING payment and entry reservation atomically before dispatch. Successful status reconciles once; definite rejection releases only that failed payment's entries. Cash retry pays their unchanged snapshots once. |
| Payout webhook | Missing configured signing secret accepted a callback | Fail closed; verify timestamp plus exact raw body with HMAC-SHA256/base64 before trusting payload, including test callbacks. Missing/invalid signatures cannot settle records. |
| Payout status URL | Strict provider-contract mock rejected `/transfers/:id` | Use documented v2 `/transfers?transfer_id=...`; recovery test now asserts the path and query parameter. |

No new fee, rate, attendance, incentive or payout calculation rule was introduced.
Reservations protect existing accounting; provider calls and notifications do not
run inside the new financial transactions. Failed attempt history is retained.

## Executed validation

### Real disposable PostgreSQL, mocked providers

The existing guarded local PostgreSQL 17 test database was reused. The guard
requires an explicit disposable acknowledgement, a local test database name and
rejects the application database target. Application `.env` was not used for
test writes. No migration/reset/seed command was run during this continuation.

Final broad run: **21 tests passed, zero failed/skipped** across these files:

- `otpConcurrency.postgres.test.js`: wrong-code contention, attempt lock,
  leading-zero string, expiry, purpose isolation, replacement and single use.
- `weeklyFinancial.postgres.test.js`: injected record-write rollback,
  concurrent cash requests, stored override amount and immutable paid record.
- `weeklyOnlineRecovery.postgres.test.js`: online/cash race, lost response,
  one transfer, failed-attempt history, forced reconciliation failure and replay
  repair. Stored weekly total remains 375, not multiplied by payout attempts.
- `incentivePayoutRecovery.postgres.test.js`: reservation exists at provider
  dispatch, response loss, locked entries, duplicate status sync, definite
  rejection, concurrent cash recovery; paid totals reconcile to 375.
- `payoutTransfer.postgres.test.js`: single dispatch, ambiguous response,
  stale response/callback, 400 versus 503, missing configuration.
- `payoutWebhook.postgres.test.js`: missing configuration/signature/timestamp,
  altered body, valid signature, replay, one event and stable paid timestamp.
- `paymentIntegrity.postgres.test.js`: ownership and authoritative order,
  amount/currency/status evidence; exact raw bytes, replay, concurrent processing
  and no stale downgrade. Existing payment receipt evidence assertions retained.
- `checkoutRoutes.postgres.test.js`: concurrent reservation, provider call
  outside transaction, response-loss recovery and paid-state fence.
- `financialPermissions.postgres.test.js`: anonymous and wrong-role direct
  mutation requests; payment/weekly/incentive/Staff routes plus enumerated
  Admin-only payout/payroll/ledger mutation routes reject forged privilege data.
- `functional.postgres.test.js`: real HTTP sessions, Staff creation/reset,
  follow-ups, cash attribution/concurrency, Admin-only cash undo, online undo
  rejection, dashboard consistency and daily attendance. Added February/March
  payments in two academic sessions: four distinct records, backend amount 600
  despite submitted amount 1.
- `attendanceBoundaries.postgres.test.js`: Friday-noon IST cutoff and settled
  locks; existing rates and stored historical amounts preserved.
- `incentiveCopySets.postgres.test.js`, `onlineClassDeletion.postgres.test.js`,
  `meetPipeline.postgres.test.js`: copy-set payment/edit protection, snapshots,
  class lifecycle/ownership/deletion, cancellation and exactly-once credit.
- `meetRestart.postgres.test.js`: separate-process worker/restart recovery.
- `remainingLocks.postgres.test.js`, `rateLimit.postgres.test.js`: separate
  processes, durable claims, stale finalizer fencing, rate budget and rollback.
- `ledgerExport.postgres.test.js`: authorized complete filtered export data.
- `databaseRecovery.postgres.test.js`: bounded pool contention and terminated
  local connection recovery without revoking stored sessions.

After the final one-line provider URL correction, the four affected payout
suites were rerun: **4 passed, zero failed/skipped**. No real provider endpoint
was contacted. Lost responses are injected transport failures, not a real
Cashfree timeout; the abort signal is asserted, not a 30-second wall-clock test.

Commands used from `backend`, with guarded test-only environment configured:

```sh
node --import ./tests/setupDisposableDatabase.js --test --test-concurrency=1 <the PostgreSQL test files listed above>
node --test tests/paymentAuthorization.test.js tests/dailyAttendance.test.js tests/workLedgerAttendance.test.js tests/extraIncentiveCount.test.js tests/incentiveCopySets.test.js tests/meetVerification.test.js tests/facultyOnlineClass.test.js tests/staffPayment.test.js tests/sessionFailure.test.js tests/securityHardening.test.js tests/staffPasswordReset.test.js tests/staffAuth.test.js
```

Second command: **111 unit/mock tests passed, zero failed/skipped**. These include
leading-zero/resend/reset cases and transient-error versus genuine-auth-failure
handling. They are not represented as real provider tests.

### Browser, build and static checks

Reused and reran `frontend/tests/phase2RealApi.mjs`: passed real-browser to real
Express/Prisma scenarios against the disposable database. Browser API responses
were not intercepted. Cashfree/Resend alone were mocked. Coverage includes all
four role sessions/reload/logout, Staff cash/OTP creation, role password resets,
student signup, checkout/verification and parsed XLSX/PDF export contents/totals.

The script built its own temporary Next.js copy: production Webpack build and
TypeScript passed (38 static pages). Active development `.next` was untouched.
`npx --no-install eslint tests/phase2RealApi.mjs` passed. Seventeen affected
backend JavaScript files passed `node --check`; no backend lint script exists.
`git diff --check` passed. No broad lint-warning suppression or cleanup occurred.

The new session-boundary assertion initially expected 200 instead of the
endpoint's existing 201 Created; only the test expectation was corrected.
Expected fault-injection/duplicate-event diagnostics are not hidden failures.

## Files changed by this Phase 3 task

Production files (other pre-existing changes in these files were preserved):

- `backend/services/emailOtpService.js`: conditional atomic attempts/consumption.
- `backend/controllers/facultyweeklypaymentcontrollers.js`: transaction-bound
  cash writes and online reservation, shared transaction helper arguments.
- `backend/services/facultyPayoutService.js`: optional transaction client for
  payout creation; default callers retain existing behavior.
- `backend/services/cashfreePayoutService.js`: dispatch claim, uncertainty,
  stale-result fencing, reconciliation and status lookup contract.
- `backend/controllers/facultypayoutcontrollers.js`: fail-closed raw signature
  verification for payout callbacks.
- `backend/controllers/facultyextraincentivecontrollers.js`: reserve linked
  payout/payment before online dispatch, then reconcile outside transaction.

New regression files: `otpConcurrency`, `weeklyFinancial`, `weeklyOnlineRecovery`,
`incentivePayoutRecovery`, `payoutTransfer`, `payoutWebhook`, and
`financialPermissions` (all under `backend/tests/`, suffix `.postgres.test.js`).
Updated tests: `functional.postgres.test.js`, `paymentIntegrity.postgres.test.js`,
`staffPasswordReset.test.js`, `staffAuth.test.js`. This report is new.

No frontend production files, dependencies, schema, migrations or environment
files were changed by this task. The large existing dirty tree, including
previously authorized PhonePe file removals, remains intact.

## Official provider contract and operational recovery

PG signing was checked against [Cashfree raw-body signature documentation](https://www.cashfree.com/docs/payments/online/webhooks/signature-verification).
Payout signing was checked against [Cashfree v2 webhooks](https://www.cashfree.com/docs/api-reference/payouts/v2/webhooks/webhooks-v2).
Status lookup follows [Get Transfer Status v2](https://www.cashfree.com/docs/api-reference/payouts/v2/transfers-v2/get-transfer-status-v2),
whose documented default API version is 2024-01-01. PG configuration uses
2025-01-01. The API version does not prove the deployed webhook subscription
version: confirm Payout Webhooks V2 and the correct oldest active signing client
secret in the merchant dashboard. No secrets were read into this report.

An uncertain transfer stays reserved. Use the existing authorized status-sync
operation against its retained transfer ID; do not reset it to FAILED or start
another cash payout. A crash after reservation but before dispatch leaves the
durable PENDING payout for the existing authorized initiation path. Automated
restart discovery of every such reservation is not claimed by these tests.

## Outstanding checks and blockers

1. **Local legacy-mutation gap: closed for the explicit inventory below.**
   Successful and rejected mutations, retained totals/history, rollback and
   concurrent requests now supplement the earlier role-denial sweep.
2. **Local transaction/restart gap: closed for the explicit scenarios below.**
   Real separate-process deadlock and process-termination tests supplement the
   earlier injected application failures. No automatic restart scanner was
   added; tests exercise the existing initiation/status-reconciliation paths in
   fresh processes. Every possible crash instruction boundary is not claimed.
3. **Actual pooler: blocked by infrastructure access.** Need provider identity,
   pooled/direct endpoint classification, product/version/mode, TLS and prepared
   statement settings, and a disposable endpoint through that pooler. These
   results are direct PostgreSQL only, not representative or actual pooler proof.
4. **Render ingress: blocked by dashboard evidence.** Need frontend rewrite
   destination, public/private/custom ingress paths, any CDN/proxies, sanitized
   socket/forwarded chains and proof forwarded headers are overwritten. Also
   confirm instance counts and always-on worker configuration. No guessed trust
   proxy setting was applied.
5. **Original remote Closed/P2024: unresolved.** Local recovery tests pass but
   do not reproduce its original cause. Correlate sanitized incident stacks,
   provider/pooler disconnect logs, Render restarts, connection counts and
   transaction durations before changing limits.
6. **Provider/staging verification remains manual.** No real hosted Cashfree
   checkout/payout/webhook delivery, Google authorization/Meet data or Resend
   delivery was attempted. Confirm actual payload versions and merchant
   configuration in staging. Browser-driven payout/Meet races and student OTP
   login/2FA remain distinct from the real HTTP and unit coverage above.

No application data, paid history or real financial records were modified. No
real provider actions, migrations, commits, pushes or deployments were performed.
Only task-owned temporary services are stopped; user development servers remain
untouched. Unresolved items are intentionally not marked passed.

## Local gap closure continuation

### Finite checklist

| ID | Remaining inventory / required case | Result and evidence |
| --- | --- | --- |
| L1 | `/payments/mark-paid`, `/bulk-update`, `/reverse`, shared `createCashPaymentForStudent` | PASS. Invalid month/status and wrong roles leave fixture payments unchanged; single/bulk replay, three simultaneous cash creates, explicit rollback, wrong-student reversal, concurrent reversal and stale online evidence are covered by `legacyFees.postgres.test.js`. Amounts reconcile to three paid records of 600. Real route denial/validation and Staff attribution remain covered by affected regression suites. |
| L2 | Payroll `/approve`, `/process`, `/reject`, `/unlock`, `/initiate-payout` | PASS. Real HTTP route tests cover all non-admin roles, missing payloads, paid/active-payout fences, editable reject/unlock/approve, final-write rollback, concurrent process, immutable paid date, and concurrent online initiation with one saved payout/one mock transfer. `legacyPayroll.postgres.test.js`. |
| L3 | `createPayout`, `markPayoutPaid`, `markPayoutFailed`, existing bulk wrappers | PASS for shared mutation primitives. Payroll-derived owner/amount override forged inputs; concurrent create produces one active payout; missing reference fails; payroll-write failure rolls payout back; concurrent settlement succeeds once; paid failure and uncertain-transfer manual failure are rejected. `legacyPayout.postgres.test.js`; route restrictions remain in `financialPermissions.postgres.test.js`. Bulk wrappers reuse these tested primitives and retain per-item results. |
| L4 | Legacy pending-count adjustment, copy-set edit/payment protection | PASS. Real database test covers role/count validation, body owner spoof ignored, concurrent/replayed target count, stale expected count and rate-snapshot-preserving reduction/history. `legacyIncentive.postgres.test.js`; affected copy-set and incentive payout races rerun successfully. Existing manual Online Class bypass checks remain passing unit coverage. |
| L5 | Deliberate PostgreSQL deadlock and bounded safe retry | PASS. Two child processes each update a different payroll row, synchronize by IPC, then request the other's row. One succeeds and one receives a PostgreSQL deadlock (40P01, exposed through Prisma); both balances equal 101, proving victim rollback. One explicit ordered database-only retry yields 102 each. No external request is retried. |
| L6 | Process dies while holding financial transaction locks | PASS. Kill only the task child after its first update is acknowledged. A fresh transaction acquires both rows within a 3-second lock timeout and confirms both remain 102. No partial write survives. |
| L7 | Process dies after mock provider acceptance but before response persistence | PASS. Kill the dispatch child after the mock acknowledges acceptance. Persisted PROCESSING status and transfer ID survive. A new process calls the existing initiation/reconciliation flow; its strict mock permits GET only, and the same single payout becomes SUCCESS for 204. |
| L8 | Restart after durable reservation, before any dispatch | PASS. A separate new process resumes a PENDING reservation, makes exactly one allowed mock POST and reconciles via GET. No new payout row or replacement transfer ID is needed. |
| L9 | Affected regressions and safety | PASS. Final 15 PostgreSQL suites, 33 targeted unit/mock tests, syntax and diff checks below. Fail-closed disposable guards and outbound-provider block retained; no app DB writes/migrations or user-server interruption. |

L5-L8 use `financialRecovery.postgres.test.js` and
`financialRecoveryWorker.js`. IPC barriers, not sleep-based winner assumptions,
control the races. Transactions have explicit timeouts. Tests make exactly one
safe database retry, not an unbounded retry loop; no production retry policy was
broadened. The existing bounded Staff serialization-retry tests also pass.

### Reproduced defects and minimal changes

- Legacy reject changed a PAID cycle to REJECTED. Approve/process/reject/unlock
  now acquire the same transaction-bound week lock as weekly payout and check
  paid payroll and active payout state before changing it.
- Three concurrent legacy cash creates produced uniqueness conflicts followed
  by PostgreSQL 25P02 queries in aborted transactions. The shared cash helper now
  acquires the existing per-student/session/month lock before reading/creating.
  All current callers supply the transaction client.
- Cash undo used an unconditional update following an earlier read. A conditional
  paid-CASH update makes concurrent undo single-use and prevents stale cash data
  from overwriting newer online evidence; conflicts return 409.
- Three concurrent legacy payout creations produced three rows for one payroll.
  Creation now joins/opens a short transaction, uses the existing week lock and
  rechecks active payouts, returning the existing reservation on replay.
- Manual payout settlement used a stale read before unconditional writes. It now
  conditionally claims the observed payout state within the payroll-write
  transaction. Final payroll failure rolls back settlement; competing calls
  cannot replace paid timestamps. Manual failure cannot downgrade SUCCESS or
  turn an initiated uncertain transfer into a retryable failure.
- Manual settlement generated two identical notifications, one transactionally
  and one through the existing notifier. Only the post-commit notifier remains;
  its failure stays isolated from financial writes. No new email/provider path.

### Files changed in this continuation only

- `backend/controllers/paymentcontrollers.js`: cash lock and conditional undo.
- `backend/controllers/facultypayrollcontrollers.js`: protected cycle transitions.
- `backend/services/facultyPayoutService.js`: deduplicated creation, guarded
  settlement/failure and post-commit notification reuse. Prior optional-client
  work was preserved.
- New tests: `backend/tests/legacyFees.postgres.test.js`,
  `legacyPayroll.postgres.test.js`, `legacyPayout.postgres.test.js`,
  `legacyIncentive.postgres.test.js`, `financialRecovery.postgres.test.js`,
  `financialRecoveryWorker.js`.
- This existing report was updated, not replaced.

### Final commands and results

From backend, with the existing disposable-only environment and
RUN_PHASE2_POSTGRES_TESTS/RUN_COPY_SET_POSTGRES_TESTS enabled:

```sh
node --import ./tests/setupDisposableDatabase.js --test --test-concurrency=1 tests/legacyFees.postgres.test.js tests/legacyPayroll.postgres.test.js tests/legacyPayout.postgres.test.js tests/legacyIncentive.postgres.test.js tests/financialRecovery.postgres.test.js tests/financialPermissions.postgres.test.js tests/functional.postgres.test.js tests/weeklyFinancial.postgres.test.js tests/weeklyOnlineRecovery.postgres.test.js tests/incentivePayoutRecovery.postgres.test.js tests/incentiveCopySets.postgres.test.js tests/payoutTransfer.postgres.test.js tests/payoutWebhook.postgres.test.js tests/checkoutRoutes.postgres.test.js tests/paymentIntegrity.postgres.test.js
```

**15 passed, zero failed/skipped.** The final added pre-dispatch restart case
was then rerun separately: **1 passed**.

```sh
node --test tests/paymentAuthorization.test.js tests/staffPayment.test.js tests/securityHardening.test.js tests/extraIncentiveCount.test.js tests/sessionFailure.test.js
```

**33 passed, zero failed/skipped.** Nine changed JavaScript files passed
`node --check`; `git diff --check` passed. No backend lint/type-check command is
defined for these JavaScript files. No frontend/dependency changes were made,
so the already-passing isolated frontend type-check/build and targeted lint were
not repeated. Active `.next` artifacts were untouched.

Test setup corrections: the resumed disposable cluster initially started on its
default port and was restarted on its designated test port; no application
database was contacted. Child processes now independently initialize the
disposable guard instead of inheriting its resolved DATABASE_URL. Prisma exposes
the real deadlock as a connector error on this version, so the assertion accepts
its explicit 40P01/deadlock diagnostic as well as P2034. Repeated payroll runs
initially exhausted a reused test Admin's real rate budget; a fresh fixture Admin
per run fixes isolation without weakening the limiter.

No remaining local infrastructure blocker for this finite checklist. This does
not verify deployed pooler compatibility, real provider delivery, or automatic
discovery of every abandoned reservation. Those are not relabelled as local
test successes. Production sign-off remains BLOCKED as detailed above.
