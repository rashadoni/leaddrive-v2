# Bounded Workforce failure logging

PR589 continues from accepted source `dc91bd039cf25f9f30b9580471e0f409ebf6eb2e`, main `86cba428d39e3ce4be13245bdb8e34e49dccf8d4`. This slice advances WF-C12-002 and WF-C10-011 without changing their statuses. Ledger remains 82/161 DONE, 79 open, weighted 59%; C12-008 remains PARTIAL.

## Four failure boundaries

| Existing failure boundary | Fixed operation label | Existing response retained |
| --- | --- | --- |
| Today persisted-grant resolution | `authorize-today-read` | 503, generic unavailable body, private/no-store headers |
| Timesheet persisted-grant resolution | `authorize-timesheet-read` | 503, generic unavailable body |
| Request decision historical-grant resolution | `authorize-request-decision` | Forbidden result before mutation, notification or Route read |
| Dormant no-show-review worker endpoint | `run-no-show-review` | 500, generic failure body, no-store/nosniff headers |

The first three catches previously passed the complete thrown value to `console.error`; the fourth read and logged arbitrary `Error.name`. Each now discards the caught value and calls the existing `logWorkforceSensitiveOperationFailure` with a literal operation label. The shared logger's runtime is unchanged; only its TypeScript operation union gains these four labels. The guarantee is for these reviewed call sites, not runtime validation of every possible JavaScript caller of the shared helper.

No error name/message/stack/cause, tenant/employee reference, location, request reason or token is forwarded by these catches. No logger transport, scheduler, endpoint, grant, credential, feature flag or activation is installed. Existing access decisions, return bodies/statuses/headers, write boundaries, cron authentication and tenant rollout fences remain unchanged. The no-show endpoint remains absent from the deployment schedule. No applied migration or baseline is edited; no backup/Contabo action is involved.

## Validation

Six focused suites pass 50 tests, including sixteen new cases invoking the real catch paths and real shared logger with synthetic private Error fields, a thrown string, an opaque object with hostile property getters, and null. Captured log arguments must contain only the fixed event shape; response behavior and no-write/no-Route boundaries are asserted. Existing scheduler and data-classification tests remain in the focused run. The initial four Today test failures were an incorrect new expectation of `no-store`; the test was corrected to the existing `private, no-store` response, with no response change.

Another 225 tests cover the existing MTM regression selection, tenant/mobile capabilities and sync stream isolation. Targeted lint and bounded production typecheck pass. The test-inclusive bounded compiler reports exactly the same two TS2737 BigInt-literal diagnostics at lines 482/483 of the unchanged `src/__tests__/mocks/mtm-prisma.ts` on the accepted parent and this candidate. There are no new diagnostics in that comparison; no global clean compiler claim, compiler-target change or baseline adjustment is made. Hosted acceptance is recorded separately against the final commit.

Independent tests, source-transform proof and exact-head receipts are kept in the evidence branch. Owner test execution is not automatically independent or hosted execution credit.

## Remaining logging inventory and next slice

An AST inventory across 210 TypeScript files in `src/lib/workforce`, `src/app/api/v1/workforce` and Workforce cron routes finds the existing shared sink plus **49 remaining raw thrown-value calls and one error-name-derived call**. These unchanged sites are not closed by this slice:

| API area | Remaining direct calls |
| --- | ---: |
| configuration | 33 |
| attendance | 9 |
| requests | 4 |
| timesheet | 2 |
| today | 1 |
| exceptions | 1 |

The source-bound inventory records each path, line, expression and file hash. It is a syntactic console-call inventory, not a complete logging/data-flow audit: aliases, framework/driver output, shared platform, client and MTM surfaces require separate assessment. Source exposure paths do not establish that a real runtime leak occurred.

Next independent slice: the four request API logging calls, including the Route-entitlement lookup warning, with handler-level privacy canaries and unchanged authorization, idempotency, notification and Route-isolation behavior. Then handle Today/timesheet/exceptions and separate configuration/attendance batches. Preserve exact-head review between bounded candidates; do not enable a telemetry destination or declare full WF-C10-011/C12 acceptance from these source fixes. The historical api_keys baseline remains on its own coordinated backup-owner evidence track.
