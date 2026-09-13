# Workforce employee guide

This guide covers the current Workforce web fallback. A signed Workforce mobile
attendance app and its physical QR/GPS/device-trust pilot are not yet verified,
so this document does not promise those flows.

## Record and check your day

1. Open **HRM → Today** (`/workforce`). The page reads your current canonical
   server state and shows only actions allowed from that state.
2. Submit one displayed action. Do not repeat-click or switch accounts to work
   around a pending result.
3. If the server reports a conflict, follow the displayed recovery actions and
   refresh canonical state. A retry with the same operation is idempotent; a
   changed retry is a conflict, not a second hidden workday.
4. Open **HRM → Timesheet** (`/workforce/timesheet`) to review your recorded
   dates, statuses and calculated duration. “Needs review” means the history is
   insufficient for an automatic conclusion.

## Requests and corrections

- Use **HRM → Requests** (`/workforce/requests`) to create your own leave,
  absence or time-correction request and to review/cancel your eligible pending
  requests.
- Choose the named workday shown by the server. Do not paste another employee's
  identifier or invent a date outside the allowed window.
- A request does not overwrite original evidence. An approved correction adds a
  new accountable revision so the original record remains auditable.
- Your own review items are at `/workforce/exceptions/mine`. They show a generic
  type, opaque reference and workday link without exposing security proof or
  another employee's data.

## Location, QR and device messages

GPS, QR and a registered device are separate evidence signals. None alone proves
that a named person was physically present. Permission denied, weak/stale GPS,
wrong site, a missing proof, a revoked device or a delayed offline claim must
produce a clear retry/review path rather than automatic guilt or punishment.

Never share your account, QR image, recovery code or unlocked device. If a phone
is lost, stolen, replaced or used by someone else, stop attendance actions and
contact the Workforce administrator so the device can be revoked and the event
can be reviewed.

## What to report

Report the time, displayed error code, affected workday and whether the action
was online or queued. Do not send screenshots containing QR tokens, raw GPS,
device keys, recovery codes or another employee's information.

Support follows the [Workforce sync support playbook](./workforce-sync-support-playbook.md).
Privacy or device-security concerns follow the
[Workforce incident runbook](./workforce-c10-privacy-security-incident-runbook-2026-08-30.md).
Neither process authorizes automatic payroll or disciplinary action.
