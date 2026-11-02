# MTM attendance end-to-end scenarios

## Execution and meaning of results

The executable suite is `scripts/mtm-attendance-browser-evidence.mjs`, with its
empty-database fixture in `scripts/fixtures/mtm-attendance-e2e.mjs`. It runs only
through `.github/workflows/mtm-attendance-e2e.yml` on GitHub-hosted Ubuntu 24.04.
The input is an exact 40-character commit SHA; the script verifies the checkout
and hashes the tested sources. PR runs also use the exact PR head.

The environment is a real Next development server, Chromium, real credentials
sign-in and a disposable PostgreSQL 16 database. No authentication mocks, HTTP
response fixtures or production tenants are used. Six web principals cover the
administrator, read-only HR, team manager, office employee, field employee and a
foreign tenant. Office and field credentials also obtain real mobile tokens.
A 58-person fictional roster exercises pagination and automatic participation.

A result is **not yet a test pass merely because this file exists**. The current
run's `manifest.json` records PASS, FAIL or NOT_RUN separately for every named
case, alongside transport, dates, source hashes, screenshots and a control
inventory. An earlier setup failure leaves subsequent cases NOT_RUN. A failed
assertion fails the workflow. `workflow-result.json` preserves setup failures
that occurred before the harness could start.

`browser-navigation` means a real page, data response and sidebar destination;
it does not mean every control was exercised. `browser-action` means actual
clicks, text entry or selection and server-side confirmation. `authenticated-http`
and `mobile-http` are real route flows but **not browser clicks or APK tests**.
The control inventory is explicitly inventory-only. No global claim that every
possible combination was tested is permitted.

## Scenario ledger

| Family | Real HTTP / database assertions | Browser interactions |
| --- | --- | --- |
| Main report | Tenant/team scopes; denied employees; invalid range; exact snapshot Excel/PDF | Six forms; month grid; next/previous page; date/team/employee filters; invalid range; real downloads |
| Personal forms | Create/replay/update/stale/delete; owner isolation | Save/open/rename; cancel deletion; confirm deletion |
| Delivery schedules | Empty initial recipients; invalid recipient; disabled create/replay/update/stale/delete; no receipt queued | Invalid recipient; disabled create/edit format/frequency; cancel/confirm delete |
| Rules/calendar | Future version; invalid clock; holiday create/edit/delete; stale and past edits rejected | Initial rendering; rule/calendar mutation click flows tracked separately below |
| Day kinds | Rename; stale revision; cannot remove system kind | Open/search/edit/save; cancel new kind and preset |
| Request quotas | Save; invalid values rejected | Open/change hours and count/save |
| HR grant | Grant; stale write; all-employee reading; write rejection; fresh-session revocation | Search; start and cancel revocation |
| Employees | Existing/new user automatic inclusion; no invented hire facts; exclude/reinclude/idempotency; preserve field role; HR write denied | Search, pagination, included/excluded filtering, switch round trip, history open/close |
| Employment history | Hire/termination/rehire order; stale chain rejected | Read history panel |
| Branches | Create/replay/revise/stale; primary assignment; manager cannot assign outside team | Create/cancel/edit/archive |
| Branch report | Real shared report snapshot | Date/team/employee filters; PDF download |
| Geo policy | OFF default; no legal text rejected; fictional publication/consent/withdrawal; restore OFF | Incomplete text disables activation; save OFF; no coordinates submitted |
| Employee requests | Submit/replay; approved/rejected/cancelled; revoke annual leave; HR/foreign denial | Expand, approve, require rejection reason, reject, cancel revocation, revoke; employee sees result |
| Decision journal | Persisted decisions from real requests/HR recording | Date/status filter, export; focused request URL tested by direct navigation (the journal renders no detail links) |
| HR recording | Multi-person batch; replay; duplicate employee rejection; HR read-only denial | Team selection, day kind/date/reason, preview, save, start new record |
| Installations | Request; approve/reject/revoke/replay; HR denial | Approve, required reason, history, revoke; employee sees state |
| QR | Real policy route and generated code | Enable, display, refresh, hide on background, return, disable |
| Risks | Seeded fictional clock hint; real dismissal/replay; HR denial; workday unchanged | Initial report rendering; dismissal click flow tracked separately below |
| Shifts | Day/night plans; cycle and roster; stale revision | Create/cancel, night clocks, add/remove cycle slot, publish |
| Leave balances | Missing policy; fictional tier/profile; calculated allowance; HR write denial | Pagination; edit opening balance and publish |
| Closed months | Prior-period fact; stale preview; close/replay; frozen table survives rename; Excel/PDF; foreign denial | Select frozen period/snapshot, Excel/PDF download |
| Mobile workday | Actual credential login; START/PAUSE/RESUME/FINISH; exact operation retries; four events; immutable completed fact | Reflected in web reports; physical APK explicitly NOT_RUN |
| Layout/navigation | All 14 routes require successful authenticated data reads | 13 sidebar active destinations + recording page; AZ/RU/EN employee view; 390px overflow check |

All 14 attendance routes are enumerated directly: root, requests, decisions,
employees, branches, branches/report, shifts, leave-balances, months,
installations, branch-qr, review, location-settings and recordings.

## Remaining acceptance work (must not be relabelled PASS)

Historical authoring checkpoint (superseded by the hosted results below): the
first execution and selector/fixture stabilization had not run. These still
need browser mutation cases beyond their existing real HTTP coverage:

- Rules save and calendar create/edit/delete/cancel.
- Actual HR grant/revoke confirmation, employment history recording, day-kind
  create/archive/restore, and primary branch assignment.
- Risk dismissal; leave policy publication; month preview/blockers/close.
- Uncertain-network recovery controls and queued offline state; deliberately
  stale browser tabs; attachment upload/download/invalid file checks; exhaustive
  pagination at each separate queue limit and every permission/role combination.
- Physical Samsung S23 Ultra APK, real camera QR, Android permissions, offline
  queue, process death/restart, background/foreground, and overnight endurance.
- Real outbound email and client-approved legal text: intentionally no provider
  sends, cron execution, real recipients or client location collection here.

A bounded automated suite cannot establish an exhaustive claim about “all
scenarios”; changes must extend the named ledger and show their actual result.
The physical-device run is an additional artifact, never inferred from CI.

## Database fidelity and safety

The harness refuses any non-loopback target, production NODE_ENV, missing
GitHub/CI flags, wrong database name or role, and a non-empty initial fixture.
`prisma db push` supplies the current complete schema. The fixture then replaces
only empty attendance tables/columns and replays the actual attendance
migrations, employment history, retained workforce immutable/RLS block,
completed-workday guard and the complete reopen-ledger migration (including
insert validation, append-only triggers, RLS and function replacement).
This restores real request, branch, consent, risk, installation, month,
participation and lifecycle guards rather than permissive lookalikes.

The runtime role is NOSUPERUSER/NOBYPASSRLS. Remaining tenant tables without
shipping RLS in this schema fixture receive the application's tenant-context
policy; existing attendance/workforce policies are not broadened. The harness
checks unscoped and foreign-tenant reads fail closed. Admin connection privileges
exist solely for synthetic fixture preparation and invariant inspection.

The seeded risk is marked as a seeded case: its detector algorithm is not
proved by the dismissal test. Historical month facts are also explicitly seeded
DB fixtures, not claimed phone submissions. Final privacy invariants check geo
and QR OFF, no coordinate rows, no delivery schedules, and the foreign tenant
unchanged.

No auth cookies, tokens, passwords, raw SQL, runtime logs or network trace are
uploaded. Failure records contain a safe route/status, source line and error
class; screenshots show only disposable fictional data. The workflow holds no
production secrets and neither invokes a deployment nor contacts production.

## Authoring verification — 2026-10-14 (Asia/Baku)

- PASS: syntax checks for both new modules.
- PASS: GitHub runner policy for the workflow set.
- NOT RUN on Contabo: install, full application build, full typecheck,
  PostgreSQL integration and Chromium. Host contract puts heavy work in CI.
- Hosted execution: pending; this document is a scenario plan, not a green run.

## Browser action expansion — 2026-10-14 (Asia/Baku)

The first three missing-action bullets above are superseded by executable
browser cases: future rule publication; calendar create/edit/delete with both
cancel paths; HR revoke/grant confirmations with the existing HR session checked
after each decision; custom day-kind creation/archive/restore; employment HIRE
recording; primary branch assignment; risk dismissal; fictional leave policy
publication; month preview/confirmation/close and an unfinished-day blocker.
All 13 sidebar destinations now also have actual link-click traversal, recorded
separately from mutation evidence. Historical month facts and risk findings are
seeded explicitly; those fixture insertions are not relabelled phone submissions
or detector coverage.

Static review also found that recreating only the completed-workday function
omitted the reopen ledger's own insert/immutable triggers. The fixture now
recreates the empty ledger and replays its complete production migration before
the later employee-return migration. No production database is involved.

These additions remain **NOT RUN in a browser until hosted CI completes**.
Network uncertainty/retry UI, deliberately stale browser tabs, attachments,
every queue's pagination boundaries, the full role/control cross-product and
physical Android scenarios remain explicit acceptance work. Existing real HTTP
stale/replay assertions are useful coverage, not substitutes for those clicks.

## First hosted run and negative browser flows — 2026-10-14 (Asia/Baku)

The initial hosted run is
[38472009609](https://github.com/rashadoni/leaddrive-v2/actions/runs/38472009609),
bound to `74bd10a8e7d16c2dac093562ca86498d2badf04c`; results are pending.
Static review during that run corrected seeded risk evidence to use the actual
event's `serverReceivedAt`, as required by the production insert guard.

Two more executable browser cases supersede part of the remaining network/stale
tab gap: a real branch write whose acknowledgement is intentionally dropped,
followed by the UI's exact-request retry with one branch/version; and competing
catalogue tabs where the stale save returns 409, preserves the newer value and
requires reload. Fault injection drops a response after the real handler commits;
it does not fabricate a successful API response. Both cases require a subsequent
hosted run before they can be labelled PASS. Other recovery controls and physical
offline queues remain unverified. The workflow also reacts to the auth/workday,
sidebar, schema and translation sources used by these scenarios.

## Initial hosted evidence and corrections — 2026-10-14 (Asia/Baku)

Run 38472009609 finished **FAIL: 52 PASS, 7 FAIL, 5 NOT_RUN**. The exact-head
artifact proves real migration setup/restricted RLS, six web credential sessions,
two mobile logins, four workday transitions and retries, all 14 page data reads,
and the named passing mutation families. It does not establish a green suite.

The seven failures were traced as follows:

- Two seeded risk fixtures violated the real receipt-time guard; corrected to
  the event's actual `serverReceivedAt` in checkpoint `87e37b7c8`.
- The QR test tried to read a response body discarded by the component during
  its refresh. It now checks the real status and resulting UI/API state, with
  unconditional disposable-policy OFF cleanup. Its earlier interruption caused
  the final QR-OFF invariant failure as well.
- Employment recording successfully saved and closed the editor; the harness
  now reopens history before asserting the new entry.
- The journal has no request-detail anchors. The earlier invented-anchor
  assertion is replaced with explicitly labelled direct request URL navigation.
- The final sidebar item overlapped Next development's issue badge. The harness
  scrolls the real sidebar and clicks an unobstructed position in the link, with
  normal pointer actionability checks and no forced click.

No product defect has been established by these seven failures. The QR
background check now runs headed Chromium under a hosted Xvfb display so tab
visibility comes from Chromium, never synthetic `visibilitychange` events.
The updated suite still requires hosted verification.

A new private-document flow covers actual mobile multipart upload, identical
retry, invalid image/size, EXIF removal, draft and unselected-document privacy,
same-team reviewer access, read-only HR/self/field/foreign denial, and a real
browser document-link download. Upload is explicitly mobile HTTP, not an Android
picker. Files stay in disposable private runner storage outside artifacts.
The development server uses the application's memory admission backend; the
production Redis availability/concurrency gate remains **NOT_RUN** here.

## Second hosted evidence and environment corrections — 2026-10-14 (Asia/Baku)

Run 38475185628, exact head `576d8989f058d2db9753fc58b8b7b1f026411f0d`,
finished **FAIL: 60 PASS, 2 FAIL, 5 NOT_RUN**. The earlier fixture/selector fixes,
all sidebar destinations, real lost-acknowledgement retry, competing browser
tabs and final privacy invariants passed. Remaining failures were the QR
background check and the new document-upload flow.

The QR runner still forced the page visible: Playwright's Chromium page setup
enables `Emulation.setFocusEmulationEnabled` for every page. The scenario now
removes that automation override through CDP before bringing another real tab
forward. It retains the native hidden-state and missing-image assertions, then
restores the runner default. No application event or visibility value is faked.

The document fixture supplied an external runtime directory without a separate
external log directory. The actual `resolveRuntimePaths` module rejects this
pair because the default development log directory is inside the checkout.
A small isolated execution of that module reproduced the rejection and accepted
the corrected sibling runtime/log directories without writing files. The CI
environment now configures both. The upload helper also records only expected
and received status, byte count and an allowlisted application error code on
failure, so further failures can be diagnosed without private response content.

These corrections still need a new hosted run. No product defect has been
established; the document access/download assertions remain unproved until the
upload preparation and the subsequent real browser steps complete successfully.

## Third hosted evidence and remaining browser setup — 2026-10-14 (Asia/Baku)

Run 38477922867, exact head `7bbf8f9f47031e245f8dd9a10997d8d809aae9cd`,
finished **FAIL: 59 PASS, 3 FAIL, 5 NOT_RUN**. The external runtime/log correction
worked: document upload/retry, invalid files/size, EXIF removal, private draft
and unselected files, denied roles and same-team reviewer checks completed.
The actual download was not reached because the harness sought an Open button
on a focused request that correctly opened itself. The screenshot shows the
expanded document link and Close button; the harness now asserts that state
before clicking the document link.

Shift publication succeeded. The subsequent leave report still showed Loading
when a generic element wait expired. The two leave-page scenarios now await the
specific real GET response and complete body using the existing HTTP deadline,
then assert rows; navigation-to-response time/status is retained in the manifest.
Pagination also waits for its real response. No global UI timeout was increased;
slow report performance remains to be assessed from this new timing evidence.

Bare Xvfb still did not produce a hidden page after a second window was brought
forward. CI now starts and verifies Openbox on the same display. The QR scenario
removes Playwright's focus override and natively minimizes/restores Chromium
through its window API, asserting the actual minimized state, hidden visibility,
absent QR and restored foreground QR. No fake DOM visibility or forced click is
used. These remaining browser corrections require another hosted run.

## Fourth hosted evidence and focus-session correction — 2026-10-14 (Asia/Baku)

Run [38480664142](https://github.com/rashadoni/leaddrive-v2/actions/runs/38480664142),
exact head `a9cbf556ecd6fdcd9514748f551ab4e9804f1290`, finished
**FAIL: 61 PASS, 1 FAIL, 5 NOT_RUN**. Private-document upload through the real
mobile HTTP route and the HR browser download passed. Both leave-page flows
passed; complete-response timings were 6.1 and 7.5 seconds on this runner.
All other implemented flows passed except native QR background visibility.
The native Openbox window really became minimized, while the document stayed
visible; the QR-removal assertion was therefore not reached.

The earlier focus-override explanation was incomplete: Chromium holds a capture
handle on the CDP session that enabled focus emulation. Sending disable on a
separate session does not release Playwright's original handle. This follows
the [Chromium focus-emulation implementation](https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/protocol/emulation_handler.cc)
and the pinned Playwright driver's main-frame initialization.

The harness now obtains that original in-process main-frame session through a
small compatibility-checked helper, disables its focus override, and retains the
real native minimize, actual hidden visibility, absent QR and foreground QR
assertions. It changes neither application code nor DOM visibility/events.
Missing or changed driver structure fails the case rather than silently skipping
it. Nested cleanup restores the original override even if policy cleanup or
window restoration fails; the shared driver session is never detached.
Only safe window/visibility states are added to the artifact manifest.

PASS locally: module syntax and runner policy (62 workflows). Full browser,
PostgreSQL, build and typecheck are **NOT_RUN locally**, per the host contract.
The original-session correction still needs hosted verification; QR lifecycle
must not be reported as passing until that run succeeds.

## Fifth hosted evidence and concurrent-tab loading — 2026-10-14 (Asia/Baku)

Run [38482714069](https://github.com/rashadoni/leaddrive-v2/actions/runs/38482714069),
exact head `33e242e4a4c5106247e2cb6ca0cfcab7d63cf443`, finished
**FAIL: 61 PASS, 1 FAIL, 5 NOT_RUN**. The QR scenario now passed all native
lifecycle assertions. Its manifest records minimized window, actual hidden
document, QR removal while hidden, and QR restoration after foregrounding.
The original-session correction is therefore verified in the hosted browser.

The remaining failure moved to competing catalogue tabs: the second tab timed
out looking for the catalogue search input before either tab submitted a write.
That input renders only after a separate catalogue GET, not after the generic
page heading. The former cleanup also closed the failing second tab before the
outer failure screenshot, leaving only the already edited first tab visible.
This artifact cannot establish whether the second tab had a server failure,
loading delay or focus problem; no product defect is claimed from it.

The scenario now foregrounds each real tab, waits for the actual catalogue GET
started by the Open button, requires a successful response and both tabs' same
initial revision, then performs the unchanged competing-write assertions:
successful newer save, rejected stale save with 409, disabled stale editor,
explicit reload and preservation of the newer value. HTTP status failures are
reported immediately without response bodies. Safe stage/revision metadata and
the actual failing tab's screenshot are retained before cleanup. No error is
retried or turned into a pass, and no global timeout is increased.

PASS locally: module syntax, runner policy (62 workflows), diff check. Heavy
verification remains **NOT_RUN locally**. The overall suite still requires a
successful hosted run; the prior green runs of the competing-tab case do not
override this latest failure.

## Sixth hosted evidence — 2026-10-14 (Asia/Baku)

Run [38484487031](https://github.com/rashadoni/leaddrive-v2/actions/runs/38484487031),
exact head `0cb7a1f48bf0b08bba384b3f0aeade87e0030ae7`, completed
**PASS: 62 PASS, 0 FAIL, 5 NOT_RUN**. Artifact `11860012505` contains the complete
sanitized manifest and fictional screenshots. The compact repository receipt is
[`evidence/e2e/final-hosted-run.json`](evidence/e2e/final-hosted-run.json), with
every named result and transport, tested-source hashes, original manifest hash,
QR lifecycle metadata, competing-tab revisions and retained response timings.

Both previously failing lifecycle cases passed in the same run: Chromium really
minimized and hid the document, the QR disappeared and returned in foreground;
two real catalogue tabs loaded the same revision, the newer write succeeded,
the stale write received 409, and explicit reload preserved the newer value.
All fourteen route reads/navigation and every implemented action family passed.
No application permission or product assertion was weakened during stabilization.

The five explicit NOT_RUN cases remain physical APK/OS permissions, external
email, camera/offline Android replay, overnight endurance and all possible
control combinations. The fixture has 58 people; this is not a 300-person
performance acceptance. The two leave responses took 10.8 and 18.6 seconds in
the development CI environment, so this pass does not establish a production
latency guarantee. Production Redis admission and a production-rendered browser
suite remain outside this development-server harness.

At receipt creation, typecheck, scope, runner policy and secret scan had passed;
the separate required static-checks job was still running. The successful E2E
was not repeated. This is evidence for the exact tested SHA, not a claim about
the later documentation-only commit containing this receipt.

### Subsequent required-check and merge checkpoint

At 2026-10-13 23:55 UTC the remaining required static-checks job
`115595006502` finished PASS (24m52s). All five required checks were green for
exact head `0cb7a1f48bf0b08bba384b3f0aeade87e0030ae7`, alongside the sixth
browser/PG run. PR 751 was merged at 23:55:19 UTC as
`ebd7dc90af73cca4b6d5d901bf1a170355d3e86b`. The successful E2E was not repeated.
This supersedes only the earlier pending integration-gate state; all five
NOT_RUN cases and the physical/production limitations remain in force. The
receipt includes this separate integration checkpoint and makes no deployment
acceptance claim.

## Later released and physical evidence — 2026-10-14T06:02:20.475439+00:00

The five NOT_RUN entries above describe that historical hosted manifest; they
are not the final scope of the subsequent physical acceptance. Prior entries
and failed runs remain unchanged.

- Released PR756 tested exact `32b90a2a6a4d56322f6300ecc03c235a8b1329fc` in
  authenticated browser/database run38501754397: **62 PASS, 0 FAIL, 5 NOT_RUN**.
  Non-UTC run38501754422 demonstrated two expected baseline failures and
  **53 fixed PASS**. Deployment38504073106 and exact production artifact
  `8c54afe632181b15d4bb4cb88ee1953a6a72cd4f` were verified separately.
- The actual Samsung S23 now supplies separate physical evidence for both
  OFFICE/FIELD workdays, pause persistence, offline FINISH plus cold restart
  and automatic recovery, all eight request types per role, actual HR decisions,
  correction/original-event preservation, Excel/PDF and shared-installation
  findings. Denied-GPS lifecycle regression passed on official3.8.5.
- The bounded physical endurance passed five HOME/foreground cycles, real inbox
  refreshes and unchanged canonical day/request comparisons over1,524seconds.
  This is not uninterrupted all-night functional coverage; power observations
  and their gaps are a separate receipt.
- Physical camera QR/document capture, external email, a300-person load test,
  all possible control/role/network combinations, production Redis admission
  and a full browser suite on a production build remain **NOT_RUN**.
  The OFFICE UI does not expose its full private queue count (**NOT_OBSERVABLE**);
  covered actions are reconciled individually. Location collection remains
  disabled pending the client's approved consent text.
- CRM PR757 and mobile PR131 have their own exact-head gates. At this entry,
  mobile CI38519311958 passed224suites/1,890tests/1existingTODO and TypeScript,
  including actual RN notification-language tests; signed release, physical
  3.8.6 locale verification, final OFFICE logout/restoration and the new deployed
  risk-date check are still pending. Do not transfer earlier PASS counts to them.

See `evidence/device/s23-acceptance.json` for finite timestamped assertions,
including historical failures, and README section10 for the continuing journal.
