# HRM employee cross-tab session verification — 2026-10-10

## Continuity and authorized scope

The user requested autonomous HRM continuation, including verified ordinary
merges and GitHub Actions releases. Existing work is retained: PR678 merged as
32a699a5602a396118c1d8ed7d65c52631a65cfc, with the exact previously reviewed
whole tree and parents. Its normal deployment38034058015 and main compiler
38034057984 are still running at this entry; no production acceptance claimed.

This clean Contabo worktree is based on that exact main merge, branch
codex/hrm-employee-session-transition-20261010. Origin is
https://github.com/rashadoni/leaddrive-v2.git. Production is the registered
13.140.132.245:/opt/leaddrive-v2; releases use reviewed main and deploy.yml.
No Mac sessions, local builds, dependency installation or browser runs.
Canonical dirty checkout, the frozen PR678 branch and other worktrees remain
untouched. Root is the only HRM source writer; release reviewer is read-only.

The inner mine component depends on organizationId, but the enclosing
DashboardShell already keys MotionPage by organization/user/role. That is
material counterevidence against an inferred same-tenant stale-data bug.
Canonical runtime cross-tab behavior is NOT RUN; no disclosure or app fix is
claimed from source inspection.

Bounded next step: extend the existing disposable GitHub browser rehearsal with
two live pages sharing canonical Auth.js cookies, actual header sign-out,
observed-tab cleanup, and real MFA authentication of another employee in the
same organization. Observe the actual provider's session refresh; do not spoof
cookies, inject a session/broadcast, reload the observed tab, hide DOM or alter
CSS. Require a populated first scope and a successful second own-only API/UI
projection, with bounded DOM observations and unchanged business facts.
Preserve all original matrix/native/ACK/retry/RLS/database checks. Review the
new source and run exact-head hosted checks; initial failures remain immutable.

This is CI evidence work. Product auth, roles, grants, API, rollout, schema,
Support and production remain unchanged. No personnel decision or correction
submission. Approved C6 outcomes, immutable audit, CASE_RECORDED_AT and empty
sample semantics remain retained. C6-006/C12 stay partial and C14 stays open;
accounting remains 85/161 done, 76 open, weighted61%. Real devices, human AT,
restored-copy/full replay and operations are not replaced by synthetic tests.
606/609, validation-only646 and archive663 must not be merged.

Current result: source preparation only. Last completed action: clean worktree
from reviewed main M and parent-shell inspection. Stopping point: before new
runtime proof, while PR678 release is running. Next: implement/review this
bounded rehearsal, finish exact-M release acceptance, then publish/run the new
exact-head CI without weakening any existing gate.

## First additive source checkpoint prepared

One canonical cross-tab case now uses two real pages/context, actual header
sign-out and real credentials/MFA/nonce consumption. The observed tab has no
imposed goto/reload and must retain performance.timeOrigin. Requires original
populated16cases, absent server session after logout, zero old articles,
another same-tenant linked employee's actual200/empty own-only API and empty
UI. Bounded read-only DOM observer512 records only counts and next-header
booleans; old cases cannot coexist with the next principal. No DOM/CSS/session/
broadcast manipulation. The second actor is an existing empty imported scope;
no populated second-scope claim. Counts and13fact fingerprints before/after
must match, then original whole DB proof still executes. Original12matrix/
50focus/6nativeproofs/27captures/14ACK+audits remain; totalcases15/auth22.
Seven actual source bindings added for shell/motion/header/provider/login/
tenant-domain/package-lock, original32 bindings retained (now39).

Initial readonly source-removal reader FAILED its byte comparison because it
retained the additive block's separator newline. Original error and exact
one-blank-line diff preserved /tmp/hrm-employee-session-transition-first-source-reader-error.json.
Corrected only removal boundary to include that owned separator; original
harness then byteequal.18protected production/fixture/guard/dependency paths
unchangedM. Tiny Node syntax and git diff checks PASS after RAM/disk/pressure
inspection. New runtime/compiler/build/DB gates NOT RUN; heavy work belongs
to hosted CI. First source checkpoint unpushed, independent source review
pending and previousM build/main compiler stillrunning. No source-only bug
or privacy acceptance claimed. Next finish M release, independent new-source
review, dependent draft publication and actual exact-head hosted execution.
