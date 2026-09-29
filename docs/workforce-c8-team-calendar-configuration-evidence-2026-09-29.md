# WF-C8-007c future team calendar configuration evidence — 2026-09-29

## Claim boundary

This slice extends the released forward-only Workforce calendar surface with
one named team scope. It does not complete `WF-C8-007`, change a roadmap row
to `DONE`, or add a production-readiness gate.

Included:

- exact `ORGANIZATION` or `TEAM` scope selection under the existing
  `SCHEDULE_READ` / `SCHEDULE_WRITE` boundary;
- a tenant-bound active-team directory, bounded to 100 named results with an
  explicit truncation signal and server-side name/code search;
- selected-team context that can retain a same-tenant inactive team for
  read-only continuity while preventing any new write for it;
- exact team-only future list and create behavior, with organization and
  employee rows excluded;
- the shared organization/date advisory lock, exact-state replay, conflict
  behavior and in-transaction actor audit used by the released organization
  writer;
- responsive localized organization/team selection and request-race fencing.

Excluded:

- employee scope, moved-day pairs, update/delete/rollback and historical
  repair;
- leave, proof-policy, version-diff and break-policy authoring;
- schema or migration changes and any Route UI/API change;
- browser/AT/contrast/zoom/device acceptance, Android/Gradle, load/chaos,
  signed-device and tenant-pilot evidence.

## Tenant and ledger safety

The team directory always predicates `MtmTeam` by the authenticated
`organizationId`. Search results include active teams only, return names and
optional codes alongside the stable team ID required for subsequent scoped
requests, use `take: limit + 1`, and report `hasMore` rather than silently
truncating. A separately selected team is looked up inside the same tenant so
an existing inactive selection can remain visible; cross-tenant and missing
selections are indistinguishable.

TEAM creation revalidates `{ organizationId, id, isActive: true }` inside the
write transaction after taking the same organization/date advisory lock as an
organization write. The query then reads only the selected team row and the
organization row for that date, both with `agentId: null` and `deletedAt:
null`. This serializes organization/team baseline decisions and leaves the
existing partial unique indexes as the concurrent backstop.

The retained calendar remains a shared Route ledger. An organization write
derives `routePlanningAllowed` from the independent weekday/weekend baseline;
its existing row cannot become its own replay baseline. A new team row inherits
only a pre-existing organization decision for that date. The HR kind still
does not silently redefine Route eligibility. Source remains the established
`ADMIN`; Workforce provenance and named team context are recorded in the
atomic audit metadata.

## API and UI contract

- `GET /api/v1/workforce/configuration/calendar` strictly parses scope and
  optional team ID, keeps the future range at 1–367 days, and lists only the
  selected scope. A same-tenant inactive selected team remains readable for
  continuity; missing and cross-tenant selections produce the same not-found
  contract before calendar rows are listed.
- `POST` accepts a team ID only with `scope: "TEAM"`; organization input cannot
  smuggle a team. It returns the safe team ID/name/code summary and
  date/kind/name day summary without the calendar-row ID, source, actors or
  Route fields.
- A missing, inactive or cross-tenant team write target uses the same 404
  domain response. Exact replay creates no second row or audit; a different
  state and unique collision fail closed.
- The client shows named organization/team scope, an explicit bounded-search
  warning and inactive-team read-only state. Unknown POST outcomes retain the
  released honest refresh/replay wording.
- GET requests use an AbortController plus monotonic latest-request fence so
  a slower old scope/team/search response cannot overwrite or finalize a newer
  load. All six mutable selection/draft controls are disabled while POST and
  its reconciliation GET complete, preventing an old mutation completion from
  replacing a newer selection or clearing newer input.

## Independent pre-review findings and remediation

The first read-only pre-review returned `P0=0, P1=0, P2=2, P3=0`:

1. organization replay incorrectly fed the existing organization row into
   its own Route baseline, allowing a legacy opposite planning flag to look
   exact;
2. concurrent scope/team/search GETs had no latest-request fence.

Both were corrected and pinned by regression tests. A second pre-review
confirmed those fixes and found one further P2: the form remained mutable
during POST, so an old completion could abort the new selection load and erase
new input. All selection/draft controls are now frozen through reconciliation,
with a source-contract regression covering all six controls.

The final uncommitted-diff pre-review is GREEN with `P0=P1=P2=P3=0`. This is
not the required frozen-head approval; a fresh full-range review of the exact
checkpoint commit remains mandatory before push or PR.

### First frozen-head review P3 and remediation

Full-range review of exact clean head
`0ba46fa7b72443c8bc63304f8ae5c88fabf7a3c7` returned
`P0=0, P1=0, P2=0, P3=1`. Runtime, tenant/auth boundaries, locking, baseline,
idempotency, audit, request races and append-only prefixes were green. The P3
was evidence-only: the text incorrectly implied team summaries omitted their
transport ID and that GET rejected a same-tenant inactive selected team.

The contract above now states the implementation precisely: active directory
items expose team ID/name/optional code; a same-tenant inactive selected team
remains GET-readable for continuity; GET uses the same 404 for missing and
cross-tenant selections; POST uses the same 404 for missing, inactive and
cross-tenant targets; calendar-row IDs and storage provenance stay omitted.
The rejected head is not eligible for approval. Runtime/test/i18n bytes are
unchanged and a new exact-head review is required.

## Author verification

PASS on the current implementation tree:

- focused domain/API/UI files: 3 files / 32 tests;
- broader calendar/resolver/navigation set: 6 files / 97 tests;
- Workforce authorization wrapper: 1 file / 30 tests;
- RLS route-context coverage: 1 file / 3 tests;
- affected voice guide/navigation evaluation: 4 files / 21 tests;
- scoped ESLint on all changed TypeScript/TSX implementation and tests;
- `npm run i18n:check`: EN source 23,857 leaf keys, RU/AZ missing 0 and extra
  0;
- `git diff --check`.

NOT RUN under the Contabo workload-placement contract:

- full repository typecheck, production build and full test suite;
- real PostgreSQL concurrency injection;
- browser, assistive-technology, contrast, zoom and physical-device checks;
- Android/Gradle, load/chaos, signed-device and tenant-pilot gates.

Exact-head GitHub CI and the fresh author-independent frozen review remain
required before merge.

## Roadmap accounting

`WF-C8-007` remains `PARTIAL`: organization and named-team future create/list
are implemented, while employee and moved-day workflows, update/delete
governance, break-policy authoring and real browser/AT evidence remain open.
Progress remains `DONE 81/161`, `GATES 14/15`, C8 36%, overall 59%, with 80
non-DONE rows.

## Frozen-head independent review GREEN

Fresh author-independent full-range review returned GREEN with
`P0=P1=P2=P3=0` on exact clean head
`2ed08b6dc4c2e82e797004effa8530ad44e19d8c` against live main/merge-base
`b25b4f382ebc8d323b0e975ccf34aee1731379f7`.

- Full identity: 15 paths / 117,683 bytes / SHA-256
  `76de83da90a744dee5843a157b5886dff2e5c4fee634180570af22ece1683770`.
- Non-doc implementation identity remained byte-identical: 11 paths / 94,369
  bytes / SHA-256
  `88fb46ce11f08978765c4406df6278f8a954f0f14a42daddd1679839f5b212dd`.
- The prior evidence P3 is closed. Directory/team transport IDs,
  same-tenant inactive GET continuity, GET versus POST not-found boundaries
  and omitted calendar-row/provenance fields now match runtime exactly.
- All historical append-only prefixes and both remediation prefixes matched
  byte-for-byte. Current-head focused regression passed 32/32; the unchanged
  implementation retained the independently verified 97 calendar, 33
  auth/RLS, 21 voice, ESLint and i18n 23,857/0/0 results.

Full typecheck/build/suite, real-Postgres concurrency, browser/AT/device,
Android/Gradle, load/chaos, signed-device and tenant-pilot remain `NOT RUN`.
This review adds no completion or gate credit. A final receipt-integrity check
must confirm these reviewed implementation bytes are unchanged before push.

## PR #502 production release receipt

Final head `8d58b217f32ea458b140e8c6a6dfdef5e4c7420a` preserved the independently
GREEN 11-path implementation identity byte-for-byte. Required exact-head
contexts `pr-scope`, `static-checks`, `typecheck`, `runner-policy` and `scan`
all passed; the scope-derived production-build PR job was correctly skipped.

PR #502 merged normally at `2026-09-29T16:09:09Z` as main
`01f5069a732a4879a453c918bca8a52864999401`. Deploy run `36595610621`
completed quality/security, SHA-bound standalone build and artifact
publication, immutable staging, atomic production deployment, scheduler and
tenant-isolation verification, built-in public smokes and artifact-retention
cleanup.

Independent no-cache TLS requests pinned `app.leaddrivecrm.org` to the only
approved production IP `13.140.132.245`:

- `/api/v1/ping` returned HTTP 200 with `{"ok":true}`;
- `/api/v1/public/build-info` returned HTTP 200 with exact
  `artifactSha=01f5069a732a4879a453c918bca8a52864999401` and
  `builtAt=2026-09-29T16:15:50Z`.

Release used only GitHub `main -> .github/workflows/deploy.yml` to
`/opt/leaddrive-v2`. No direct production mutation, worktree copy, Azure,
retired host or retired owner was used. `WF-C8-007` remains `PARTIAL`; no
task/gate credit changes.
