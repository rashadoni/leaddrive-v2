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
