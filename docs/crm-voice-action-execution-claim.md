# CRM voice action execution claim

Status: internal lifecycle implemented; commit endpoint remains disabled.

## Boundary

`action-execution-claim.ts` is internal orchestration between the explicit UI
confirmation proof and the atomic canonical-command executor. It is not an API
route and is never registered as a model tool.

The first claim:

1. loads a tenant/user-owned `confirmation_proof_issued` event;
2. verifies its intent ID, revision, payload hash and domain-separated token
   hash using a constant-time comparison;
3. allows an already consumed proof to replay its stored claim even after the
   proof TTL, but rejects an unused expired proof;
4. repeats active-session, role, tenant-module, field-permission, record-filter,
   target-version and normalized-payload integrity checks;
5. compare-and-swaps only the exact unexpired `awaiting_confirmation` intent to
   `executing` with `confirmedAt`, `executionStartedAt` and a random 60-second
   UUID lease;
6. appends `confirmation_consumed` and `execution_claimed` in that same
   transaction.

A second proof cannot claim an already executing intent. A concurrent retry of
the same proof can replay the winner's claim and never receives a second lease.

## Recovery

Lease recovery repeats all mutable access and target checks, then replaces only
the exact lease token whose expiry is at or before the recovery timestamp. An
active lease, a different lease or a terminal intent fails closed. The new UUID
lease and `execution_lease_recovered` event commit atomically.

Recovery is retry-safe: the event correlation stores a domain-separated hash
of the expired lease and event data stores only the new lease hash. If the
response is lost, a retry with the same expired token returns the still-current
recovered claim without rotating the lease again. Raw lease capabilities never
enter the append-only event ledger.

The atomic command/result executor accepts only the current unexpired lease. A
worker holding the replaced lease therefore cannot store a CRM mutation or a
terminal result.

## Terminal failure

The failure transition accepts only an uppercase bounded error code and an
optional user-safe message of at most 500 characters. It compare-and-swaps the
current unexpired execution lease to `failed` and appends the immutable
`failed` event in one transaction. Raw exceptions, stack traces, tokens,
payloads, audio and transcripts are never written to the event ledger.

## Remaining release gate

No HTTP endpoint calls this layer yet. I1.5 must add a same-origin,
browser-session-only, rate-limited commit adapter that composes claim,
execution and safe failure classification. Until that adapter and its tests are
released, pressing the microphone cannot create or update CRM records.
