# LeadDrive Time public release and update contract

The public entry point is `https://app.leaddrivecrm.org/time`.
`/time/download` and `/api/v1/public/time-app/latest` are separate from
Route & Field. The initial manifest has `release: null`: the page has no
download button, both routes return `503 TIME_APP_RELEASE_UNAVAILABLE`, and
phones remain silent. No QA artifact or Field release becomes public automatically.

## Promotion boundary

`src/lib/mtm/time-app-release-manifest.json` is the reviewed release pointer.
A normal CRM release through reviewed `main` and `.github/workflows/deploy.yml`
publishes a change to it. No environment variable, query string, GitHub latest
feed, old cached answer or Field fallback can activate a Time APK.
Do not set `release` merely because an Android build succeeded.

Before promoting the first Time release:

1. Finish the existing Time acceptance gates in the mobile repository:
   `docs/attendance-release-readiness.md`, `docs/attendance-offline-acceptance.md`
   and `docs/attendance-soak-monitoring.md`. The current uninterrupted 24-hour
   result is FAIL and independent verification is REFUSED. The separate
   three-event queue recovery PASS does not override either result.
2. Integrate/review the standalone Time source and this updater, pass hosted
   full Jest and TypeScript, and build the exact approved **main** SHA with
   `.github/workflows/build-attendance.yml`. That workflow currently produces
   QA Actions artifacts only and its `physicalMaestro: NOT_RUN` is not acceptance.
3. Check the artifact bytes with `apksigner` and `aapt`: package
   `com.leaddrive.attendance`, expected versionName and strictly increasing
   versionCode (greater than every previously distributed Time build), and
   signing certificate SHA-256
   `d6e9a6a76bb7c12e0ed81e2094f56e356e6f0d12b07ba35a2ed6598a88cecf2b`.
   Recheck the Time entry point and prohibited background-tracking permissions
   enforced by the build workflow. Never substitute a Field APK.
4. On a coordinator-owned test device, verify an **in-place** update from the
   previously installed signed Time build. Confirm package/version/signature,
   preserved session and pending attendance data, cold start/resume, Later,
   offline/timeout behavior, APK-vs-Play provenance, and AZ/RU/EN copy. Do not
   uninstall or clear app storage to make the update pass. A clean install
   alone cannot prove data retention.
5. After acceptance and publication authorization, publish those exact bytes as
   `leaddrive-time-<versionName>-<versionCode>.apk` under the mobile repository
   tag `time-v<versionName>-<versionCode>`, bound to the approved full source SHA.
   Publish the checksum and acceptance evidence alongside it; download the
   published asset and verify its SHA-256 matches the built bytes. Never
   overwrite a previously promoted tag/asset. A new artifact needs a new code.
   A versioned GitHub URL is not intrinsically immutable: verify release
   immutability where supported and retain the exact binary/hash/signature/source
   receipt. The mobile checker validates manifest metadata, not the downloaded
   APK bytes; Android verifies package/signing compatibility at installation.
6. Fill the manifest release object with `versionName`, `versionCode`,
   `publishedAt` (UTC ISO timestamp), `sourceSha` (40 lowercase hex characters),
   `sourceBranch: "main"`, `apkSha256`, `signingCertificateSha256`, `tag`, and
   `apkUrl`. The only allowed APK URL is
   `https://github.com/rashadoni/leaddrive-mtm/releases/download/time-v<versionName>-<versionCode>/leaddrive-time-<versionName>-<versionCode>.apk`.
   Bind the promotion PR to the exact CI/artifact/device/acceptance evidence.
   Replace the initial-unavailable assertion in the release test with evidence
   for that explicitly accepted promotion; retain the unavailable-fixture test.
7. Pass required CRM checks (`pr-scope`, `static-checks`, `typecheck`,
   `runner-policy`, `scan`) and the hosted production-build gate. Review the
   actual AZ/RU/EN page at phone and desktop widths before release. Merge only
   within the active task authorization. Deploy through GitHub Actions to
   registered `13.140.132.245:/opt/leaddrive-v2`; no direct server build/copy.
8. Confirm `/api/v1/ping` and exact `/api/v1/public/build-info` SHA, anonymous
   `/time?lang=az|ru|en`, the Time latest contract, redirect target, public APK
   checksum, and the update offer on the coordinator-approved device.

Until those steps pass, publishing the unavailable page is independent of
publishing a Time APK. A green plumbing test does not make Time release-ready.

## Installation and Play

The app checks after startup is ready and on a foreground transition. The
check is not awaited by attendance/auth/sync. It times out after ten seconds,
ignores failures, rejects a wrong installed package or malformed/foreign
release contract, and does not present a late result after background/unmount.
Later defers the same release on resume for 12 hours; a cold start or a newer
release may ask again. Its reminder key is separate from the Field updater.

Download opens the browser; Android asks the user to confirm installation.
The app neither installs itself nor requests `REQUEST_INSTALL_PACKAGES`.
Older Time builds without this updater need one manual update from `/time`
before they can offer updates themselves. A compatible same-package/same-signing-key
update keeps local app data;
uninstalling or clearing storage does not. Update offers are not backup or
sync acknowledgements.

`TIME_APP_STORE_URL` is disabled by default. The only accepted value is
`https://play.google.com/store/apps/details?id=com.leaddrive.attendance`.
Enable it only after the Time listing is actually available and Play signing
continuity with distributed APKs has been verified. A Play install receives
only the Play URL, or no offer if it is unavailable. Failure to read native
installer provenance produces no offer. Once enabled, APK installs also
receive the Time Play URL, matching the existing Field policy.

## Withdrawal

A reviewed `release: null` manifest disables the latest and download routes
in the deployed CRM SHA. Responses use `no-store`; there is no stale-release
cache. It does not uninstall a copy already present on a device or invalidate
an APK already downloaded. Existing Field routes and release selection remain
unchanged.


## First-release decision — 2026-10-25

The owner explicitly authorized publishing the initial Time APK without waiting
for uninterrupted 24-hour acceptance. For this first promotion only, that decision
supersedes the waiting condition in step1 above. The interrupted attempts remain
FAIL/REFUSED; they are not evidence of a completed full-day test. Attempt1047-v2
was stopped through its normal cancellation/cleanup path. All three queued marks
were separately recovered with original timestamps,148 prior events unchanged,
no duplicate after cold restart, and all four environment restoration checks.

All other publication checks remain: reviewed main, hosted tests and signed build,
pinned certificate/package/increasing version, data-preserving in-place upgrade,
versioned APK/checksum receipt, manifest review, deployment and public smoke.
The existing updater automatically offers a newer release; Android requires the
user to confirm installation. This release does not activate the person/phone
identity migration. See docs/time-first-public-release-session-log.md for the
actual artifact and deployment evidence.

## Shared-identity release decision — 2026-10-26

The owner explicitly approved the coordinated Zeytun shared-identity rollout after
being informed that the new S23 build had not been tested because the device
bridge was unavailable. This approval covers publishing reviewed-main Time1050
and its compatible Field release before any selected-person conversion. The
physical upgrade/Maestro gate for this build remains NOT RUN; neither the
previous1048 physical pass nor an interrupted soak is relabeled as its evidence.
Hosted tests/types, signed main build, package/permissions/certificate, exact
versioned APK and public-redownload hash are recorded in
`docs/evidence/identity-time-public-release-1050.json`. The updater still requires
Android installation confirmation; release availability does not prove a device
has installed it. The owner must confirm their own WhatsApp code and password
on the site when explicitly converting their account.

## Release 1054 — 2026-11-02

Owner in chat: «Да, публикуй». Reviewed main `fb426d8` built as 1054 (hosted Jest 297 suites,
TypeScript, package/permissions/pinned certificate), certificate re-checked from the APK's v2
signing block, published as `time-v1.0.0-1054`, public redownload hash verified. Physical
in-place upgrade of this exact build: NOT RUN (device bridge closed); the same package and key
were upgraded in place on the owner's S23 on 2026-11-01 (QA 1052) keeping session and open day.
Evidence: `docs/evidence/time-public-release-1054.json`.

## Release 1055 — 2026-11-03

Owner in chat on the request form: «Давай, делай» (choice of kind first, leaddrive-mtm#228; with
#227 the calendar days and who approves). Reviewed main `d43d71c` built as 1055 (hosted Jest 298
suites, package/permissions/pinned certificate), published as `time-v1.0.0-1055`, public redownload
hash verified. Physical in-place upgrade of this exact build: PASS on the owner's S23 — 1052 → 1055
with `pm install -r`, first install time and session kept, the new request opens on the kind
choice, nothing submitted. Evidence: `docs/evidence/time-public-release-1055.json`.

## Release 1058 — 2026-11-03

Server notifications in Time (leaddrive-mtm#229; owner: «я не разбираюсь сам сделай»): Time is a
second client of the Firebase project `leaddrive-mtm` (app registered in the console the same day),
registers its push address while signed in, and a tap on an explanation request opens «İzahatlar».
Reviewed main `db1bf59` built as 1058 (hosted Jest 299 suites, package/permissions/pinned
certificate, push service required), published as `time-v1.0.0-1058`, public redownload hash
verified. On the owner's S23: in-place 1055 → 1057 → 1058 kept the session; on 1057 (same source) a
real «İzahat istə» from the CRM arrived as a notification and its tap opened «İzahatlar».
Evidence: `docs/evidence/time-public-release-1058.json`.

## Release 1061 — 2026-11-04

HR's decision on a request arrives as a notification and its tap opens «Sorğular» (leaddrive-mtm#230,
server leaddrive-v2#1291); explanation requests and decisions pop up in the high-importance
`team-messages` channel, named in Time «Kadrlar: sorğular və izahatlar» (leaddrive-mtm#231, server
#1294). Reviewed main `f6545f6` built as 1061 (hosted Jest 299 suites, package/permissions/pinned
certificate, push service required), published as `time-v1.0.0-1061`, public redownload hash verified.
On the owner's S23: in-place 1058 → 1061 kept the session; a real decision from the CRM arrived and
its tap opened «Sorğular» (1059), and on 1061 with the server channel it popped up (owner: «работает»).
Evidence: `docs/evidence/time-public-release-1061.json`.

## Release 1062 — 2026-11-04

Kinds of a break and the desk (owner, 2026-11-04; mockups `docs/mtm-attendance/mockups/desk-and-breaks/`):
«Fasilə» asks the kind when the company turned kinds on and shows today's minutes against the limit
(leaddrive-mtm#234, server leaddrive-v2#1331); «Profil → İş yeri kompüterdə → Kompüteri qoş» scans a
computer's pairing QR and makes it the employee's workplace (leaddrive-mtm#235, server #1333). Reviewed
main `8eec079` built as 1062 (hosted Jest 302 suites, 2795 tests, package/permissions/pinned certificate),
published as `time-v1.0.0-1062`, public redownload hash verified. On the owner's S23: in-place 1061 → 1062
kept the session; «Profil» shows the desk card. Pairing a desk and a break from it end to end wait for the
server's desk screen and the company's switches. Evidence: `docs/evidence/time-public-release-1062.json`.

## Release 1063 — 2026-11-04

1062 plus the owner's hint in the desk card: «Profil → İş yeri kompüterdə» shows the screen link of the
company's own server (`https://<server>/screen`, for Zeytun `zeytun.leaddrivecrm.org/screen`, which serves
the screen page) and «Keçidi göndər» (leaddrive-mtm#236). Main `8053867` built as 1063 (hosted Jest 302
suites, 2796 tests), published as `time-v1.0.0-1063`, public redownload hash verified; in-place 1062 → 1063
on the owner's S23 kept the session. Evidence: `docs/evidence/time-public-release-1063.json`.
