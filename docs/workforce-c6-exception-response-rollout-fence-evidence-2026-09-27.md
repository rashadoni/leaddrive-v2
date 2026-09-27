# Workforce C6 employee-response rollout fence evidence — 2026-09-27

## Scope and task effect

This bounded server-only slice closes one rollout mismatch in the existing C6
exception workbench. The employee self-response GET/POST channel already fails
closed unless the tenant has `workforce-exception-response-v1`, but the manager
queue could still issue a `REQUEST_EMPLOYEE_RESPONSE` action token and the
decision writer could consume it without that flag. That could move a case to
an employee-response waiting stage while the employee channel remained
unavailable.

The repair narrows WF-C6-002 and WF-C6-006 from `PARTIAL` to a safer
`PARTIAL`. It does not complete either task and adds no task or phase-gate
credit. Progress stays `81/161`, `14/15`, C5 81%, C6 20% and C9 99%.
WF-C8-005 and the visible UI are unchanged.

## Fail-closed contract

- One pure rollout predicate requires the explicit tenant flag only for
  `REQUEST_EMPLOYEE_RESPONSE`. `ACKNOWLEDGE`, `REQUEST_TIME_CORRECTION` and the
  still-inactive terminal codes retain their existing lifecycle treatment.
- The scoped queue filters server-derived decisions through that predicate
  before it mints an encrypted action token. An absent, malformed or unrelated
  feature set therefore cannot produce an employee-response request token.
- The manager write service applies the same predicate during its tenant-mode
  preflight before any case or grant lookup. A token issued before flag removal
  is only a locator and returns the existing generic unavailable response.
- The service rereads tenant features after the case and operation advisory
  locks and before any new append. Removing the flag while a writer waits
  raises the existing generic lifecycle conflict and creates no decision.
- The employee self-response channel remains session-only, self-scoped,
  workday/case-bound, rate-limited, rollout-gated and protected by the existing
  database ownership trigger. This slice does not alter its payload or expose
  proof, reason, time, case identifiers or another employee's data.

The queue continues to offer correction review without the response flag, and
the released frontend still hides `REQUEST_EMPLOYEE_RESPONSE`, terminal and
unknown actions. No employee notification or durable outbox is claimed.

## Current verification

- PASS — core rollout/API selection: three files / 27 tests. Coverage includes
  absent/malformed/unrelated flag states, active rollout, queue token filtering,
  exact token binding, preflight rejection and flag removal after lock
  acquisition with no append.
- PASS — adjacent employee-response/workbench selection: five files / 32 tests.
  Existing self GET/POST rollout, response writer, rate limit, ownership and
  lifecycle behavior remain green.
- PASS — targeted ESLint for all six changed runtime/test files.
- PASS — diff whitespace check.
- The commands used the existing exact-lock dependency tree whose
  `package-lock.json` SHA-256 is
  `54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`;
  its temporary symlink was removed after every command.
- NOT RUN on Contabo — full local typecheck/build, browser E2E, Android/Gradle,
  load, physical-device and human-pilot checks. Exact-head CI, the real
  PostgreSQL shared-lock gate and a fresh author-independent complete-diff
  review remain mandatory before merge.

## Release boundary

This slice adds no schema, migration, RLS policy, UI, translation, notification,
tenant activation or terminal transition. It does not assert that an employee
was notified, responded or acknowledged anything. The branch must stay below
400 KB, receive a zero-finding independent frozen review, pass every required
exact-head check and use only the normal GitHub `main` deployment path before
production claims are made.

## Independent read-only preflight GREEN

An author-independent reviewer inspected the complete working snapshot from
base `316caedc933407589aa5f7a5acffb86aed267b15`: nine paths / 34,671 combined
tracked-plus-untracked binary-patch bytes, SHA-256
`77ca058977501c0abe839a401116db46564e571bb9f697d2cfb9f43da4d2672e`.
The verdict was GREEN with zero P0-P3 findings.

The review confirmed that the queue cannot mint a response-request token when
the flag is unavailable, a crafted or previously minted token fails before
case/grant lookup, and a flag removal visible at the post-lock reread prevents
a new append. ACK/correction, tenant/principal token binding, exact replay and
generic 404/409 containment remain sound. The residual `READ COMMITTED`
micro-window after the final organization read is the existing authorization
model; this evidence does not describe the flag as a linearizable emergency
kill switch.

Reviewer-side diff/whitespace checks and the pure helper suite (3/3) passed.
Reviewer-side API suites were `NOT RUN`: external dependency resolution stopped
before collection and no author result was relabelled. This was an uncommitted
preflight only; the receipt changes the snapshot, so a clean checkpoint and a
fresh frozen complete-diff review remain mandatory.

## Frozen complete-diff review GREEN

The clean frozen identity was exact base/current `origin/main`/merge-base
`000eb2532402cf4860afcb270ea8bfac6a6796d0` through head
`6268f618a027e33beec1ca700a8fe3454eccf0e7`: 10 paths / 44,535 binary-diff
bytes, SHA-256
`c215ff2555c734ddacfc57aee1c2629e686a1d6e436d13aeedc2d11628e44fce`, below
400 KB. The author-independent reviewer recomputed the identity and clean
status at both ends, reread the complete diff from zero and returned GREEN
with zero P0-P3 findings.

The review covered the inherited PR #461 release receipt plus every runtime,
test and current evidence path. It confirmed filter-before-mint, rejection
before case/grant lookup, the post-lock mutable flag reread before a new
create, no-new-append exact replay, tenant/principal/revision token binding,
generic 404/409 containment, unchanged ACK/correction behavior and honest
READ COMMITTED boundaries.

Reviewer-side identity/clean checks, diff whitespace, append-only prefix
integrity, pure-helper Vitest 3/3 and live PR #461 merge/check receipt passed.
API Vitest, targeted ESLint, full typecheck/build, the real PostgreSQL gate,
browser, Android, load, physical-device, pilot and repeated deploy/public smoke
were `NOT RUN` reviewer-side and are not inferred. Only this evidence file,
the roadmap and append-only session log may change after the verdict; an
independent receipt-integrity check must prove all six reviewed runtime/test
blobs unchanged before push.
