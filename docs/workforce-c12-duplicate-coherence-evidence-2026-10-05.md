# WF-C12-008 duplicate and workday coherence evidence

The read-only reconciliation kernel now rejects duplicate primary keys within
each of its seven ID-bearing row kinds before constructing lookups or results.
The error contains a finite row-kind name, never an identifier. Equal IDs in
different kinds remain valid because those references use separate lookups.
Export rows do not have a primary-key field in this snapshot contract.

An exception referencing an explicit workday, event or evidence must resolve
those subjects to the same workday. References to two workdays belonging to the
same employee produce one `EXCEPTION_SUBJECT_SCOPE_MISMATCH`; matching event and
transition evidence for one workday remains accepted. Inputs are not mutated,
and outputs retain identifier-free counts and `repair: NONE`.

The job implementation is unchanged. Its existing fail-before-commit behavior
is exercised by a duplicate page and by an incoherent exception page: each loads
one page, does not commit the cursor and does not load a second page.

## Applied source and bounded verification

Own PR584 root and independent release acceptance at main
`daf05b6030c89c4508f2a999706f4169360ccce2` preceded fresh fetch/API/remote checks
and ordinary integration on `codex/workforce-completion-part47` in the same
dedicated worktree. Three original draft recipes and five unique replacement
chunks were verified before application. The earlier preliminary source review
and both reader guards remain preserved; preliminary credit is not runtime
credit.

Only these application/test paths changed:

- `src/lib/workforce/reconciliation.ts`
- `src/__tests__/workforce-reconciliation.test.ts`
- `src/__tests__/workforce-reconciliation-job.test.ts`

The actual sequential Vitest run passed two files and 44 aggregate tests. It
includes ambiguity in all seven kinds, reversed input order, equal IDs in
separate kinds, three same-employee cross-workday cases, a coherent positive
case, privacy/input preservation and job cursor noncommit. Source-derived
individual counts of 35 kernel and nine job cases are not separate outcomes
from the quiet reporter. Scoped ESLint passed with 113 configured rules on
each of the three targets; none was ignored. `git diff --check` passed.
Precheck resources showed 18,115 MiB available RAM, 332 GiB free disk and memory
full-pressure avg10 0.00. Checks ran serially with one Vitest worker.

Durable application, bounded-check and current/base selected-catalogue JSON
receipts are under `docs/evidence/workforce-c12-duplicate-coherence-*`.
The finite catalogue covers four owned typed kernel/job/test paths and 13
selected typed paths. All bindings were derived from applied bytes and current
main; the older catalogue supplies path enumeration only. It is not a complete
dependency graph or a fresh compiler/runtime result.

## Limits and remaining acceptance

Exact-head independent source review, current required PR gates, whole hosted
compiler/suite acceptance and this successor's own normal merged-main release
are pending. Full compiler, full suite, build, browser, PostgreSQL, Android and
load verification are **NOT RUN locally**, under the Contabo host contract.
Prior PR584 compiler and Manager Today execution remain historical for this
candidate; applicable workflows must be derived from the current full diff.

No database reader, durable lease/version-fenced adapter, complete dependency
page closure, approval-chain page grouping, export delivery source, cron or
production reconciliation execution is implemented or accepted here. Schema,
migrations, shared job helpers, general update/delete, break policy, AGENT moves
and Route behavior are unchanged. Malformed ID validation and other broader
snapshot contracts are outside this bounded patch.

WF-C12-008 remains PARTIAL. Accounting remains 82/161 DONE, 79 non-DONE,
14/15 roadmap gates, C8 45% and overall 59%; no row closure or 100% claim.
