# First public LeadDrive Time release

## 2026-10-25 — explicit owner release authorization

User requests publishing now without waiting for the full24h test. This supersedes the first-release waiting condition in docs/time-app-release.md only; no failed/interrupted test is relabeled as PASS. Scope is signed standalone Time APK, existing /time download button and update offers. Android requires installation confirmation. Canonical person/phone auth changes remain out of scope.

Routing: this worktree crm-time-first-public-release, branch codex/time-first-public-release, origin https://github.com/rashadoni/leaddrive-v2.git, initial main0b952f293. Production13.140.132.245:/opt/leaddrive-v2 only through reviewed main and .github/workflows/deploy.yml. Existing page worktree and identity feature remain preserved.

Mobile PR203 required scope/tests PASS at e49fd8e; merged through normal protected PR. Main-built signed Time build is being dispatched. Unrelated automatic Field publish workflow from the merge is cancelled because this request only releases Time. Stop marker used for active1047-v2; controller recorded OPERATOR_STOP/FAIL and independent REFUSED, with all4 exact restoration checks true. Full-day acceptance is not claimed. Pending claims recovery verification in progress before in-place upgrade.

Remaining: main-signed artifact/package/certificate/code/hash, physical data-preserving upgrade, versioned published APK/checksum/receipt, reviewed manifest and current checks, Actions deployment and live download smoke.
