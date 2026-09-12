# Workforce C6 exception-notification boundary evidence

**Status:** WF-C6-009 partial
**Date:** 2026-08-31

## Implemented safety contract

`planWorkforceExceptionNotification` is a side-effect-free planning boundary
for a future Workforce-only delivery service. It deliberately does not write to
the existing Route & Field notification outbox or directly create an
`MtmNotification` row. That existing outbox has Route capability and delivery
semantics, so reusing it for HRM would make a mixed-product privacy boundary
ambiguous.

The planner permits exactly one channel: private in-app delivery. It does not
accept email addresses, phone numbers, URLs, reason text, locations,
coordinates, QR values or device proof. Its generic local-copy keys and safe
metadata contain only the Workforce domain, a notification kind and a
non-identifying reference class. The exception and recipient ids contribute
only to a SHA-256 idempotency key and never appear in the planned payload.

Employee reminders require that the case is already employee-visible, is
awaiting the employee, has an enabled in-app preference and has no prior
delivery. An aging HR-review reminder similarly requires an HR-review audience
and an awaiting-review lifecycle. Disabled or unknown preference, a non-visible
employee case, an ineligible lifecycle or any prior planned/delivered state is
explicitly suppressed. These are privacy and duplicate-delivery guards, not
an active SLA, escalation clock or HR decision.

## Deliberately not activated

No case query, durable outbox row, scheduler, retry worker, client navigation,
email/SMS/push provider or external message is enabled by this change. A
tenant-approved notification policy still needs accountable recipient mapping,
retention, channel consent, timing/escalation rules, migration and a dedicated
Workforce transaction/outbox implementation. It must preserve the generic-copy
and no-raw-evidence boundary shown here.

## Verification

    PASS  CI=true npx vitest run \
          src/__tests__/lib-workforce-exception-notification-draft.test.ts
          (1 file, 4 tests)

    NOT RUN  durable outbox/retry worker, migration apply/disposable-DB RLS,
             browser/mobile delivery, external-channel consent, staging and
             production notification tests.
