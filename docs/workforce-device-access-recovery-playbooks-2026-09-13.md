# Workforce device and access recovery playbooks

Status: **source-backed procedures; exercises NOT RUN**. These playbooks narrow
containment to one tenant, account, device or station. They do not authorize
database deletion, erase attendance history, prove who used a device, or set a
legal notification deadline. Use them together with the
[Workforce privacy/security incident runbook](./workforce-c10-privacy-security-incident-runbook-2026-08-30.md).

## Evidence record shared by every playbook

Open one incident/recovery record outside git before the first mutation. Record
the tenant, UTC time, scenario, accountable Security/HR operator, affected
account and lifecycle-record references, intended containment, validation and
rollback owner. Do not copy a raw QR, GPS coordinate, encrypted envelope,
device public key/fingerprint, biometric result, recovery code, employee reason
or export row into the record.

Every lifecycle change must use the tenant-scoped product operation so its
existing audit remains authoritative. A screenshot or chat message is not the
audit record. Never delete a workday, event, assessment, exception, approval or
audit entry to make recovery appear clean.

## Lost or stolen employee phone

1. Stop attendance actions on the device. Treat an authenticated session and a
   device enrollment as possibly compromised; neither proves who holds it.
2. Restrict the affected login/session through the normal identity incident
   process. This is separate from the Workforce mobile write fence.
3. Use **Report lost / revoke** for the exact active enrollment. Self-revoke is
   intentionally permitted for containment; self-approval of a replacement is
   forbidden. Do not revoke unrelated employee devices.
4. Review accepted actions from the last known-safe time using metadata-only
   review and exception records. Send uncertain actions to human review; do not
   silently rewrite time or infer absence/presence.
5. Enroll a new device only after account recovery. A different MFA-enrolled
   administrator approves the pending key. The old enrollment stays terminal
   and the replacement lineage stays visible.
6. Validate that the old enrollment is rejected and that the new enrollment is
   still unable to act before approval. Physical key deletion and signed-device
   recovery remain part of the Android matrix and are **NOT RUN** here.

Do not globally freeze Workforce merely because one phone is lost. Use the
tenant write fence only when the incident record identifies an active mobile
write exposure that cannot be contained at the account/enrollment boundary.

## Employee termination or access end

1. HR records the effective employment event through the approved lifecycle;
   mutable directory status alone is not the historical legal record. Until an
   effective event is resolvable, the system must remain `UNKNOWN` rather than
   inventing termination.
2. At the approved effective time, restrict the login/session, revoke every
   active attendance enrollment belonging to that employee, and revoke or
   expire employee-scoped Workforce grants. Each system keeps its own audit.
3. End future-effective schedule/site access by a new reviewed configuration
   revision. Do not edit historical snapshots or reuse the employee identity
   for a replacement worker.
4. Preserve workdays, events, evidence verdicts, exceptions, decisions,
   corrections and approvals for their configured retention/hold lifecycle.
5. Validate that self-service and mobile writes fail closed, old device proof is
   rejected, managers cannot newly act outside current scope, and authorized HR
   can still read the retained minimum record.
6. Rehire is a new effective lifecycle event and new access review. It does not
   reactivate a revoked device or stale privileged grant.

The current source has additive employment-history and revocation foundations,
but a measured end-to-end termination/rehire exercise is **NOT RUN**.

## Compromised Workforce administrator

1. Restrict the administrator login/session and preserve the identity/access
   audit. Do not ask the suspected account to approve its own recovery.
2. Identify its tenant-scoped device, station, policy, export, grant, exception,
   correction and approval actions from immutable audit references. Keep raw
   proof and employee reasons out of the incident summary.
3. Disable or emergency-replace only a QR station whose display material may be
   exposed. Revoke only enrollments with a recorded compromise reason. Do not
   rotate every tenant control without evidence.
4. If unauthorized mobile writes are ongoing and account/device containment is
   insufficient, an independent MFA-enrolled session administrator may move
   the exact tenant/cohort fence to `FROZEN`. Routes remain a separate module.
5. Human reviewers assess affected attendance and export decisions. Recovery
   appends a correction, exception decision, revocation or new configuration
   version; it never overwrites the original fact.
6. Before restoring privilege, require a different accountable administrator,
   enrolled MFA, least-privilege scope, reviewed effective window and explicit
   validation that no open P0/P1 remains.

## Exercise and acceptance record

Run all three scenarios in isolated staging before a named pilot. Record start
and containment times, participants, exact lifecycle transitions, expected and
actual rejection codes, retained audit references, reconciliation result and
rollback outcome. The exercise must prove:

- old device/session/grant paths fail closed without deleting history;
- replacement approval keeps separation of duties;
- a narrow freeze does not stop Routes and is reversible by an accountable
  forward transition;
- no raw proof, location or reason enters general logs/evidence packets; and
- recovery produces no duplicate or lost canonical workday event.

No such measured exercise is recorded in this repository, so WF-C5-012 remains
partial and the physical/pilot gates remain open.
