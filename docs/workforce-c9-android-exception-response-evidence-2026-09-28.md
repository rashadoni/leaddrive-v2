# C9 Android revision-bound exception acknowledgement evidence — 2026-09-28

Status: `PARTIAL`

Tasks: `WF-C6-006`, `WF-C9-006`, `WF-C9-010`, `WF-C9-012`

## Bounded claim

This slice lets the standalone Workforce Android client consume the exact
server-offered acknowledgement for an employee's current exception revision.
It uses one stable operation UUID for the direct attempt and every encrypted
retry, never projects a local acknowledgement, and keeps local recovery
metadata free of case identifiers, revisions and operation identifiers.

It does not add a response kind, explanation/appeal workflow, terminal case
action, notification, tenant activation, Room schema migration or server
writer. It relies only on the already released self-scoped GET, revision-bound
POST and database-enforced one-response-per-cycle invariant.

Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%.
All four tasks remain `PARTIAL`; no task or phase-gate credit is added.

## Exact server-offered action

The Android parser keeps an otherwise valid correction card readable but
hides its acknowledgement control unless all wire values are exact:

- the top-level response rollout is `AVAILABLE`;
- the card state is `NOT_ACKNOWLEDGED`;
- `availableResponseAction` has exactly the two reviewed fields;
- `kind` is exactly `ACKNOWLEDGE`; and
- `expectedCaseRevision` is an integral value from 0 through 63.

Missing, padded, wrong-case, future, fractional, coerced, negative or
over-bound values fail closed. The action is also withheld for a case ID that
cannot safely form the reviewed route.

The direct POST path is exactly
`/api/v1/mtm/mobile/hrm/exceptions/{caseId}/response`. Its JSON body contains
only `operationId` and `expectedCaseRevision`; the client cannot supply a
response code, reason, proof, location, QR, device fact or timestamp. A valid
success must confirm the same case and fixed `ACKNOWLEDGED` code. A malformed
2xx is treated as ambiguous delivery and queues the same UUID. Known stale,
unavailable, link and write conflicts are terminal conflicts; coded 4xx/rate
limits are not converted into offline retries.

## Encrypted delivery and downgrade boundary

The new `EXCEPTION_RESPONSE` operation stores case, expected revision and
queue time only inside the existing Android-Keystore AES-GCM envelope. Room
metadata retains only the established opaque account scope, domain, timing,
attempt/state and encrypted blob. The existing seven-day expiry, eight-attempt
limit, per-domain oldest-first drain, WorkManager scheduling and destructive
successful account-switch/logout boundary remain authoritative.

No Room schema change is required. Pending response rows use dedicated TEXT
state aliases `EXCEPTION_RESPONSE_QUEUED` and `EXCEPTION_RESPONSE_RETRY`.
This version maps them to the ordinary pending states, while an older APK's
exact `QUEUED`/`RETRY` SQL ignores the unfamiliar domain rows instead of
repeatedly trying to decode and replay them. Mandatory-update deferral and
retry preserve the aliases. Re-upgrading resumes the encrypted rows with the
same operation UUID.

The encrypted payload parser requires a canonical UUID, safe case identifier,
bounded integral revision and parseable queue timestamp. Domain mismatch,
decryption failure or malformed plaintext remains review-only and is never
submitted.

## Recovery and UI contract

Action gating uses a complete account-and-domain SQL aggregate, not the
recovery center's bounded latest-100 display. Therefore an older pending
response cannot be hidden behind newer outbox rows. Only active
`QUEUED`/`RETRY` delivery disables another action; terminal conflict, expiry,
unknown and review counts remain visible without permanently deadlocking a
new action offered by a fresh server projection.

Before any exception reload, old cards are removed until the fresh GET
returns. The same rule applies after accepted, queued or failed submission.
The callback synchronously checks the busy fence, exact currently displayed
case/action and pending-delivery aggregate before launching work, which
contains same-tick double taps and stale dialogs. Coroutine cancellation is
re-thrown rather than converted into a network failure.

The confirmation and recovery copy is present in matched EN/RU/AZ catalogs.
It states that acknowledgement records only that the current review was seen;
it does not approve the finding, resolve the case or waive correction. The
text button keeps the existing explicit 48 dp tap-target modifier, and status
continues through the existing polite live region. There is no optimistic
`ACKNOWLEDGED` state assignment.

## Independent preflight

The first author-independent read-only pass found one blocking recovery
defect: terminal rows had no resolution control but were included in the
action gate, so a fresh server-offered revision could remain disabled until
logout. The repair separates active delivery from visible terminal recovery,
clears stale cards before the fresh server read and adds exact aggregate and
terminal-only tests.

The replacement preflight returned GREEN with P0=0, P1=0, P2=0 and P3=0 on
the stable nine-path source/test/resource diff: 72,672 plain-binary bytes,
SHA-256
`0e8068b59fc3a35bc8aa67ea3d0fa50f0479f449419382e9d9b00e606442b5f6`.
It changed no file. This is working-tree evidence only; a clean exact
base-to-head frozen review remains mandatory after checkpoint.

## Focused verification

- Android source-contract Vitest: 1 file / 22 tests passed.
- Existing mobile exception GET, POST, response-writer and response-operation
  suites: 4 files / 43 tests passed.
- Targeted ESLint for the changed TypeScript contract passed without output.
- EN/RU/AZ resource-key parity passed at 265 keys per catalog.
- All three resource catalogs parsed successfully with Perl `XML::Parser`.
- `git diff --check` passed.

Android Gradle lint/JVM tests, Room process-death/downgrade instrumentation,
signed APK, physical-device offline/retry/account-switch exercise, TalkBack,
200% font, browser E2E, load and human pilot are `NOT RUN` under the Contabo
workload policy. The path-triggered exact-head Android CI job and all ordinary
PR gates are mandatory before merge.

## Scope and stopping point

The slice starts from exact deployed main
`f6b4c06dad08c72534174a8c004c325c417238cf`; the preceding production receipt
is checkpoint `894d3d3f96774373ec7e4982fa9054a5e7269629` on branch
`codex/workforce-android-exception-response`. Production was not contacted or
changed while implementing this Android slice.

Source, tests, translations and initial evidence are present in the working
tree, but no implementation checkpoint, frozen complete-diff review, PR, CI,
merge or release exists yet for this slice.

## Frozen complete-diff review GREEN

Fresh author-independent read-only review returned GREEN with P0=0, P1=0,
P2=0 and P3=0 on exact base/local and remote `origin/main`/merge-base
`f6b4c06dad08c72534174a8c004c325c417238cf` through clean head
`3204bd3b09bbf13eee886c1e1a24a85fb8a64758`.

The reviewer independently reproduced 13 paths / 93,776 plain-binary bytes /
SHA-256
`45928568b9e9935fa0a1b5c6250a040d2c95ba8e9458ee3b75b0282d821ad569`,
well below 400 KB. Start/end were clean, current main did not drift, and the
existing unique-index evidence, roadmap and session log retained their prior
committed bytes as exact prefixes.

The exact GET/POST wire contract, tenant/account fences, stable UUID,
conflict/retry classification, encrypted payload, downgrade aliases, Room-v2
compatibility, exact recovery aggregate, non-deadlocking terminal recovery,
same-tick/current-card/cancellation UI fences, absence of optimistic success,
EN/RU/AZ copy, accessibility source and evidence truth all passed. The
reviewer independently repeated 22/22 Android source-contract tests, 43/43
server response tests, scoped ESLint, 265/265/265 key parity, three XML parses
and whitespace checks.

Android Gradle, Room instrumentation, signed APK, physical device, TalkBack,
browser, load and pilot remained `NOT RUN` by policy. This receipt changes
documentation only; final receipt-integrity review must prove all nine
reviewed runtime/test/resource blobs unchanged before push.

## First exact-head Android CI failure and repair

PR #482 opened at exact reviewed head
`c9a3fb1b386f05879a51edd083f5209f256c2fca`. `pr-scope`, `runner-policy` and
`scan` passed, while Android run `36452049554` failed in
`:app:compileDebugUnitTestKotlin`. Production Kotlin compilation completed;
the failure was confined to the new malformed-offer test table, where Kotlin
2 inferred a reified intersection type for heterogeneous `arrayOf` rows and
raised `TYPE_INTERSECTION_AS_REIFIED_ERROR`.

The test rows now state `arrayOf<Any?>` explicitly. The only production-source
repair removes the compiler-reported redundant `else` from the already
flow-exhaustive pending-state alias `when`; behavior is unchanged. Targeted
Android source-contract tests remain 22/22, scoped ESLint and whitespace pass.

Android Gradle was not rerun on Contabo. A new exact-head path-triggered CI run
is mandatory. The prior frozen and integrity reviews remain historical
evidence for their exact heads and do not authorize the repaired head; fresh
complete-diff review is required before push.
