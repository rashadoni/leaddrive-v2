# WF-C8-007b future organization calendar configuration evidence — 2026-09-29

## Claim boundary

This slice adds bounded, forward-only authoring for one organization-wide
Workforce calendar override. It does not complete `WF-C8-007` and does not
change the roadmap or production-readiness gate count.

Included:

- session-only `SCHEDULE_READ` and `SCHEDULE_WRITE` authorization through the
  granular Workforce schedule-configuration boundary;
- a 1–367 day future list with an explicit organization predicate and only
  active organization-scope rows;
- strict create input containing only a real `YYYY-MM-DD` date, one released
  kind and a non-empty bounded name;
- organization-local server date derived from the tenant timezone, with UTC
  fallback for an invalid stored timezone;
- one additive transaction protected by a tenant/date advisory lock and the
  existing partial unique index;
- state-idempotent exact replay and a fail-closed conflict for a different row
  on the same date;
- an actor-attributed audit row in the same transaction as the calendar row;
- a separate localized Scheduler-visible UI with named controls, inline
  status/error output, responsive layout and 44 px minimum controls.

Excluded:

- update, delete, rollback, past/today authoring or historical repair;
- team, employee, leave or moved-day pair authoring;
- proof-policy, version-diff or break-policy authoring;
- schema/migration changes and any Route UI or Route API change;
- browser/AT/contrast/zoom/device acceptance, Android/Gradle, load, signed
  device and tenant-pilot evidence.

## Shared-ledger safety

`MtmWorkCalendarDay.source` is a free string with the established `ADMIN`
default; there is no governed `WORKFORCE_CONFIG` enum or contract. The writer
therefore persists `source: "ADMIN"` and records Workforce provenance in the
atomic `WORKFORCE_CALENDAR_OVERRIDE_CREATED` audit action and
`workforce_calendar_configuration` metadata kind. It does not invent an
unreviewed source value.

The retained calendar ledger is also read by Route. To avoid silently changing
Route planning eligibility, the writer persists `routePlanningAllowed` from
the no-override weekday/weekend baseline for that date. A weekday HR holiday
therefore keeps the prior weekday Route-planning allowance; a weekend HR
exception workday keeps the prior weekend disallowance. Workforce attendance
resolution continues to derive its expectation from the calendar kind and
deliberately ignores this Route flag.

## Data and API contract

- `GET /api/v1/workforce/configuration/calendar` returns only
  `timezone`, `currentDate`, `start`, `endExclusive` and ordered
  `{date, kind, name}` summaries. Storage IDs, scope IDs, source, actors and
  Route flags are absent.
- The query always applies `organizationId`, `teamId: null`, `agentId: null`
  and `deletedAt: null`, plus a bounded half-open date range.
- `POST /api/v1/workforce/configuration/calendar` accepts only
  `{date, kind, name}`. Released create kinds are `PUBLIC_HOLIDAY`,
  `COMPANY_HOLIDAY` and `EXCEPTION_WORKDAY`.
- The date must be strictly later than the server-derived organization date.
  Caller-provided IDs, scope, moved dates, source or planning flags fail strict
  parsing.
- The transaction takes an advisory lock on organization/date, re-reads the
  active organization row, returns HTTP 200 for the exact desired state,
  creates once with HTTP 201, and returns 409 for a differing or concurrent
  row. Audit failure aborts the transaction instead of leaving an unaudited
  success.

## Verification on the implementation tree

PASS:

- `npx vitest run` on the three new calendar test files plus the existing
  Workforce and retained-calendar domain suites: 5 files / 28 tests;
- `npx vitest run src/__tests__/rls-route-context-coverage.test.ts`: 1 file /
  3 tests;
- scoped ESLint on all eight changed TS/TSX implementation and test paths;
- `npm run i18n:check`: EN source 23,831 leaf keys, RU/AZ missing 0 and extra 0;
- `git diff --check` and repository JSON parsing through the i18n checker.

The first focused test execution exposed two test-only assertion defects: the
test setup cleared import-time wrapper evidence, and a broad `/id/i` regex
matched the word `HOLIDAY`. Both assertions were narrowed; no production code
was changed for those failures, and the complete focused set then passed.

NOT RUN under the Contabo workload contract:

- full repository TypeScript check, production build and full test suite;
- real browser, assistive-technology, contrast, zoom and device acceptance;
- Android/Gradle, load/chaos, signed-device and tenant-pilot gates.

These remain CI/authorized-worker responsibilities. Exact-head CI and a fresh
author-independent review are required before merge.

## Roadmap accounting

`WF-C8-007` remains `PARTIAL`. Organization-wide future create/list authoring
is now implemented in source, but team/employee and moved-day workflows,
update/delete governance, break-policy authoring and real browser/AT evidence
remain outside this slice. Progress remains `DONE 81/161`, `GATES 14/15`, C8
36%, overall 59%, with 80 non-DONE rows.

## Independent frozen review and remediation

The first author-independent review rejected exact head
`6ca356a952871ed1d0c0594f91cb9f2651a7ee4b` with
`P0=0, P1=0, P2=2, P3=0`. It matched the full 15-path / 75,007-byte identity
`d6c21a1c016ba2fb4fae8726216dbf0105190a79633865cabecc60e21a14af00`
and found no server-domain, tenant, transaction, audit or Route-baseline issue.
The two UI findings were real:

1. the calendar component was mounted only on the broad configuration page,
   whose sole navigation entry remained CRM-admin-only, so a non-admin holder
   of the independent `SCHEDULER` grant could not discover it normally;
2. a transport or response-parse failure after POST used copy claiming no day
   changed, even though the transaction might already have committed.

The remediation keeps the broad `/workforce/configuration` page and its menu
entry admin-only. The calendar component moved to a narrow dedicated
`/workforce/calendar` page with a normal Workforce-capability/read navigation
entry; the server remains authoritative for `SCHEDULE_READ` and
`SCHEDULE_WRITE`. A non-admin Workforce operator can now discover the page
without exposing policy, access-management or attendance-security controls.

Mutation failures now distinguish confirmed domain/access rejection from an
unknown transport/parse outcome. Unknown POST state tells the operator to
refresh or safely submit the same state again, relying on the exact-state
replay contract; generic read/refresh failure makes no mutation claim. EN, RU
and AZ copy and the UI contract test pin this behavior.

Remediation PASS:

- seven targeted calendar/domain/navigation/RLS files / 88 tests;
- scoped ESLint on 11 affected TS/TSX implementation and test paths;
- i18n parity at 23,834 EN leaf keys, RU/AZ missing 0 and extra 0;
- whitespace.

Full typecheck/build/suite, browser/AT/device, Android/Gradle, load/chaos,
real-Postgres race injection, signed-device and pilot remain `NOT RUN` under
the Contabo placement rule. A new commit, exact identity and completely fresh
author-independent review are required; the rejected identity is not eligible
for approval or merge.

### Second frozen rereview and permission-scope remediation

Fresh full-range rereview of exact head
`7b065c3665640a2888a93ce4f389a0c4e3185fd9` returned
`P0=0, P1=0, P2=1, P3=0`. It confirmed the unknown-POST outcome finding was
closed, then found that the new menu item still carried legacy
`permissionScope: "workforce"`. That coarse CRM filter admits manager/sales
but hides support/ticketing, even though the independent `SCHEDULER` grant may
be assigned to any active tenant user.

The narrow calendar item is now capability-only in navigation and deliberately
omits the legacy permission scope. This is discoverability, not authorization:
the page contains only the calendar component, while GET and POST still require
the exact durable `SCHEDULE_READ` and `SCHEDULE_WRITE` decision. The broad
configuration item remains explicitly admin/superadmin-only. Navigation tests
now cover a support-role grant candidate whose legacy Workforce permission is
empty.

The rejected identity was 17 paths / 88,446 bytes / SHA-256
`8faef26fa99cfadbd9bee2aecc9faf1f701b74438c9a19d880e019351dceef3a`.
It is not eligible for approval or merge. A new checkpoint, identity, targeted
verification and fresh author-independent rereview are mandatory.

Permission-scope remediation verification is green: seven targeted files / 88
tests, scoped ESLint on the complete 11-path TS/TSX set, i18n 23,834/0/0 and
whitespace. Full typecheck/build/suite and physical/browser/device/load gates
remain `NOT RUN` under host policy. This author verification does not replace
the required fresh independent review.

### Third full-range independent review GREEN

A fresh author-independent review returned GREEN with
`P0=P1=P2=P3=0` on exact clean head
`6149e9713e9c6787268e0b664776cf7b5964e34e` against base/main/merge-base
`8de56f819b839a7c84951978ef3c619654f855e2`.

- Full identity: 17 paths / 94,946 bytes / SHA-256
  `ac2dc7621d60087cef1f044f16827aea981a6641e09882cf8f83e6fb222ef27d`.
- Implementation identity excluding the four Workforce evidence/continuity
  documents: 13 paths / 62,756 bytes / SHA-256
  `e58f11d8226388ece1d1187784aca263a155fb6b47fa8ad3f02764eb948989e0`.
- Independent PASS: seven targeted files / 88 tests, the Workforce auth-wrapper
  suite / 30 tests, scoped ESLint on 11 paths, i18n 23,834/0/0, both diff
  checks and explicit support/ticketing/manager/admin navigation evaluation.
- Both earlier finding groups are closed. No new server, tenant, date,
  transaction, audit, source, Route-baseline, response, navigation, unknown
  outcome, accessibility-source, localization or evidence finding remains.

Full typecheck/build/suite, browser/AT/device, Android/Gradle, load/chaos,
real-Postgres race, signed-device and pilot remain `NOT RUN`. Exact-head CI is
required before merge; this GREEN review adds no completion or gate credit.

### PR #500 first CI finding and voice-metadata repair

PR #500 was opened from reviewed receipt head
`b30a897c64fd480612b2084f72b160ae1115a553`. Runner policy, secret scan,
scope and full typecheck passed, while static checks correctly failed instead
of accepting four new unit-baseline regressions. The new navigation destination
automatically created voice section identity `workforce_calendar`, but the
section lacked its short localized navigation label, truthful guide and
explicit non-aggregate classification.

The repair adds only derived voice metadata: `nav.workforceCalendar` in EN,
RU and AZ, a guide bounded to the released forward-only organization calendar,
and `workforce_calendar: "config"`. The generic voice reader therefore cannot
bypass `SCHEDULE_READ`/`SCHEDULE_WRITE` or create a voice mutation. Aliases,
summaries and the static evaluation matrix remain derived; no baseline, script,
test, provider, TTS or media path changed.

Author verification after the repair:

- the four previously failing voice files pass 21/21 tests;
- i18n parity passes at 23,835 EN leaf keys, RU/AZ missing 0 and extra 0;
- ESLint passes both changed TypeScript files; JSON is intentionally outside
  the ESLint configuration and was parsed by the i18n check;
- worktree and index whitespace checks pass.

Full typecheck/build/suite, browser/AT/device, Android/Gradle, load/chaos,
real-Postgres race, signed-device and pilot remain `NOT RUN` locally. The
repaired complete diff requires a new checkpoint, fresh author-independent
review and replacement exact-head CI. `WF-C8-007` remains `PARTIAL`; progress
stays `DONE 81/161`, `GATES 14/15`, C8 36%, overall 59%, 80 non-DONE rows.

### Voice-remediation full-range independent review GREEN

Fresh author-independent review returned GREEN with
`P0=P1=P2=P3=0` on exact clean head
`cfea07c3e685652e37b13fafc4c4fabb5ded57be`; live main and merge-base were
`8de56f819b839a7c84951978ef3c619654f855e2`.

- Full identity: 19 paths / 109,505 bytes / SHA-256
  `6f2414b1e8a3a5f83b4a2668cd154bb2fd0cc585279ece7927a2802251365116`.
- Implementation identity excluding four append-only documents: 15 paths /
  68,059 bytes / SHA-256
  `8d482f468fe553f4faa0f3158b83c3ba3eac7fe1bff9b5934f2858f8fff3b223`.
- Independent PASS: calendar/navigation/RLS 88 tests, voice coverage/evaluation
  21 tests, Workforce auth wrapper 30 tests, scoped ESLint on 14 paths, i18n
  23,835/0/0, voice static audit 144 sections / 576 cases / 0 mismatches /
  0 live requests / 0 CRM tools, both diff checks and append-only prefixes.
- Review confirmed the calendar tenant/date/transaction/audit/Route boundaries
  remain sound and `config` classification prevents generic voice reads or
  writes. No provider, TTS or media path was added.

Full local typecheck/build/suite, browser/AT/device, Android/Gradle,
load/chaos, real-Postgres race, signed-device and pilot remain `NOT RUN`.
Replacement exact-head CI is mandatory; the review adds no progress credit.

### PR #500 production release receipt

Final head `83a5960227d9245fd515f92d93a6a1ba841ba8ff` preserved the
independently reviewed 15-path implementation identity byte-for-byte. Required
exact-head contexts `pr-scope`, `static-checks`, `typecheck`, `runner-policy`
and `scan` passed; the scope-derived production-build job was correctly
skipped. PR #500 was merged normally, without bypass, as main
`b25b4f382ebc8d323b0e975ccf34aee1731379f7` at
`2026-09-29T14:04:08Z`.

Deploy run `36579854359` passed quality/security, built and published the
SHA-bound standalone artifact, staged it immutably, deployed atomically,
completed built-in post-deploy smoke and capped retained artifacts. Independent
no-cache TLS probes pinned `app.leaddrivecrm.org` to the sole approved target
`13.140.132.245`: `/api/v1/ping` returned HTTP 200 with `{"ok":true}` and
`/api/v1/public/build-info` returned HTTP 200 with
`artifactSha=b25b4f382ebc8d323b0e975ccf34aee1731379f7` and
`builtAt=2026-09-29T14:10:41Z`.

Only GitHub `main` through `.github/workflows/deploy.yml` was used; no Azure,
retired host/owner, direct production deploy or worktree copy was used. The
organization calendar slice is released, but `WF-C8-007` remains `PARTIAL`:
team/employee and moved-day workflows, update/delete governance, break-policy
authoring and real browser/AT evidence remain open. Progress therefore remains
`DONE 81/161`, `GATES 14/15`, C8 36%, overall 59%, 80 non-DONE rows.
