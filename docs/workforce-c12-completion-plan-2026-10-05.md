# WF-C12-008: remaining acceptance and bounded release route

This plan implements the existing claim/event/assessment/exception/approval/export
reconciliation task. It does not add HRHub features or authorize activation.
Baseline: main `60ccd403fa172f2fafda31a9d4728c32933d4058`; dormant cursor
candidate `71433bf827ace3855dedb2bc76942c62867ee4de`. Ledger remains
82/161 DONE, 79 non-DONE, weighted 59%; C12-008 PARTIAL.

## Remaining criteria and what closes them

| Criterion | Current evidence / gap | Concrete acceptance required |
|---|---|---|
| Pure snapshot integrity | PR585 rejects duplicate IDs and inconsistent subjects; independently reviewed and tested. | Preserve finite identifier-free diagnostics, no fact repair, bounded input, and no cursor advancement on mismatch. Release the accepted source once, through the cumulative candidate below. |
| Durable cursor ownership | PR588 supplies a dormant owner/expiry/version CAS with actual local PostgreSQL race tests. | Compose the job with this store so each page commits the exact observation; loss/expiry/ABA/crash tests must demonstrate no skipped page. Existing generic value-only CAS is not sufficient. |
| Complete approval revision groups | This slice adds an actual single-statement database reader for a selected exact tenant/employee/period group. Ancestors and successors are included; missing root, >1000 revisions and >1 MiB JSON refuse the group. | Current bounded criterion: real PostgreSQL scope, UTC, RLS, overflow and job no-commit proofs. Full criterion still needs group enumeration, scan-wide snapshot/cutoff policy and batching without splitting a group. |
| Complete claim/event/transition/evidence/assessment/exception dependency pages | Kernel consumes supplied snapshots; no current database adapter establishes their completeness. Historical roadmap references to a scheduled scanner do not establish implementation of this adapter. | Implement authorized tenant-scoped keyset root scans for every source kind, including independent orphan roots. Resolve all cross-page forward/reverse dependencies and schedule-only segment/date ownership. Refuse overflow before commit; never treat an omitted dependency as an absent database row. Test missing/cross-tenant/cross-agent dependencies and page boundaries on PostgreSQL. |
| Stable scan and runtime composition | No runtime caller for the new reader or cursor store. | Define versioned opaque progress without employee/tenant payloads; stable cutoff/revisit policy for late dependencies; bounded per-tenant selection and fairness. Compose a supplied authorized transaction reader + pure kernel + lease/version cursor. Prove crash-before/after-commit, replay, takeover, expiry and late append behavior. No route or schedule required to test the composition. |
| Export source coverage | `timesheet/approvals/[id]/export/route.ts` persists `mtmAuditLog` action `WORKFORCE_TIMESHEET_APPROVED_EXPORT_VIEWED`, entity `workforce_timesheet_approval`, metadata kind `workforce_timesheet_export`, approval ID/revision/hash pair and `SESSION_DIRECT_DOWNLOAD` before returning the response. | Next bounded slice: validate and project only these durable audit records into export references, join complete approval groups, and independently scan orphan/malformed references. Exclude IP/user-agent/purpose and other audit payload from results. Label this prepared/audited direct-download coverage; it cannot prove network receipt. Delivered external exports need a separate accountable receipt source if such delivery is introduced. No payroll/HRIS delivery is inferred. |
| Operational/staging proof | No current read-only worker deployment/schedule/alert acceptance. | Run the composed worker against an isolated production-like schema with synthetic fault/orphan/replay cases, finite metrics, unchanged fact hashes, bounded query plans and zero-loss accounting. Establish the scheduler/monitoring dependencies of C12-006. C12-003 load and C12-009 rollback remain their own gate work. |
| Release / activation | Source and test preparation authorized; merge/deploy/activation explicitly withheld. | Parent obtains scoped release approval for the concrete cumulative source below. Revalidate fresh main, exact head and five Actions checks, then normal main/deploy route under that approval. Runtime wiring, tenant capability/grants, production cron or security changes require their own explicitly scoped authorization; releasing dormant helpers does not authorize them. |

## Current implemented slice: complete selected approval group

`readWorkforceReconciliationApprovalGroup` accepts an already authorized client
and exact scope plus a selected root ID. One parameterized SQL statement reads
every visible revision in that group, ordered by revision/ID. It does not limit
the group to revisions at or before the root. SQL refuses payload aggregation
when the sentinel count, serialized UTF-8 approval-array JSON budget, or root
membership fails. The 1 MiB bound includes array delimiters/separators, not the
small SQL result envelope. No compressed-storage or JavaScript character-count
substitution is used.

DATE and TIMESTAMP(3) values become UTC `Date` values expected by the existing
kernel. Corrupt revision, supersedes and hash values are retained for that
kernel, which keeps the cursor uncommitted. RLS is inherited from the injected
client; no bypass/role/configuration is installed by production code. Database
errors become a finite identifier-free code. The returned approval payload is
internal protected data, not a diagnostic or HTTP response.

Completeness means visible rows in one statement's MVCC snapshot. This is not a
whole-database scan, a stable multi-page snapshot, or proof that an RLS policy
exposes every row the maintenance task needs. The future caller must establish
the authorized reader context and root coverage. An oversized group remains an
explicit refusal; silently splitting it is forbidden.

Initial validation: 14/14 tests passed, zero skipped: two input/error guards and
12 actual disposable PostgreSQL16 cases. The database uses minimal operational
DATE/JSONB/TIMESTAMP fixtures, an isolated read-only RLS role, and a second
connection for concurrent append. Cases cover ancestors/successors, exact scope,
absent/foreign roots, parameter binding, repeatable-read visibility, non-UTC
session timezone, 1000/1001 rows, UTF-8 overflow, read-only fact hashes, and the
existing job's MATCHED/MISMATCH/overflow cursor decisions. Scoped lint and diff
checks pass. Final compiler and independent review identities are recorded in
the slice receipt; this paragraph does not pre-claim them.

## One release candidate, no duplicate merges

| PR / source | Role | Future handling |
|---|---|---|
| PR585 `8a243909` | Original three-file kernel fix plus evidence, frozen. | Keep as source-review history. If the cumulative candidate is released, do not also merge this duplicate source. |
| PR587 `ad8cc2ce` | Validation-only integration of PR585 with main after Support578. | Its five checks and Manager Today artifact are exact-head evidence. Do not separately release it after the cumulative candidate. |
| PR588 `71433bf8` | Narrow stacked dormant cursor-store draft. | Preserve its exact-head review. Its source is already in PR589; do not also merge it after the cumulative release. |
| PR589, originally `71433bf8` | Existing cumulative main-target validation PR. | Reuse this PR as the single cumulative release candidate after adding the reviewed approval reader. Update title/body and run fresh mandatory gates for the new head. Old green checks are not inherited as new-head execution. |
| New narrow approval-reader draft | Three-path slice stacked on PR588's exact source. | Review surface only; its same source commit is carried by PR589. Do not merge both. |

No additional validation PR is needed. No existing PR is automatically merged,
closed or retargeted by this plan. The parent can approve one concrete dormant
release containing the kernel guard, cursor store and complete-group reader;
none starts a scheduler or changes a user permission.

## Next implementation order and accounting

1. Accept the selected approval-group reader with source-bound PostgreSQL tests.
2. Add the existing direct-download audit projection and orphan export checks.
3. Add tenant-scoped source enumeration and complete dependency closure, using
   these two readers; establish scan cutoff/revisit semantics.
4. Compose the bounded worker with lease/version cursor and exercise isolated
   crash/replay/lease/late-append scenarios.
5. Obtain the applicable scoped release/operational approvals, then perform the
   staging/scheduler/monitoring evidence required by the roadmap.

Successful steps 1-4 can close explicit implementation subcriteria and should
be recorded as such. They do not independently close the C12-008 row while
runtime/staging/export coverage remains incomplete. Update the row only when
its stated acceptance is met; do not require a globally clean unrelated
compiler or suite. New selected source receives bounded all-family typecheck;
the existing five hosted gates retain their normal baseline contract. Global
nonclean status and unavailable full diagnostic identities stay qualified.
