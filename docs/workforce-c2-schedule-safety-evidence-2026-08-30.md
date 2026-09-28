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

## 2026-09-28 — frozen integration review GREEN

Implementation/evidence checkpoint `6974b5ced4ad41097c5d08ae1de6b203c90e36e8`
was first reviewed cleanly from deployed main. While that review ran,
`origin/main` advanced through PR #485 only in three unrelated MTM map/period
paths. A normal conflict-free merge produced clean integration head
`4c3121ac4f042acca92bd6ebbb484209f10c4046` with exact current base and
merge-base `8de4e7e7c952740644ee8eb0755f680b949ddcbf`.

Fresh author-independent integration review returned GREEN with
`P0=P1=P2=P3=0`. The exact PR diff is 9 paths / 42,937 plain-binary bytes /
SHA-256 `4a65114f08790df5fc9128abe2a5b256f0329725558204136f31e40849eac0a5`.
The five runtime/test paths remain byte-identical to the repaired preflight:
26,207 bytes / SHA-256
`4357fb9a5b90e83a849e73fdd77ecfe47d68b104c62858c3ce5cc1cc8a835edd`.
All four documentation paths are append-only, and the merge commit adds no
manual conflict resolution or unrelated path to the PR diff.

Reviewer verification repeats 4 files / 25 tests, scoped ESLint and exact-range
whitespace. Full TypeScript, full suite/build and real PostgreSQL integration
remain `NOT RUN` until exact-head CI. WF-C2-009 remains **PARTIAL** and no
acceptance credit is added before those mandatory checks pass.
