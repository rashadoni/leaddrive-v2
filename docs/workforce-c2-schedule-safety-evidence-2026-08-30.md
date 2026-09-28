# Workforce C2 — schedule/site safety evidence

**Task:** `WF-C2-009`
**Checkpoint:** pending commit on `codex/implement-hrm-plan`
**Status:** PARTIAL (publish/start/action safety slice)

## Delivered contract

The existing overlap/window/break validation is now supplemented by two
deterministic boundaries:

- A `SITE` segment can be published only when every referenced active site has
  the same signed IANA timezone as the v1 shift. Cross-timezone segment-local
  semantics are rejected until they are explicitly designed, rather than being
  silently evaluated in the wrong local time.
- On accepted START, every scheduled site must have an effective employee site
  eligibility assignment. The immutable schedule snapshot records the matching
  assignment facts alongside the site and geofence revision.
- An arrival/departure claim now needs both the current tenant segment row and
  a matching `SITE` segment in that employee's immutable workday schedule
  snapshot. A segment from another shift, a remote segment, or an old workday
  without a snapshot cannot be attached to the employee's attendance history.

These checks do not infer travel duration or whether travel is paid. A
multi-branch day still has to express travel deliberately; the compensation,
minimum travel and action-time impossible-travel policy remain dependent on
OD-09 and C4's review-only risk signal.

## Verification run in this worktree

- PASS — targeted Vitest: configuration management, schedule snapshot,
  transition facts and web/mobile START/sync paths: **7 files, 150 tests**.
- PASS — targeted ESLint and `git diff --check`.

## Explicitly not run

- NOT RUN — full build/browser E2E, Android and physical multi-site/device
  flow: heavy gates belong to CI or an approved worker.
- NOT RUN — database migration check: this slice stores additional JSON only;
  it adds no migration.

## Remaining work

`WF-C2-009` remains partial until a formally approved inter-site travel model
defines minimum travel, pay/expected-time treatment and action-time review.

## 2026-09-28 — action-time inter-site ordering completion candidate

The historical OD-09 blocker above is superseded by the recorded v1 owner
decision: explicit `TRAVEL` remains non-payroll and this release does not
calculate travel pay or expected travel time. The remaining backend boundary
is now implemented without inventing either value:

- an arrival into the second or later immutable `SITE` segment requires an
  earlier `DEPARTURE` for the exact previous scheduled `SITE` segment, scoped
  by tenant, employee and workday;
- the exact client-transition replay is resolved before schedule, predecessor
  or geometry reads. A missing predecessor returns a dedicated retryable
  conflict and writes no transition or audit, so out-of-order offline delivery
  can recover after the departure is accepted;
- the schedule parser accepts only the six versioned segment modes, requires a
  non-empty site exactly for `SITE`, rejects duplicate/malformed history and
  derives both the previous segment and previous site from immutable array
  order;
- when both immutable circle revisions exist, the server calculates a
  conservative edge-to-edge distance: great-circle center distance minus both
  radii, floored at zero. Missing or invalid legacy geometry produces no
  invented speed signal;
- the existing deterministic risk evaluator can mark an extreme transition
  `PENDING_REVIEW / IMPOSSIBLE_SITE_TRANSITION`, never reject it or assert
  guilt/presence. `DELAYED_CLAIM` remains the primary stored reason when both
  apply, while the audit retains only the safe impossible-transition code;
- coordinates, radii, distance and calculated speed are absent from the
  transition row, return value and audit payload.

The first author-independent preflight was RED only for one P2: unknown modes
and a non-`SITE` segment carrying a site were not yet rejected. The repaired
five-file runtime/test diff received replacement GREEN with
`P0=P1=P2=P3=0`: 26,207 plain-binary bytes / SHA-256
`4357fb9a5b90e83a849e73fdd77ecfe47d68b104c62858c3ce5cc1cc8a835edd`.

Verification on the repaired working tree:

- PASS — targeted Vitest: transition facts, snapshot parsing, risk signals and
  the multi-site scenario, **4 files / 25 tests**;
- PASS — scoped ESLint for all five changed runtime/test files;
- PASS — `git diff --check`;
- NOT RUN — full TypeScript, full suite/build and real PostgreSQL concurrency;
  these remain mandatory exact-head CI/heavy-worker checks;
- NOT RUN — browser, Android/Gradle, load, physical-device and human-pilot
  flows; none is required to validate this backend-only row.

`WF-C2-009` remains **PARTIAL** until the frozen exact-head PR passes mandatory
CI. On that evidence it can move to DONE without a browser or Android claim.
