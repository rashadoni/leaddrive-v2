# Workforce C11 — verified approved-timesheet export

> **Checkpoint:** `WF-C11-003`, `WF-C11-006`, `WF-C11-008` — refreshed
> 2026-09-13.

## Delivered contract

`GET /api/v1/workforce/timesheet/approvals/:id/export` returns a JSON
attachment for one selected immutable approval revision. Before responding,
the server rebuilds the approval from its persisted rows and verifies the
calculation version plus row and fact hashes. It never rehydrates mutable
workdays, live policies, events, sites or attendance evidence.

The output is an explicit `TIME_FACT` allow-list. It excludes coordinates,
derived location verdicts, QR/device evidence, request/correction text,
snapshot IDs and audit data. Overtime is labelled
`OPERATIONAL_DEVIATION_NOT_PAYABLE`; no wage, tax or payroll instruction is
produced. Every response is `private, no-store` and `nosniff`.

A successful download first appends a metadata-only accountability record.
Audit failure stops the export; corrupt approval hashes produce a generic
integrity conflict and no audit.

## Verification and limits

- `PASS`: stored approval hash reproduction, narrow projection, corruption,
  access-denial and audit-failure tests.
- `PASS`: targeted export/classification/MFA suite and scoped ESLint.
- `NOT RUN`: full typecheck/build and browser download are delegated to CI.
- `NOT RUN`: external encrypted delivery, expiry/revocation, database-backed
  integration, payroll integration and production-data inspection. This
  endpoint creates no reusable server artifact and no external send.
