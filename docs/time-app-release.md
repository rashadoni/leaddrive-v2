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
