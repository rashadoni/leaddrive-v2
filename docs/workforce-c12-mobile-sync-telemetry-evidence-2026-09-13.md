# Workforce C12 mobile-sync telemetry evidence

**Status:** WF-C12-002 partial; bounded application emission is implemented,
while dashboard ingestion, approved SLOs/paging and end-to-end review remain
open.
**Last verified:** 2026-09-13

## Delivered boundary

`recordMtmMobileSyncPullTelemetry` now converts every runtime dimension to a
finite metric vocabulary before it makes a sampling decision or emits a log:

- stream and endpoint must match a fixed mobile-sync allowlist;
- contract version is limited to the supported v1/v2 values;
- result must be one of the declared protocol outcome classes;
- duration is finite, rounded, non-negative and capped at five minutes;
- malformed values become `unknown`, `unavailable`, `0`, or another bounded
  fallback rather than a new label.

The existing boundary still HMAC-pseudonymizes the tenant, validates the APK
release shape and emits only aggregate row/byte counts. It never logs an
employee, location, device, cursor, response item or payload content.
Observability remains best-effort and cannot change a sync response.

## Verification

- **PASS:** targeted ESLint for the implementation and contract test.
- **PASS:** targeted Vitest, 2 files and 13 tests, including a malicious
  high-cardinality stream/endpoint/result/version/duration case and the
  Workforce v2 sync route contract.
- **PASS:** `git diff --check`.
- **NOT RUN:** full TypeScript check, production build, dashboard ingestion,
  browser E2E and staging/load telemetry review. Heavy checks require CI or an
  available `codex-heavy-run` worker; operational review needs the later C12
  environment exercise.

No SLO, alert threshold, pager route or production dashboard is activated by
this slice.
