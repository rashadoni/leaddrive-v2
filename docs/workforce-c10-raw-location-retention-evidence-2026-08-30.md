# Workforce C10 raw-location retention evidence

Status: **technical slice complete; destructive execution remains fenced**.

The tenant-scoped runner in `src/lib/workforce/raw-location-retention.ts`
applies the recorded 30-day lifecycle to every current raw location copy:

- historical and latest MTM location rows;
- start/end coordinates on Workforce workdays;
- coordinate and accuracy fields on Workforce workday events;
- encrypted raw attendance evidence whose individual expiry is due.

Each class is selected deterministically with a maximum batch of 500. The
default mode is `DRY_RUN`; invalid tenants, timestamps, modes, and limits fail
before any query. Explicit `EXECUTE` rechecks the tenant and selected IDs, and
the evidence update also rechecks expiry and `rawPurgedAt` to avoid clearing a
row whose state changed after selection. Reconciliation counts make incomplete
batches visible without returning employee, event, device, QR, coordinate, or
ciphertext identifiers.

Targeted unit evidence covers dry-run non-mutation, tenant-scoped deletion and
redaction, reconciliation, UTC date cutoffs, and fail-fast bounds.

No purge was run. Scheduler exposure, legal-hold integration, pressure stops,
resume cursors, metrics, staging backup/restore, and the 5,000-user drill remain
outside this safe slice and are not claimed here.

