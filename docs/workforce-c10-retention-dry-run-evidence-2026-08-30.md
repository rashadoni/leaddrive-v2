# Workforce C10 retention dry-run evidence

The read-only endpoint `GET /api/v1/workforce/retention/raw-location` is limited
to a live tenant administrator session with a currently enrolled mandatory MFA
factor. It accepts only a bounded optional `limit` and always calls the runner
with `mode: DRY_RUN`.

There is deliberately no HTTP write method and no scheduler in this slice. The
response states `NOT_AVAILABLE_OVER_HTTP`; both response and error paths use
private `no-store` headers. A successful inspection must append an audit entry
before its counts are returned. The audit contains only tenant, actor request
metadata, cutoffs, limits and aggregate counts—never employee, event, device,
QR, coordinate, or ciphertext identifiers. Unexpected failures are logged by
a fixed operation label without reflecting sensitive details.

Targeted route tests prove MFA-first denial, strict limit validation,
tenant-scoped dry-run invocation, counts-only audit, lack of an execute path,
and privacy-safe containment of runner or audit failures.

The pure time/decision retention preflight separately requires a clear legal
hold result, isolated staging, a current-window restore proof, per-class leased
cursor, normal pressure, immutable audit readiness and recorded accountable
authorization. Missing or malformed evidence produces a specific blocker.
Even a complete preflight returns only `READY_FOR_EXTERNAL_EXECUTION_AUTHORIZATION`
with `execution: NOT_AVAILABLE`; it cannot approve production or delete data.

Backup/restore and destructive staging execution are **NOT RUN**; those remain
gates for any future scheduler or operational execute path.
