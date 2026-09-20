# CRM voice action confirmation proof

Status: proof issuance and internal single-use consumption implemented; commit
endpoint remains disabled.

## Purpose

The model may propose an action, but it never receives a commit capability.
The browser receipt UI will call a separate session-only endpoint after the
user activates an explicit confirmation button. That endpoint records durable
evidence and returns a short-lived proof which a future commit endpoint must
consume exactly once.

## Endpoint

`POST /api/v1/ai/voice/actions/:id/confirmation`

Strict request body:

```json
{
  "expectedRevision": 2,
  "payloadHash": "64-lowercase-hex-characters",
  "confirmed": true
}
```

Before issuing proof, the server verifies:

- browser session authentication and same-origin JSON mutation controls;
- the voice pilot gate and a dedicated per-user rate limit;
- organization, user and root-intent ownership;
- `awaiting_confirmation` state and unexpired intent TTL;
- exact revision and payload hash shown by the receipt;
- recomputed hash of the stored normalized payload;
- current role, tenant-module and field permissions;
- active voice-session ownership;
- target record visibility and unchanged `updatedAt` revision.

The response contains a cryptographically random 256-bit token and event ID,
is marked `private, no-store`, and expires after 60 seconds. Only a domain-
separated SHA-256 token hash and expiry are stored. Raw tokens, CRM payloads,
microphone audio and transcripts are not written to the event ledger.

## Append-only evidence

`AiActionIntentEvent` is tenant-bound through composite foreign keys, forced
RLS, SELECT/INSERT-only application policies, a closed event vocabulary and
database checks for revision, payload hash and JSON shape. Database triggers
reject direct UPDATE, DELETE and TRUNCATE operations while preserving required
foreign-key cascades.

The table records `drafted`, `draft_updated`, `cancelled`, `expired`,
`confirmation_consumed`, `execution_claimed`, `execution_lease_recovered`,
`succeeded` and `failed` in the same transaction as their corresponding intent
mutation. A failed compare-and-swap appends nothing. Proof issuance remains an
immutable event of its own because it does not mutate the intent.

## Safety boundary

This endpoint does not set `confirmedAt`, move the intent to `executing`, call
a canonical CRM command, or mutate a lead, deal or task. A commit route is not
present. Internal orchestration can now consume the event/token once, repeat
all access and target checks, and claim execution by compare-and-swap, but it
is unreachable from HTTP and unavailable to the model. See
`docs/crm-voice-action-execution-claim.md` and
`docs/crm-voice-action-execution-boundary.md`.
