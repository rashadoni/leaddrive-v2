# C8/C10 — derived Workforce evidence timeline

## Safe boundary delivered

`GET /api/v1/workforce/evidence/timeline` is a Workforce-only, human-session
endpoint for one exact employee and at most 31 tenant-local calendar days.
It does not reuse Route & Field GPS history.

Before any employee or evidence read, the endpoint requires:

- the `workforce-hrm` tenant capability and a live human session;
- a distributed per-principal rate-limit decision;
- a bounded `x-workforce-access-purpose` value;
- a bounded `x-workforce-access-reason-code` value;
- an exact employee scope;
- before granular cutover, the established tenant-admin boundary; after
  cutover, an effective `EVIDENCE_REVIEWER` grant for that employee or the
  organization.

The append-only `audit_logs` access audit must be written successfully before
the response is returned. It records the accountable session user, the
target employee, purpose/reason, optional opaque case reference, date range,
row count and `DERIVED_ONLY` projection. An unavailable audit produces a
no-store `503` instead of returning unlogged evidence.

## Data minimization

The Prisma select and public response contain only:

- evidence identifier, capture source/time and raw-retention state;
- canonical workday action or site-transition claim and its review state;
- immutable assessment kind/version, verdict, bounded reason codes and time.

They do **not** select or return raw coordinates, encrypted envelopes,
redacted raw receipts, payload hashes, QR nonce/token material, trusted-device
proof, device enrollment, reversible distance or accuracy. The response says
explicitly that a derived verdict is not identity or physical-presence proof.

Route & Field location history remains a separate module and endpoint. This
change neither grants Workforce roles access to Route GPS nor changes a Route
manager's existing Route entitlement.

## Verification

- PASS: targeted ESLint for the route, access resolver, parser, rate limit and
  tests.
- PASS: 3 new test files / 11 tests cover purpose/reason validation, exact
  grant behavior, API-key and manager denial, derived-only projection,
  rate-limit containment, output bounds and mandatory-audit failure.
- PASS: existing Workforce report rate-limit suite, 1 file / 6 tests.
- PASS: `git diff --check`.
- NOT RUN locally: full typecheck/build/browser E2E; the GitHub PR gates own
  heavy verification.
- NOT RUN: raw-evidence decryption/disclosure, because an accountable
  investigation policy and UI have not been approved or implemented.
- NOT RUN: periodic access-review exercise and browser evidence.

## Remaining status

WF-C8-009 and WF-C10-006 remain **PARTIAL**. The derived server boundary is
ready, but the visible timeline, separately reviewed raw-investigation flow
and periodic audit review still require their own checkpoints and evidence.

## 2026-09-28 — visible restricted review surface checkpoint

- `/workforce/evidence` now provides a named-employee, derived-only review
  surface inside the existing CRM shell. A separate bounded target-search API
  uses the same human-session, tenant, rollout and effective-grant resolver as
  the final timeline read; each request loads one bounded
  `EVIDENCE_DERIVED_READ` snapshot. It rejects
  PostgreSQL LIKE metacharacters, returns at most 25 active in-scope employees
  and writes a purpose-bound audit before returning names.
- Purpose and reason are explicit selections rather than silent defaults.
  Dates are also explicit tenant-calendar inputs, and the client rejects a
  response whose employee, period, purpose, reason or optional opaque case
  reference differs from the request. The wire projection contains no raw
  coordinates or reversible accuracy/distance; its internal evidence, subject
  and assessment IDs are validated and then dropped from the parsed timeline
  result model before rendering.
- Switching organization or signed-in human principal remounts the sensitive
  scope, aborts both reads and clears employee/query/result state. Late
  responses are ignored even when a transport mock does not honor abort.
- Stable machine reason codes are mapped to bounded localized presentation
  categories; unknown codes use generic human-review copy. Mapped categories
  are de-duplicated in source order so one assessment cannot repeat the same
  translated explanation.
- EN/RU/AZ copy, explicit empty/error/loading states, concise live status,
  keyboard focus transfer after employee selection/change, 48 px primary
  fields/actions, 44 px secondary actions, responsive grids and unbroken-label
  wrapping are present in source. The
  restrained light/dark treatment follows the recorded Workforce UX brief;
  it does not claim browser or assistive-technology acceptance evidence.
- The first independent review of
  `a6f6a7cf1a22a541a9de56d773ea811d8bb9ab44..72dee0495d84126bfeca0a733b2a77942f5bcf67`
  was correctly RED (`P0=0`, `P1=1`, `P2=5`, `P3=3`). A later P3 found
  repeated localized categories. After both repair rounds, fresh independent
  complete-diff review returned GREEN with `P0=P1=P2=P3=0` on exact head
  `c2f4c9ab2b3c22c3d51a296bfcbfbeade2fa692f`: 18 paths / 112,395
  plain-binary bytes / SHA-256
  `cd2a00b8ad84ac14c3dcd9d656071eecdca7b24b16374917a316099176e12db4`.
- Author checks pass 11 Workforce-evidence/nav files / 97 tests, complete
  task-scoped ESLint, translation parity (`23,712` EN leaf keys; RU/AZ
  missing=0, extra=0), JSON parsing and whitespace. Reviewer checks pass 7
  files / 32 tests, targeted ESLint, the same i18n parity, diff-check and all
  existing three-document append-only prefixes.
- `npx tsc --noEmit --pretty false` was attempted before the repair checkpoint
  but exited 134 at the standard Node 2 GB heap; it is not counted as passed
  and was not retried with a host-wide override. Full typecheck and build are
  mandatory in exact-head CI. Browser E2E, real keyboard/AT/contrast/200% zoom,
  Android/Gradle, load, signed APK, physical-device and pilot evidence remain
  `NOT RUN` under the Contabo workload policy.

WF-C8-009, WF-C8-010 and WF-C10-006 remain **PARTIAL**. The visible
derived-only surface closes technical UI debt but does not approve a raw
investigation flow, perform periodic access review or substitute source tests
for real browser/accessibility acceptance. Progress remains `DONE 81/161`,
`GATES 14/15`, C5 81%, C6 20% and C9 99%; no task or gate credit is added.

## 2026-09-28 — PR #483 first CI repair checkpoint

- PR #483 opened on independently GREEN receipt head
  `a2ad15dee13d464d039cb31ab318c312b89dcbcb`. `pr-scope`,
  `runner-policy` and `scan` passed; the PR production build was correctly
  skipped and is not counted as passed.
- PR run `36473500283` exposed two real integration omissions. `static-checks`
  found the new menu-derived `workforce_evidence` destination missing from the
  mandatory voice guide and classification registries. `typecheck` found two
  new TS2322 errors because the closed privacy-log label union omitted the new
  directory-authorization and target-search operations. No baseline was
  updated and neither check was weakened.
- The voice repair adds a bounded, source-grounded Russian guide and classifies
  the purpose-bound screen as `surface`, deliberately without a generic data
  descriptor or aggregate that could bypass its explicit review context. Both
  failed coverage tests pass 10/10; the wider author voice set passes 7 files /
  62 tests.
- The type repair adds only the two fixed, input-free privacy labels, gives the
  selected directory row its exact Prisma nullability and adds a regression
  that forces directory authorization failure, expects 503 and verifies the
  safe label. The author evidence set passes 11 files / 98 tests and complete
  task-scoped ESLint and whitespace pass.
- Fresh independent complete-diff review returned GREEN with
  `P0=P1=P2=P3=0` on exact head
  `87d8f4e7115f8abb190f5c811512e8715f7eda06`: 22 paths / 134,054
  plain-binary bytes / SHA-256
  `858ae69e409a97772ab6bf018136f064687d39aeb08afe82480a61350a70d0cf`.
  Reviewer checks pass focused 2 files / 12 tests, expanded evidence 11 files /
  101 tests, scoped ESLint and diff-check. Full replacement exact-head CI is
  still mandatory before merge.

Progress remains `DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%.
WF-C8-009/WF-C8-010/WF-C10-006 remain `PARTIAL`; the failed old PR head and
its repaired-but-not-yet-pushed successor add no task or gate credit.

## 2026-09-28 — PR #483 production release

- Final receipt-integrity review returned GREEN with `P0=P1=P2=P3=0` on
  exact PR head `99ed0a3641e3f3c102e57459230d66a615794d6f`: 22 paths /
  140,368 plain-binary bytes / SHA-256
  `bc8370a821dc7b01fe0076c5c7a10455a35d5bbdecd77e812992dfcc926e1d39`.
  All reviewed runtime/test/message blobs remained byte-identical after the
  repair review; the three evidence files were append-only.
- Replacement PR run `36477139610` passed exact-head `pr-scope`,
  `static-checks` and `typecheck`; separate exact-head `runner-policy` and
  `scan` runs also passed. The PR production-build job was skipped by policy
  and is not reported as passed. PR #483 merged normally at
  `2026-09-28T20:25:23Z` as main
  `90ad3df47b5e6703b80097afcd5dd74378d4e995`.
- GitHub deploy run `36479079543` completed SUCCESS at
  `2026-09-28T20:51:41Z`. Quality/security, SHA-bound production build and
  artifact, atomic deployment, scheduler and tenant-isolation checks, and the
  workflow's ping/revision/login/asset smoke all passed.
- Independent no-cache TLS requests pinned `app.leaddrivecrm.org` to the only
  registered production IP `13.140.132.245`: `/api/v1/ping` returned HTTP 200
  `{"ok":true}` and `/api/v1/public/build-info` returned HTTP 200 with exact
  `artifactSha=90ad3df47b5e6703b80097afcd5dd74378d4e995` and
  `builtAt=2026-09-28T20:31:13Z`. Release used only GitHub `main` through
  `.github/workflows/deploy.yml`; no direct server deploy or worktree copy was
  used.

Browser E2E, real keyboard/AT/contrast/200% zoom, Android/Gradle, load, signed
APK, physical-device and human-pilot evidence remain `NOT RUN`. Progress stays
`DONE 81/161`, `GATES 14/15`, C5 81%, C6 20% and C9 99%.
WF-C8-009/WF-C8-010/WF-C10-006 remain **PARTIAL** because this release does
not supply the missing browser/accessibility, raw-investigation or periodic
access-review evidence.
