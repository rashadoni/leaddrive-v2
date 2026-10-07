# C12 bounded sweep: staging preparation

This is an execution/acceptance plan for the dormant composition, not an
activation record. PR589 is the sole cumulative candidate. Do not start a
production scheduler, merge, deploy, change credentials or change permissions
from this plan. Those actions require their own scoped authorization. Preserve
historical acceptance records and bind any new result to its actual source SHA.

## Prepared executable fixture

The opt-in suites are `src/__tests__/workforce-reconciliation-sweep.test.ts`
and `src/__tests__/workforce-reconciliation-export-audit.test.ts`. They accept
only separate disposable PostgreSQL databases on `127.0.0.1`, named
`hrm_reconciliation_sweep_test` and `hrm_export_audit_test`, respectively.
A local ephemeral PostgreSQL 16 container can supply both databases. Pass test
URLs through the two corresponding `WORKFORCE_*_TEST_DATABASE_URL` environment
variables without printing them. These suites create selected-column fixtures
and the export suite creates its test-local reader role; never point them at a
production, shared or retained database. A rerun needs fresh databases.

Run both files through the repository's existing Vitest configuration with
`VITEST_MAX_WORKERS=1` and a JSON reporter. Store only the sanitized assertion
report, test counts, exact source hashes and command exit codes as evidence.
Remove the disposable container, volumes and temporary credential material
when finished. Neither standard hosted CI nor a skipped opt-in suite proves
that PostgreSQL cases ran. No workflow-dispatch capability is needed for this
fixture, and no workflow/protection/baseline change is part of this slice.

## Production-like staging gates, still open

| Gate | Concrete preparation / execution requirement | Acceptance evidence |
| --- | --- | --- |
| Schema and visibility | Use an explicitly authorized isolated database with the candidate's complete migration history, production-shaped indexes and synthetic data. Use existing approved reader authorization; do not alter RLS or grant production access. | Source/migration identities, finite visibility results for allowed/foreign tenants, selected-column compatibility. Never database URLs or raw records. |
| Query cost | Inspect plans on synthetic near-limit and over-limit tenants, including C-collation keyset scans, audit OR selection, snapshot joins and effective assignments. The present per-statement timeout is five seconds and full transaction timeout thirty seconds. | Sanitized plan summaries without parameter values, rows/pages, latency and refusal counts. Verify deployment-specific resource budgets rather than inferring them from transfer limits. |
| Complete traversal | Exercise all eight source families, exact-page boundaries, roots without parents, complete revision groups, repeated exports, lower-key/backdated inserts and changed rows during reads. | Current MVCC snapshot consistency and next-invocation detection; zero business writes and no checkpoint on mismatches. |
| Supported size | Prove 1,000/1,001 rows, 1 MiB/kind, 4 MiB total, 4 KiB/audit, 64 KiB/schedule and 100/101 segment-case limits. | Whole-sweep refusal, finite diagnostics, retained previous progress. Larger tenants require a new streaming-closure design before activation. |
| Lease and recovery | Use the existing lease protocol with a unique owner token. Exercise expiry/takeover during reads, waiting writers, competing cursor versions, transaction finalization failure and lost commit acknowledgement. | No successful checkpoint after incomplete reads or a lost fence; safe full replay after uncertain acknowledgement. |
| Tenant scheduling | Define an authorized eligible-tenant source, fairness policy, retry/backoff and starvation detection. The current global opaque cursor contains no tenant ID or coverage position. | Reviewed deterministic selection/revisit behavior and tests. A single-tenant MATCHED result cannot satisfy this gate. |
| Operations | Prepare finite metrics for success/mismatch/refusal/fenced-out/unknown outcome, timeout alert thresholds, pause/resume and support ownership. Do not expose source IDs or raw payloads in diagnostics. | Reviewable dormant wiring and synthetic operational tests, followed by separate activation approval. |

The current implementation has no scheduler or endpoint caller. A future caller
must supply an authorized reader, selected tenant and active lease, and treat
`MATCHED` with `COMMITTED` as one completed visible-tenant sweep only. It must
not treat `FENCED_OUT`, `VERSION_EXHAUSTED` or an unknown commit outcome as a
successful coverage receipt. Resume means a new full snapshot, not continuation
of a previous row key. Use the documented hard limits when determining tenant
eligibility; silently dropping large tenants is not an acceptable fairness plan.

Schedule-only verification uses today's visible effective timeline. It does
not establish the assignment/default selected when an old no-show case was
created. Pinned linked-workday schedule hash/membership validation does not
replace full calendar/site semantic validation. Export audit presence records
a prepared/audited download, not delivery to the client. Preserve these limits
in staging acceptance and any future operational UI.

C12-008 stays PARTIAL. The next implementation dependency is reviewed tenant
selection/fairness and dense-tenant strategy; production-like schema/RLS and
query-plan evidence remain operational prerequisites. No release approval is
needed to finish further dormant code or synthetic tests within the existing
HRM scope. Release and activation are separate decisions after concrete review.
