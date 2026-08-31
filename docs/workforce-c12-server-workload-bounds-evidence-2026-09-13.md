# Workforce C12 server workload-bound evidence

**Status:** WF-C12-005 partial; server pull admission and response generation
are bounded and Android has a source-only terminal quarantine mapping, while
signed-device retry/quarantine proof and the isolated load/chaos run remain open.
**Last verified:** 2026-09-13

## Enforced server bounds

- Pull pages accept 1-500 rows and default to 200.
- Snapshot materialization writes deterministic 250-row chunks under a
  one-hour per-device/stream lease.
- Workforce/visits/tasks responses stop at 1,000,000 serialized bytes; Routes
  stops at 1,500,000 bytes. Oversize responses return `413` with a fixed
  recommendation to retry at 100 rows and do not advance a client cursor.
- Retry directives emitted by the server are finite and bounded to 1-60
  seconds; snapshot contention uses two seconds and temporary dependency
  failure uses five seconds.
- The Redis guard atomically evaluates separate stream/phase device, user and
  tenant budgets. A denial cannot consume the remaining buckets, and initial
  snapshots have their own smaller budget.

These limits protect the server and provide deterministic client recovery.
The Android encrypted outbox maps `MTM_MOBILE_SYNC_OPERATION_INVALID` and
`MTM_MOBILE_SYNC_OPERATION_TOO_LARGE` to a typed terminal
`QUARANTINED_OPERATION` state. It does not retry, delete, recreate, re-scan QR
or repeat device proof; the Recovery screen shows only localized generic
guidance. This source bridge still does not prove the signed client applies
the policy on a supported device or prevents starvation between domains.

The Android outbox also applies equal jitter inside its bounded exponential
retry window (30 seconds through six hours). Its Room deadline remains the
durable authority, while WorkManager remains scheduled whenever a recoverable
head exists—even if a worker wakes before that head is due. This prevents a
delayed head from being stranded without changing the seven-day/eight-attempt
limit, per-domain oldest-first ordering, or the rule that QR and device proof
are never persisted for replay.

## Verification

- **PASS:** Workforce API regression rejects a synthetic response over one
  megabyte with `MOBILE_SYNC_V2_PAYLOAD_TOO_LARGE` and
  `recommendedPageSize: 100`.
- **PASS:** existing v2 parser/rate/snapshot contracts cover 1-500 page bounds,
  250-row chunks, leases, independent stream budgets and bounded Retry-After.
- **PASS:** Android source contract verifies the terminal-code mapping,
  metadata-only projection and EN/RU/AZ recovery keys.
- **NOT RUN:** signed Android retry/outbox tests and isolated 5,000-user
  load/chaos; these require the external C9/C14 environment.
