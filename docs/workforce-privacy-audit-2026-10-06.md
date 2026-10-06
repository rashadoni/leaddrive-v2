# Workforce privacy audit: remaining route and authorization logs

Scope: PR589, parent `ef5d90010d9b317a493dfe7ae574b1863f3c83fb`, integrated
main `86cba428d39e3ce4be13245bdb8e34e49dccf8d4`. This is a source change and
bounded synthetic audit. Production collection, deployment and activation are
not part of this evidence. The eventual immutable candidate SHA and terminal
hosted checks are recorded separately in the evidence branch and PR body.

## Canonical criteria and exit decision

| Criterion | Advance in this candidate | What still prevents full acceptance |
| --- | --- | --- |
| WF-C10-011 — PLANNED | Completes the finite 4/9/33 direct-route inventory and seven inherited HRM auth-wrapper raw-error sinks. Adds source guards, actual-handler failure canaries and a consolidated boundary matrix. | Shared auth/RLS, Prisma audit fallback, Pino and Sentry source gaps; full transitive/client/driver coverage; verified dashboard, destination minimization, retention and access review. |
| WF-C12-002 — PARTIAL | Uses 53 fixed operation labels; exercises actual Workforce pull telemetry serialization to a synthetic sink, including 500 adversarial categorical tuples. | Tenant/version/principal cardinality and release-ledger aggregation across the full pipeline; collector ingestion, dashboard and approved paging/SLO delivery. |

The canonical ledger is unchanged: **82/161 DONE, 79 open, weighted 59%**.
WF-C12-008 remains PARTIAL. Neither a reduced console count nor passing local
canaries closes either canonical criterion. The finite three batches are
complete in this source candidate; do not restart them as repeated tiny
logging slices. Remaining work has named shared-system and operational
boundaries below. Independent C12 fault/fairness and C13 entitlement work need
not wait for production collector activation or the separate backup owner.

## Complete bounded change inventory

| Batch | Replaced calls | Route files | Failure behavior retained |
| --- | ---: | ---: | --- |
| Today / timesheet / personal exceptions | 4 | 4 | Today unavailable 503 and silent typed bounds; timesheet typed 409; approval private response headers; generic 500 elsewhere |
| Attendance administration | 9 | 8 | Typed404/409, MFA/session/entitlement gates, QR rate limits and generic 500 |
| Configuration | 33 | 21 | Typed400/404/409, bulk conflict preview data, fence P2021→503, unchanged success/replay behavior |
| HRM authorization wrappers | 7 | 1 | Capability versus grant503 responses, denial before handler, original synchronous/asynchronous failure boundary |

The machine-readable 46-route catalog is
[`workforce-privacy-routes.json`](../src/__tests__/fixtures/workforce-privacy-routes.json).
It binds each route/method to its fixed operation and injected service failure.
Seven additional operations are `auth-workforce-capability`,
`auth-workforce-schedule`, `auth-workforce-pilot-fence`,
`auth-workforce-retention`, `auth-workforce-employment`,
`auth-workforce-exception-queue`, and `auth-workforce-exception-decision`.

All changed sinks retain error severity. Existing request enrichment warning
severity is unchanged. The shared logger runtime still emits only `{operation}`;
this is a reviewed-callsite contract, not a runtime validator of arbitrary
JavaScript callers. Only unused catch bindings are removed. Typed catches still
inspect domain errors; specifically the existing fence `code` classifier can
inspect an unknown value. No guarantee that all possible hostile proxies or
`code` getters are never inspected is claimed.

The wrapper changes preserve `return handler(...)` versus `await handler(...)`.
An asynchronous downstream rejection must not become an authorization 503.
No transaction, authorization, domain audit, service call, success body,
rollback, permission, query, or activation behavior is intentionally changed.

## Consolidated boundary and destination matrix

| Boundary | Source and synthetic evidence | Acceptance limit / next dependency |
| --- | --- | --- |
| Owned routes, services, cron and HRM auth wrapper | Direct console use is confined to the two shared sinks. AST tests reject other console references, including direct console aliases, and inspect operation literals. The existing private evidence adapter is traced through both literal callers and checked against alias escape. | This bounded AST guard is not a whole-program taint proof: arbitrary dynamic import/require, helper aliasing, framework internals and external modules require their own review. |
| Shared auth / RLS | `with-rls.ts`, `api-auth.ts`, `auth.ts`: raw authentication failures; mobile rejection warnings can include an agent ID and pathname. | Cross-domain source fixes and synthetic identity/tenant-context regressions are required. No changes to these shared paths here. |
| Prisma / audit / database driver | `prisma.ts`: audit fallback logs identifiers and a raw error; RLS guard logs model/operation plus a stack. Base client has no explicit query logging configuration. | Absence of an explicit query logger is not proof that a driver cannot emit errors. Keep transactional audit rollback distinct from best-effort audit behavior. Shared source and driver tests remain. |
| Structured Pino logger | `logger.ts` lacks a general redaction configuration and can receive Error and identity context. No direct import from the reviewed Workforce surface was found. | This is an inherited exposure opportunity, not proof that every Workforce error reaches Pino. Shared transport and nested-error policy review remain. |
| Sentry server / edge / client / global errors | All three configs use `scrubDemoTokens`; request/global errors have capture paths. An independently executed pure synthetic event probe retained Workforce reason/coordinate/error/breadcrumb/context canaries while removing a demo bearer path. | Concrete sanitizer gap. No SDK/network call, DSN inspection or production leak claim. Replay text/media masking does not establish metadata privacy; composed hooks and mock transport/browser review remain. |
| Workforce UI / marketing analytics | No direct console/Sentry/gtag/logger sink found in scoped Workforce pages/components. The inspected Google Analytics component is referenced by the marketing layout. | UI-displayed server errors and global capture/replay remain separate boundaries. No unsupported assertion that GA receives Workforce data. |
| Mobile sync pull metrics | Real emitter → real JSON serializer → synthetic console sink: all nine results omit payload canaries; 500 invalid dimension tuples collapse to one safe tuple; sink failure is contained. | Source-to-synthetic-sink evidence only. Tenant HMAC remains pseudonymous; syntactically valid APK versions are not a release allowlist. Numeric measurements are not categorical labels. No production collector/cardinality closure. |
| APK census / GPS / media | Source audit: census contains principal HMAC, version/build correlation; GPS/media do not have the same complete runtime dimension mapping as pull telemetry. | Pseudonymization does not imply anonymity or low cardinality. Broader MTM owner and destination aggregation review are needed; the historical MTM fixture is unchanged. |
| Log files / rotation / archival destination | Source-only review: PM2 stdout/error files; daily logrotate with 14 rotations; shipper includes app/nginx/Postgres logs and requires at least 400 days encrypted retention; hourly timer configuration. | Live installation, contents, access, approved retention, ingestion and historical handling were not inspected. No backup, deletion, export, timer or collector action was performed. Encryption is not minimization. |
| Data classification / dormant operational health | Seven Workforce classes prohibit general telemetry. Existing aggregate roster-health contract stays dormant. | Metadata declarations alone do not enforce every sink or establish collection/dashboard/paging delivery. |

Independent boundary receipt and pure-probe originals are preserved in the
immutable evidence archive. These are source exposure findings and synthetic
results, not observations of real production data or active destinations.

## Executed validation and exact scope

- 202 actual-handler cases: four synthetic thrown-value factories for each of
  46 routes (184), plus 18 typed status/preview preservation cases. Handlers and
  shared logger are real; auth wrappers, schema acceptance, services and Prisma
  are mocked to reach the intended boundary. Separate existing domain suites
  exercise validation, authorization, persistence contracts and success paths.
- 35 real HRM-wrapper cases: 28 private lookup failures plus seven downstream
  asynchronous rejection checks. Outer RLS/session setup and Prisma are mocked;
  this is not live authentication or database evidence.
- 11 telemetry cases, including the 500-tuple synthetic run, and three source
  guard cases. No production endpoint or collector is called.
- Final broad Workforce/domain/capability run: **2307 PASS, zero failures,
  163 SKIP**, across 265 test files. Targeted lint passes. Skipped opt-in suites
  are itemized in the evidence; they are not credited as executed PostgreSQL tests.
- Initial broad test run had 2306 PASS, one new source-guard failure, 163 SKIP.
  The guard incorrectly required a direct literal at an existing private
  two-caller adapter; it now verifies that finite forwarding chain. The failed
  original and the successful follow-up are retained, not relabeled as green.

## Compiler findings without baseline masking

Expanded production compilation initially found 26 diagnostics in the parent
and candidate: 20 TS7006, two TS2347, one TS2352 and three TS2737. The three
TS2737 diagnostics are in owned HRM `play-integrity.ts`; `0n`, `1_000n`, `-1n`
were changed to equivalent `BigInt(0)`, `BigInt(1_000)`, `BigInt(-1)`. Bigint
semantics remain unchanged, including the negative unsupported-version
sentinel. Actual Play Integrity and decoder regressions are run.

The resulting production compile still exits2 with 23 historical diagnostics:
four TS7006 in the two touched security-triage/personal-exceptions routes and
19 in transitive HRM services. File/code/message comparison to the same parent
scope finds no new diagnostics and exactly the three removed TS2737 entries.
These existing typing issues are not hidden or called a clean compile.
The test-inclusive scope additionally reaches the two historical MTM mock
`1n` literals at lines 482/483. That foreign fixture is intentionally unchanged.
Repository ES2017 target, Prisma implementation and all compiler/test baselines
are unchanged. Hosted mandatory gates remain required for the new exact SHA.

No Support paths, credentials, permissions, migrations, canonical statuses,
merge, deployment or production activation are changed.

## Subsequent bounded follow-up

The [fault/fairness matrix](./workforce-c12-fault-fairness-matrix-2026-10-06.md)
records the later PR594–596 integration and auxiliary GPS/media/census runtime
normalization, including primitive-string protection against object coercion.
The counts and source-gap table above describe the earlier 8053 checkpoint.
Its original receipts remain unchanged; shared sinks and operational privacy
acceptance remain open under the same canonical statuses.
