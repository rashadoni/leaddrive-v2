# C6 mobile self-response projection evidence — 2026-09-27

Status: `PARTIAL`

Task: `WF-C6-006`

## Bounded claim

This slice projects the already released revision-aware employee response
state into the self-scoped mobile exception feed and Android UI. It is
read-only. It adds no mobile acknowledgement writer, POST, operation ID,
outbox entry, notification, delivery claim, terminal action, correction
approval, proof capture or raw attendance evidence.

Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. This source
slice adds no task or phase-gate credit.

## Fresh rollout snapshot

`resolveMobileAuth` now carries an optional compatibility-safe
`workforceExceptionResponse` capability, but every real request initializes
and resolves it to a boolean. It is true only when the same fresh Organization
row grants Workforce and the canonical
`resolveWorkforceExceptionResponseRecording(features)` resolver returns
`AVAILABLE`. It is never trusted from the JWT, APK or bootstrap payload and
does not add a second Organization lookup inside `withMobileRls`.

Absent, malformed and disabled flags fail closed. A Route-only tenant cannot
gain the response projection merely by carrying the raw rollout feature.

## Minimized mobile query and projection

The endpoint keeps its existing `withMobileRls` capability check,
`WORKTIME_SELF_READ`, exact active agent, own organization/agent/workday
scope, deterministic 100-plus-sentinel bound, private no-store response and
generic correction-only disposition.

When rollout is unavailable, the Prisma selection has no `decisions` or
`employeeResponses` property, returns `MIGRATION_REQUIRED`, and projects every
retained card as `UNAVAILABLE` even if a loose mock injects ledger-looking
fields. When rollout is available, each case reads only:

- at most 65 ascending `{ decisionCode, caseRevision }` facts; and
- one highest non-null `{ observedCaseRevision }` fact.

The route reuses `projectWorkforceExceptionSelfResponseState` with the first
64 decisions and an explicit completeness bit. Current acknowledgement,
missing acknowledgement and impossible future revisions project to the exact
`ACKNOWLEDGED`, `NOT_ACKNOWLEDGED` and fail-closed `UNAVAILABLE` states. No
response/decision ID, response code, reason, correction ID, actor, proof,
location, QR or device material is selected or returned.

## Android fail-closed display contract

The Android wire model uses the typed
`WorkforceSelfExceptionResponseState` enum. One pure resolver accepts a state
only when the top-level recording value is exact `AVAILABLE` and the card
value is one of the three exact known strings. Missing, wrong-case, padded,
future or wrong-type metadata becomes `UNAVAILABLE` without dropping an
otherwise valid generic correction card.

Compose renders an exhaustive typed status label beside each existing
correction-prefill card. EN/RU/AZ copy says only whether the current-review
response is recorded, not recorded or unavailable. It does not claim that a
manager was notified, that the employee was seen, or that the case, appeal or
attendance was resolved. The existing correction action remains separate;
there is no acknowledgement control or local mutation path.

## Focused verification

- Mobile auth, exact mobile API and Android source contracts: 3 files / 73
  tests passed.
- Existing revision/lifecycle and response-rollout contracts: 2 files / 20
  tests passed. The selected total is 5 files / 93 tests.
- Targeted ESLint passed for the two TypeScript runtime paths and the API plus
  Android source-contract tests (zero errors; the existing `_options` warning
  in `mobile-auth.ts` remains unchanged).
- The legacy `mobile-auth-scope.test.ts` has 46 pre-existing
  `no-explicit-any` errors on both base and current bytes; a JSON-format lint
  comparison confirmed 46/46 and the new hunks add no `any`.
- `git diff --check` passed.
- Direct XML parsing with `xmllint` was `NOT RUN` because the binary is not
  installed; the source contract verifies all three keys in every catalog,
  while Android lint remains the authoritative resource check.

The focused commands used a temporary read-only dependency link whose target
has the exact package-lock SHA-256
`54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`.
The link must be removed before the source checkpoint without modifying its
external target.

Local full typecheck/build, Android Gradle/lint/JVM test, browser E2E, load,
signed APK, physical-device and human-pilot checks are `NOT RUN` under the
Contabo workload policy. Exact-head GitHub checks and the path-triggered
`Android debug lint and unit tests` job are mandatory before any merge.

## Release boundary

The existing server writer and rollout authority remain unchanged. This
display snapshot grants no mutation authority and is not claimed as a
linearizable emergency kill switch. Mobile acknowledgement write, full appeal
UX, delivery semantics, physical-device evidence and tenant activation remain
open.

## Independent preflight P3 receipt correction

The first author-independent complete-snapshot review returned RED with one P3
and no P0-P2: the append-only session entry cited the release-receipt commit as
the nonexistent full SHA `d9a014221ce36cf8a7d73b8b485e253e3e65c00f`.
The actual commit is `d9a0142216947ae1384946e7d0caf8234c65337d`.
The historical line is preserved and a new append-only journal entry
supersedes only that identifier.

The rejected snapshot otherwise passed rollout/query/auth/privacy/Kotlin/UI,
tracked and untracked whitespace, append-only prefix, Android XML/key parity,
package-lock and live PR #465 release-receipt review. Its 16-path / 60,265-byte
combined binary stream had SHA-256
`271a33522b46cedc8392de20d8f913db052609605db18c1296a98794ba95b4ea`.
That verdict does not transfer to the changed receipt bytes; a fresh complete
snapshot review is mandatory.

## Replacement independent preflight GREEN

A fresh author-independent review from zero returned GREEN with zero P0-P3
findings on exact base/current `origin/main`/merge-base
`84c5e9ef2d2409cfb95056a738579a6267cf35b6`, HEAD
`d9a0142216947ae1384946e7d0caf8234c65337d` plus every tracked change and both
untracked task files. The 16-path combined binary stream was 63,662 bytes with
SHA-256 `2bb3d0efdf06317085dfc8f4ac7d3735b6ce682492f2337f89c3cade3fe49729`,
below 400 KB.

The reviewer independently reconfirmed the append-only SHA correction,
rollout-off/on query shapes, 101/65/1 bounds, same-row fresh auth snapshot,
tenant/self scope, revision/lifecycle fail-closed projection, privacy,
typed Kotlin parser, localized read-only UI and absence of a mobile writer.
Tracked/untracked whitespace, append-only prefixes, XML parsing with exact
253/253/253 key parity, lockfile identity and the live PR #465 merge/deploy
receipt passed.

Reviewer-side dependency-backed and heavy checks were `NOT RUN`; the author's
results were not relabelled. This pre-commit verdict does not transfer to the
new receipt bytes or forthcoming commit identity, so a fresh frozen complete-
diff review remains mandatory.

## Frozen complete-diff review GREEN

Fresh author-independent review from zero returned GREEN with zero P0-P3
findings on clean base/merge-base/current `origin/main`
`84c5e9ef2d2409cfb95056a738579a6267cf35b6` through frozen head
`1783d2924ddcaafcac6489f493e63ae8953c2bcc`. The complete 16-path binary diff
was 63,464 bytes with SHA-256
`6e4ea817cfdc100d417d4921dac4d4b2602043888f87cd7806057da6cb6f830c`,
below 400 KB; the worktree was clean at both ends.

The reviewer reread the full runtime/test/resource/documentation diff and
confirmed the same-row auth snapshot, zero second Organization lookup, exact
101/65/1 selections, canonical revision projector, self/tenant/privacy fences,
strict Kotlin parsing, exhaustive localized read-only UI and no-writer
boundary. Diff whitespace, append-only prefixes, lockfile identity, Android
XML/key parity at 253/253/253 and the inherited PR #465 production receipt
passed.

Live branch protection still names only `pr-scope`, `static-checks`,
`typecheck`, `runner-policy` and `scan`; `agent-review` remains absent and was
not treated as merge permission. Reviewer dependency-backed and heavy gates
were `NOT RUN`. Only this evidence file, the roadmap and append-only log may
change to record the verdict; receipt integrity must prove all 12 reviewed
runtime/test/resource/build blobs byte-identical before push.
