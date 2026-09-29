# Workforce C6 revision-aware self-response projection evidence

Date: 2026-09-27

Task: `WF-C6-006` remains `PARTIAL`

Slice base: `778709ef3` (PR #462 production receipt on current main
`68cf17eddd1d5db8179fe2ec2981506403fc98ca`)

## Purpose

The employee exception feed previously treated any response row as a current
acknowledgement and ordered rows by creation time. That could present a stale
response as current after a later manager request or case reopen, and it could
offer acknowledgement UI for an invalid, truncated or already resolved
lifecycle.

This slice makes that projection use the same immutable, lock-observed case
revisions as the released manager workbench. It changes no writer, schema,
migration, authorization rule, tenant rollout value, UI component, translation,
notification or terminal decision.

## Fail-closed projection

`projectWorkforceExceptionSelfResponseState` returns only
`UNAVAILABLE`, `NOT_ACKNOWLEDGED` or `ACKNOWLEDGED`:

- a workday-bound case, complete decision history of at most 64 rows,
  contiguous `caseRevision = index + 1` and a valid draft lifecycle are
  mandatory;
- a resolved lifecycle is always unavailable on this self-response surface;
- `REQUEST_EMPLOYEE_RESPONSE`, `REQUEST_TIME_CORRECTION` and
  `REOPEN_FOR_REVIEW` reset the current response cycle;
- only a non-null response revision at or after the latest reset is current;
  legacy `NULL`, stale, negative, non-integer and future revisions never become
  acknowledgement proof;
- a complete 64-decision history remains readable when its current response is
  already recorded, but no new response control is offered without one;
- schedule-only no-show cases stay view-only and unavailable.

The pure projection reuses the manager workbench's private current-cycle
revision calculation, with no timestamp inference.

## Bounded and minimized read

The self-scoped route still resolves the session employee and exact tenant
before querying cases. When the tenant rollout is unavailable, its Prisma
selection contains neither decisions nor responses. When available, each of
at most 101 queried candidates (the 100-case page plus its overflow sentinel)
reads only:

- up to 65 decisions ordered by ascending `caseRevision`, selecting only
  `decisionCode` and `caseRevision`; and
- the highest single non-null response revision, ordered by
  `observedCaseRevision` then id, selecting only `observedCaseRevision`.

The response exposes none of those internal fields and reads no reason,
response code, response id, correction id, proof or raw attendance evidence.
An over-64 stream, a revision gap, an unknown/invalid transition or an
impossible response revision produces `UNAVAILABLE` while leaving the generic
self exception card visible.

## Local verification

The dependency source had the exact lockfile SHA-256
`54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`.
Each command used a temporary dependency link and removed it afterward.

- focused helper/API selection: 2 files / 24 tests passed;
- helper/API plus manager queue, employee writer and self-UI regressions:
  5 files / 44 tests passed;
- targeted ESLint for all four changed runtime/test files passed;
- `git diff --check` passed;
- resource precheck: 15 GiB available RAM, memory pressure averages 0.00 and
  the worktree filesystem was 44% used.

Full local typecheck/build, real browser E2E, Android/Gradle, load,
physical-device and human-pilot checks are `NOT RUN` under the Contabo workload
policy. Exact-head CI and a fresh author-independent complete-diff review are
mandatory before merge.

## Independent preflight P2 repair

The first author-independent read-only pass returned RED with one P2: the two
metadata lines at the top of this newly untracked evidence file used Markdown
hard-break spaces. `git diff --check 778709ef3` covered only tracked paths and
therefore did not see them, while an explicit no-index check correctly reported
both trailing-whitespace defects.

The spaces were removed and the enabled-route API contract was also tightened
to assert the entire exact Prisma selection rather than only relation
subtrees. Tracked diff whitespace plus the explicit untracked no-index check
now pass. The complete five-file regression selection again passes 44/44 and
targeted four-file ESLint passes. The RED verdict does not transfer; the
current complete snapshot requires a fresh reviewer read and fingerprint.

## Replacement independent preflight GREEN

A fresh author-independent read from zero returned GREEN with zero P0-P3
findings on the current seven-path snapshot. Exact base/HEAD/merge-base was
`778709ef36f9c438bce5c060fda69bffe5947f94`; current `origin/main` was
`68cf17eddd1d5db8179fe2ec2981506403fc98ca`. The combined tracked binary diff
plus untracked no-index binary diff was 38,244 bytes, SHA-256
`f039c7297cbcc70e7994bc57e47b54bc28befb42d7f8b2e20a3c9a1f5fd107be`.

The reviewer confirmed the original whitespace P2 repair, rollout-off and
rollout-on selections, 100-case page plus sentinel bound, revision
contiguity/capacity/lifecycle handling, request/correction/reopen resets,
legacy/stale/future response behavior, resolved and schedule-only fences,
privacy-minimized output, test/evidence truth and unchanged progress. Reviewer
tracked and untracked whitespace checks passed, and the append-only session
prefix matched exactly. Reviewer Vitest, ESLint, typecheck, build, browser,
Android, load, physical-device and pilot checks were `NOT RUN`; author results
were not relabelled. This pre-commit verdict does not transfer to the receipt
delta or future checkpoint, so a clean frozen-head review remains mandatory.

## Frozen review P2 platform-scope repair

The first frozen clean-head review of base/current main
`68cf17eddd1d5db8179fe2ec2981506403fc98ca` through head
`ea3dd1791215efe9f4504cdcbdd977582f208a4f` returned RED with one P2 and no
P0/P1/P3. The eight-path / 47,601-byte binary diff had SHA-256
`2da644671f700ec80506d75b519ed606e52c59411b9b7697c96d3b89a8ae056a`.

Runtime, tests and this evidence were sound, but the authoritative WF-C6-006
roadmap row said revision-aware acknowledgement existed across web and mobile.
This slice changes only the web self-exception API. The dedicated mobile
endpoint and Android model intentionally remain response-ledger-free and offer
no acknowledgement action. The roadmap now scopes the new projection to
server/web and explicitly keeps mobile acknowledgement/response-ledger
projection open. No runtime path changed. The RED identity does not transfer;
a new clean checkpoint and complete frozen rereview are mandatory.

## Replacement frozen complete-diff review GREEN

Fresh author-independent review from zero returned GREEN with zero P0-P3
findings on exact base/current `origin/main`/merge-base
`68cf17eddd1d5db8179fe2ec2981506403fc98ca` through clean head
`57f32f10fb5b609015a70fdaa13f18b919ea54f4`. The complete eight-path binary
diff was 51,114 bytes, SHA-256
`c65f22fced42ea3fa25bae94b8e38c407da0b314e3eafd79b5f00be6aa6a0090`,
below 400 KB; clean start/end and diff whitespace passed.

The reviewer reconfirmed both P2 repairs, exact rollout query shapes and
101/65/1 bounds, privacy-minimized fields/output, contiguous lifecycle and
fail-closed invalid/resolved states, current-cycle resets, legacy/stale/future
response handling, schedule-only and 64/65 boundaries, unchanged progress and
the inherited PR #462 release receipt. The corrected task row now matches the
unchanged response-ledger-free mobile endpoint and Android model. Commit
`57f32f10...` changed only the three receipt documents from the rejected head;
all four runtime/test blobs were byte-identical.

Reviewer Vitest, ESLint, typecheck, build, browser, Android, load,
physical-device and pilot checks were `NOT RUN`; author results were not
relabelled. Only this evidence file, the roadmap and append-only session log
may change to record the verdict. A receipt-integrity review must prove all
four reviewed runtime/test blobs unchanged before push.

## Release boundary

This slice does not claim that an employee was notified, saw a request,
responded on a physical device or completed an appeal. It activates no tenant
and changes no attendance, payroll, discipline, correction or terminal state.
Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%; no task or
phase-gate credit is added.

## PR #465 production release

Receipt integrity preserved all four independently reviewed runtime/test blobs
byte-identically at final head
`ce9b77d8711fb6d292017528661e4a8ec1379f20`. The final complete diff from exact
base `68cf17eddd1d5db8179fe2ec2981506403fc98ca` covered eight paths / 54,853
binary-diff bytes with SHA-256
`e448c02b926928a0f81c932a44754db59872a287b3e853bda47da49013e499ef`.
Both the replacement frozen review and final receipt-integrity review returned
GREEN with zero P0-P3 findings.

PR #465 passed the five exact-head required contexts: `pr-scope` in 13s,
`static-checks` in 8m16s, `typecheck` in 16m06s, `runner-policy` in 13s and
`scan` in 14s. The normal PR production build was skipped by policy. The PR
merged normally at `2026-09-27T18:48:29Z` as
`84c5e9ef2d2409cfb95056a738579a6267cf35b6`.

GitHub deploy run `36342013489` completed GREEN at
`2026-09-27T19:11:17Z`: quality/security took 11m35s, the SHA-bound production
artifact took 15m42s, and atomic production deployment plus post-deploy smoke
took 6m56s. Independent no-cache public reads returned `{"ok":true}` and
`{"sha":"84c5e9ef2d24","artifactSha":"84c5e9ef2d2409cfb95056a738579a6267cf35b6","builtAt":"2026-09-27T18:54:46Z"}`.
The public artifact SHA exactly matches merged `main`; no direct server deploy,
retired target/owner or worktree copy was used.

Full browser E2E, Android/Gradle, load, physical-device and human-pilot evidence
remains `NOT RUN`. WF-C6-006 remains `PARTIAL`, and progress stays `81/161`,
`14/15`, C5 81%, C6 20% and C9 99%.
