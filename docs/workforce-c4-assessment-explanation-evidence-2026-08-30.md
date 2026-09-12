# Workforce C4 — safe assessment explanation contract

> **Checkpoint:** `WF-C4-009` — 2026-08-30

The server exposes stable presentation keys and recovery actions for employee
and manager assessment states. It maps accepted location, weak/boundary
location, unavailable permission/provider and missing evidence to safe
`CONFIRMED`/`REVIEW`/`UNAVAILABLE` outcomes. Unknown internal risk/security
codes collapse to a generic review state: raw coordinates, QR nonces, device
fingerprints and anti-fraud thresholds are never disclosed.

This is a contract for C8/C9 AZ/RU/EN presentation, not a completed UI or an
approved fallback policy (OD-16 remains open).

Verification: targeted suite 1 file, 2 tests PASS; targeted ESLint and
`git diff --check` PASS. **NOT RUN:** browser/i18n/mobile acceptance and full
build — CI/approved worker is required.
