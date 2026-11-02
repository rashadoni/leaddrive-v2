# First public LeadDrive Time release

## 2026-10-25 — explicit owner release authorization

User requests publishing now without waiting for the full24h test. This supersedes the first-release waiting condition in docs/time-app-release.md only; no failed/interrupted test is relabeled as PASS. Scope is signed standalone Time APK, existing /time download button and update offers. Android requires installation confirmation. Canonical person/phone auth changes remain out of scope.

Routing: this worktree crm-time-first-public-release, branch codex/time-first-public-release, origin https://github.com/rashadoni/leaddrive-v2.git, initial main0b952f293. Production13.140.132.245:/opt/leaddrive-v2 only through reviewed main and .github/workflows/deploy.yml. Existing page worktree and identity feature remain preserved.

Mobile PR203 required scope/tests PASS at e49fd8e; merged through normal protected PR. Main-built signed Time build is being dispatched. Unrelated automatic Field publish workflow from the merge is cancelled because this request only releases Time. Stop marker used for active1047-v2; controller recorded OPERATOR_STOP/FAIL and independent REFUSED, with all4 exact restoration checks true. Full-day acceptance is not claimed. Pending claims recovery verification in progress before in-place upgrade.

Remaining: main-signed artifact/package/certificate/code/hash, physical data-preserving upgrade, versioned published APK/checksum/receipt, reviewed manifest and current checks, Actions deployment and live download smoke.


## 2026-10-25 09:59 UTC — signed Time1048 published

Mobile main32fe203d256d2928a67bd5f4a596ac58a2149775 build40181407750/job121133074424 PASS, artifact12594800870. APK46,238,327 bytes, SHA256 2b372cb69fdbcbc1e61986efabbd3aadad6fb40e0d2e6759f121c1a3a9abe0fe. Hosted apksigner/aapt package/permission/signature checks PASS; independently verified downloaded ZIP/APK checksums and actual APKv2 certificate fingerprint. Required CI292suites/2664tests PASS,1todo; TypeScript PASS.

Actual S23 upgrade1047→1048 PASS09:59:14UTC. Maestro3claim PASS173.594s; queue survived cold restart, signed in-place install without data clearing and new-version cold restart. Three claims replayed with original times;153 prior events unchanged,total156,no duplicate after restart. Network/radios/display and both apps all permission profiles/UID preserved. Root inspected both pending PNGs. Initial pre-install attempt refused a transient offline startup screen; no install/business mutation occurred, all4 cleanup checks exact; v2 adds bounded readiness wait and retains the first refusal.

Published tag time-v1.0.0-1048 at 2026-10-25T09:59:38Z bound to exact mobilemain SHA. Public asset downloaded again and exact hash matched. GitHub immutable=false: no claim of server-enforced immutability; versioned assets and receipts retained with no overwrite. Field release remains separate. Full-day acceptance NOT COMPLETE under explicit owner waiver; actual native update offer NOT RUN before public manifest, hosted update-policy tests PASS.

CRM manifest now promotes those exact bytes. Remaining: targeted test, current required hosted checks and production build, normal merge/Actions deployment, AZ/RU/EN actual browser/download/API smoke.

Targeted local verification: time-app-release.test.ts26/26 PASS (single worker,970ms); git diff --check PASS. Local full build/typecheck/global suite NOT RUN per host workload contract; hosted gates requested for this PR. Existing unavailable and foreign-APK refusal cases retained.
