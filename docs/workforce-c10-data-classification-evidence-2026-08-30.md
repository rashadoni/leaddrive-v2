# Workforce C10 — data classification evidence

> **Status:** implementation evidence for `WF-C10-002`. This technical
> classification neither supplies legal approval nor performs retention.
> **Recorded:** 2026-08-30; refreshed 2026-09-13.

## Dictionary and minimum-disclosure rule

| Class | Typical material | Retention class | Ordinary approved-timesheet export |
|---|---|---|---|
| `RAW_LOCATION` | coordinates, accuracy, encrypted location envelope | `RAW_GPS_30_DAYS` | Never |
| `DERIVED_VERDICT` | inside/outside/unknown assessment | `TIME_DECISION_1_YEAR` | Never |
| `TIME_FACT` | immutable workday, event, correction and approved time | `TIME_DECISION_1_YEAR` | Allowed through a narrow projection |
| `REQUEST_REASON` | request, decision and correction text | `TIME_DECISION_1_YEAR` | Never |
| `DEVICE_EVIDENCE` | enrollment, QR, signature and attestation metadata | `POLICY_DEFINED` | Never |
| `AUDIT_RECORD` | action/access accountability | `TIME_DECISION_1_YEAR` | Never |
| `EXPORT_ARTIFACT` | checksum, purpose, recipient, channel and expiry | `POLICY_DEFINED` | Never |

`src/lib/workforce/data-classification.ts` is the shared technical vocabulary.
The ordinary exporter invokes its allow-list with only `TIME_FACT`; every
other current class fails closed.

## Verification and limits

- `PASS`: classifier tests cover all seven classes and the export deny list.
- `PASS`: approved-export tests cover the payroll-free immutable projection
  and hash verification.
- `NOT RUN`: destructive purge, legal hold, backup/restore, physical mobile
  checks and production-data inspection. This checkpoint performs none of
  those operations.
