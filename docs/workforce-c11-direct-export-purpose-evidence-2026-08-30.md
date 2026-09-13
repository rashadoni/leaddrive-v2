# Workforce C11 — direct approved-export controls

**Status:** partial `WF-C11-004`; direct-session review download only.

## Delivered boundary

- The fixed purpose `HR_RECORD_REVIEW` is mandatory before approval lookup.
- The current recipient class is only `SESSION_DIRECT_DOWNLOAD`; no address,
  webhook, storage link or background delivery is accepted.
- A currently enrolled mandatory MFA factor is required before identifier or
  purpose parsing. Its dependency failures use a fixed log label and no-store
  response rather than forwarding provider details.
- Six valid attempts per fifteen minutes are allowed by a Redis-backed,
  tenant/principal-partitioned guard. Guard failure stops before approval read.
- Before granular cutover, compatibility is limited to a live tenant-admin
  session. After `workforce-granular-access-v1`, the caller needs an effective
  `TIMESHEET_EXPORT` grant covering the immutable employee; current team
  membership cannot widen historic scope.
- Only approval ID, revision, period, hashes, purpose, format and recipient
  class enter the audit. Rows and attendance proof never do.

## Still open

An external recipient registry, encrypted artifact store, expiry/revocation,
delivery retry ledger and incident exercise remain separate owner/security
decisions. Browser, database-backed and production checks are **NOT RUN** in
this source checkpoint.
