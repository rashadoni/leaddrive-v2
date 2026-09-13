# Workforce sync support diagnostics and escalation

Use this playbook for a field report such as “my work time did not update”,
“the app asks to retry”, or “Routes works but Workforce does not”. It is not a
raw-log export or an attendance decision procedure.

## Safe inputs

Ask for the approximate time, app version shown in the app, affected module and
the visible machine error code. Never ask an employee to send a JWT, QR image,
device key/signature, biometric screenshot, exact GPS coordinates or the text
of an HR reason.

An SRE may provide the 16-hex tenant pseudonym already present in the server's
`mtm-mobile-sync-telemetry` event. Do not give the diagnostic tool a raw tenant,
employee, user or device ID. Run it on a bounded log excerpt through stdin:

```bash
journalctl --since "30 minutes ago" -u leaddrive --no-pager \
  | node scripts/workforce-sync-diagnostics.mjs --tenant 0123456789abcdef
```

The output contains only fixed streams/results, aggregate counts, bounded
latency, payload/row totals and at most 20 syntactically valid APK-version
buckets. It omits the pseudonym itself and discards foreign, malformed or
high-cardinality events. Do not attach the source log excerpt to a support
ticket.

## Resolution order

1. Confirm the public `/api/v1/ping` and build-info SHA. If unhealthy or not
   the expected release, escalate as a platform/deploy incident.
2. `forbidden` means the authenticated Field permission is absent;
   `cohort_disabled` means the exact device is not in that stream's v2 pilot.
   Verify the server-side entitlement/cohort; never copy another device row.
3. `invalid_request` means update the supported app or correct its local
   configuration. Do not ask for a token or full request payload.
4. `invalid_cursor` or `resnapshot_required` rebuilds only the named stream.
   Preserve the encrypted mutation outbox and every other stream cursor.
5. `payload_too_large` retries that stream at the returned smaller page size.
6. `rate_limited` respects `Retry-After`; repeated manual retrying worsens the
   incident. `unavailable` also retries only the named stream.
7. If an accepted business operation is missing, stop ordinary troubleshooting
   and reconcile by operation ID through the restricted operator workflow. Do
   not recreate a START/FINISH, edit an approved timesheet or clear an outbox.

## Escalation

- **Security/privacy:** any token, QR, key, biometric material, raw location or
  employee reason in telemetry; stop collection and follow the Workforce
  privacy/security incident runbook.
- **P0 reliability:** confirmed cross-tenant data, lost/duplicated accepted
  business event, or Route/Workforce cross-stream blocking; freeze cohort
  expansion and invoke the pilot rollback runbook.
- **SRE:** sustained `unavailable`, oldest pending growth, p95/p99 breach,
  resnapshot spike or deploy SHA mismatch. Include only this aggregate report,
  time window, build SHA and machine codes.
- **HR review:** disputed attendance, evidence verdict, exception, correction
  or approval. Support must not infer presence, lateness, pay or discipline.

Close the ticket only after the user sees canonical server state or the case is
handed to the accountable queue. “Cleared local data” is never an acceptable
resolution.
