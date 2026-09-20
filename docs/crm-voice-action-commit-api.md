# CRM voice action commit API

Status: session-only commit adapter implemented; receipt UI is not wired yet.

## Endpoint

`POST /api/v1/ai/voice/actions/:id/commit`

Strict request body:

```json
{
  "confirmationEventId": "confirmation-event-id",
  "confirmationToken": "43-character-base64url-token",
  "expectedRevision": 2,
  "payloadHash": "64-lowercase-hex-characters"
}
```

The route accepts only an authenticated browser session and same-origin JSON
mutation. Bearer/API-key callers, cross-origin requests, extra authority fields
and malformed proof data are rejected before a claim. The voice pilot gate is
rechecked. The endpoint is not present in the Gemini Live tool contract, so the
model cannot invoke it or fabricate commit authority.

## Execution flow

1. Enforce separate one-minute buckets for the user (20), tenant (200), and
   individual intent (10).
2. Consume the exact single-use confirmation proof and atomically claim the
   reviewed intent.
3. Replay a stored terminal result for the same consumed proof.
4. Recover only the exact expired execution lease after repeating mutable
   authorization and target-version checks.
5. Execute the canonical CRM command and store its minimal result in the same
   transaction as the CRM mutation and immutable `succeeded` event.
6. Convert controlled canonical-command validation, permission, not-found and
   stale-write failures into a bounded terminal `failed` transition.
7. Leave unknown database/process failures recoverable and return
   `COMMIT_RETRY_REQUIRED` with HTTP 503.

Successful and error responses use `Cache-Control: private, no-store`. The raw
confirmation token and execution lease never appear in the response, logs or
immutable event ledger.

## Idempotency and interruption handling

A double click or lost response may repeat the same proof. The proof maps back
to the winning claim; a completed action returns the stored result without
running the command again. An unexpired lease is reused. An expired lease is
replaced only through compare-and-swap against that exact previous lease.

Canonical record mutation, intent success, result receipt and success event are
one transaction. A losing concurrent request rolls its CRM mutation back. A
failure after that transaction commits is safe: the next request replays the
stored success.

## Remaining product gate

The API boundary exists, but the voice receipt UI does not call it yet. The
next phase must build the session-scoped receipt panel and explicit user button
before normal users can confirm actions through the product. Global, tenant and
per-action rollout flags and action-specific canaries remain separate release
work; no model-visible write tool is planned.
