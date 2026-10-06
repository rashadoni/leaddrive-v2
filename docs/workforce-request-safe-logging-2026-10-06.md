# Request API failure logging and completion criteria

Parent PR589 head `2c5a6a4b35cb96988f9f3c417b122d788498c3a7`, main `86cba428d39e3ce4be13245bdb8e34e49dccf8d4`. This is the second bounded failure-logging slice. Final commit and hosted acceptance are recorded separately in exact-head receipts.

## Behavior and evidence

Three request mutation failure catches now discard the thrown value and emit only `submit-self-request`, `decide-request` or `cancel-self-request` through the existing error logger. The optional Route-entitlement catch uses a dedicated warning helper with the sole operation `request-route-entitlement`. The helper accepts no caught error or other request data. The existing error helper runtime is unchanged; its type union adds three labels. This guarantee covers the four literal call sites, not runtime validation of arbitrary JavaScript callers.

The entitlement failure still returns false and calls the HRM decision with `includeRouteConflicts: false`; it remains a warning. Existing actor checks, schemas, idempotency, status/body/header mappings, notification and Route/domain-service behavior are unchanged. No auth wrapper, domain service, scheduler, schema, applied migration, baseline, credential, grant or activation is changed.

Owner validation: seven suites pass 76 tests, including 27 new real-handler/shared-logger cases. Sixteen cases cover the four catch sites against private Error fields, a thrown string, hostile property getters and null. Further cases cover settings failure before submit, missing-actor denials, invalid cancellation ID, submit201/replay200 and mapped decision outcomes. Existing decision/self-request tests exercise domain behavior separately. Route handler tests mock authentication wrappers and domain services; they are not end-to-end authorization or database evidence. Another 225 MTM/capability/stream-isolation regression tests pass. Targeted lint and bounded production typecheck pass. Independent selected tests pass57; final source binding is recorded in the evidence branch.

The first new test draft had a missing closing brace and did not load; its failed result is retained. It was fixed in test code. No failed test or compiler baseline was weakened.

## Relation to the canonical 79 open tasks

The last explicit canonical rows remain WF-C10-011 **PLANNED** at line1030 and WF-C12-002 **PARTIAL** at line1066 in `workforce-hrm-completion-roadmap-2026-08-30.md`. The dependency plan is `workforce-hrm-79-open-dependency-plan-2026-10-06.md`. A fresh table scan still finds161 unique IDs:82DONE,55PARTIAL,1PARTIAL(owner attestation),14PLANNED,6OWNER DECISION,3BLOCKED. Weighted progress remains59%; C12-008PARTIAL. Neither status nor denominator changes here.

| Canonical task / acceptance criterion | Concrete advance in this slice | What still prevents full acceptance |
| --- | --- | --- |
| WF-C10-011: aggregated/minimized operational metrics; forbid raw location/reasons in general analytics; schema/log scanners and dashboard review | Four additional request catches cannot forward private thrown values. Sixteen runtime canaries verify the fixed payload and warn/error severity. Scoped direct-console inventory records the remaining exposure paths. | Remaining source paths, aliases/shared/framework/driver/client surfaces and every analytics destination need explicit coverage; dashboard/ingestion retention and access review remain unproven. A console replacement alone does not accept general analytics privacy. |
| WF-C12-002: tenant-safe finite stream/app/schema/policy-result dimensions without high-cardinality employee/location data | Three finite failure labels and one finite warning label replace arbitrary error objects; no request/employee/location dimension is added. Existing mobile-sync finite metrics and dormant roster diagnostics remain unchanged. | End-to-end dimension/cardinality/privacy audit, actual collection/dashboard ingestion, approved paging/SLO and delivery evidence remain open. This slice adds no telemetry destination or operational activation. |

## Finite remaining source scope and exit rule

The same AST scan across210 TypeScript files in Workforce library/API/cron source now finds48 direct console calls: two reviewed shared sinks, **45 raw thrown-value calls and one error-name-derived call**. All four request-API raw calls from the parent inventory are removed. This is a syntactic inventory, not a transitive logging audit or proof that a runtime leak occurred.

The remaining direct-call work is a finite three-batch inventory: Today/timesheet/exceptions **4**; attendance **9**; configuration **33**. Each batch must preserve response/auth/write semantics and verify private failure canaries, then reconcile its remaining paths against this inventory. Do not repeatedly re-review already accepted catches or invent unrelated feature work to grow the ledger.

After those enumerated paths and the explicit alias/shared/framework boundary audit, produce one consolidated coverage-and-destination matrix. Close a canonical task only if its entire criterion is evidenced; otherwise identify the exact outstanding operational/destination proof and move to the next independent dependency-plan work (WF-C12-004/005 fault/fairness matrix, then WF-C13-006 four-entitlement regressions). Do not continue an indefinite series of log substitutions or claim DONE from shrinking a call count. Historical api_keys provenance is not a dependency of these source-only batches.

## TS2737 diagnosis and ownership

The two diagnostics are at unchanged shared MTM test fixture `src/__tests__/mocks/mtm-prisma.ts:482–483`: defaults use `1n`, while the project target isES2017. The file is byte-identical in current main, accepted parent and this candidate. An isolated actual compiler reproduction rejects `1n` with TS2737 and accepts `BigInt(1)` under the same ES2017/esnext settings; Node confirms equal bigint values. A separate shared-MTM fixture fix can replace those two literals without changing the compiler target. That historical fixture is outside this request API change; its source and the baselines are left intact.

The bounded test-inclusive compiler reports precisely those two diagnostics, byte-identical to the parent. Its initial local config omitted the existing `src/types/next-auth.d.ts` module augmentation and emitted six additional TS2339 diagnostics in shared API auth; including the normal project augmentation removes them on actual rerun. Configs and outputs are retained. There are no current-slice source diagnostics, but no global clean compiler claim is made. Hosted baseline-qualified gates are recorded separately against the final SHA.

Support PR592 remains outside this scope. Authentic historical api_keys export/provenance stays with the separate backup owner; no Contabo/SSH/Mac action is taken here. No merge, deployment or runtime activation is performed.
