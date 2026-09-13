# Workforce C10 privacy and security incident runbook

Status: **source-backed pre-pilot containment procedure**. This supplements
[`ISMS-08`](./isms/ISMS-08-incident-management.md); it does not set a legal
notification deadline, authorize a production mutation, or prove a tabletop.

## Scope and safe incident record

Use this procedure for suspected exposure of Workforce raw location, derived
attendance outcomes, QR/station material, device-enrollment material, export
output, unauthorized evidence review, or a cross-tenant read. First record a
machine-readable reference in the approved incident register. It may contain
tenant, time window, component, severity, accountable owner and audit/access
references. It must not copy coordinates, QR values, encrypted envelopes,
device keys/fingerprints, recovery codes, employee reasons or export rows.

Named Security, Privacy/Legal, HR and customer-notification owners are recorded
outside source control before a real cohort. If an owner is unavailable or the
affected tenant is uncertain, keep the incident unresolved and avoid broad
data or export actions.

## Preserve and contain

1. Follow ISMS-08: record the event and preserve immutable audit/event
   references and system state before changing a control, unless an immediate
   narrow change is required to stop ongoing harm.
2. Identify the narrowest tenant, feature path and time window. Do not query or
   export more raw data merely to make the incident summary complete.
3. For a mobile-write exposure, an authorized session administrator with
   enrolled mandatory MFA may use the existing Workforce mobile write fence
   (`FROZEN`) under its rollback procedure. This blocks only new Workforce
   mobile-write operations in the fenced stream; it does not stop evidence
   reads, web/admin paths, device collection or a device outbox. Raw-evidence
   exposure is not contained by `FROZEN` alone: separately restrict or revoke
   the affected account, session, grant and read path through the established
   identity/access incident process.
4. For an exposed QR station or device enrollment, use the scoped station
   disable or device revoke flow and preserve its immutable audit. Do not issue
   a replacement before the incident owner records recovery scope.
5. For a possibly misdirected approved-timesheet download, stop further
   handling and preserve the immutable approval/export audit reference. The
   current direct-session export has a fixed purpose and recipient marker, but
   there is no external-delivery artifact/custody workflow; do not claim one.
6. For unauthorized evidence review, preserve the metadata-only timeline audit
   and restrict the account via the established identity/session process. The
   normal timeline itself must not expose coordinates or internal evidence IDs.

## Triage

| Signal | Initial disposition | Required owner action |
|---|---|---|
| Raw GPS/envelope access or cross-tenant read | High until scoped | Security preserves access evidence; Privacy/Legal determines notice; incident owner controls containment |
| QR relay, stolen phone or compromised device | Security review; not identity proof | Revoke/recover through C5 and send affected attendance decisions to human review |
| Derived verdict seen by unauthorized account | Access-control incident | Preserve minimal audit, restrict account and review grant scope |
| Export handled by wrong recipient | Potential privacy/contract incident | Stop handling, preserve metadata and let Privacy/Legal decide notification/remediation |
| Purge, missing audit or backup concern | Integrity/availability incident | Stop deletion, preserve counts/backup state and never retry a destructive batch blindly |

## Recovery and evidence preservation

- Run only approved tenant-scoped reconciliation/read-only fingerprints after
  containment. They are diagnostics, not repair or reclassification.
- Preserve original workday/event/assessment/approval journals. Never clear
  device data, cursors or encrypted evidence to conceal the incident.
- Employee corrections, exception decisions and access revocations remain
  separate accountable actions with their own audit.
- Before re-enable, record recovery posture, affected cohort, accountable
  owner, validation range and a no-open-P0/P1 decision. Deploy remains on the
  normal reviewed GitHub release path.

## External gates and drill

- Repository privacy disclosure covers Workforce location purpose, processing
  roles and 30-day raw retention in EN/RU/AZ. Privacy/Legal still remains the
  authority for jurisdiction-specific notification timing and real notices.
- A named tabletop must exercise raw-location, device and export scenarios and
  retain attendee, time, scenario and result outside git. **NOT RUN**.
- Production fence/device mutation, legal notification and real employee
  communication are **NOT RUN** and are not authorized by this document.
