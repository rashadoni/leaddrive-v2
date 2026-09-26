# CRM voice action draft lifecycle API

Status: implemented without CRM command execution.

This slice adds the receipt lifecycle needed by a later confirmation UI. It
does not add a commit endpoint and cannot create or update a CRM entity.

## Routes

### `GET /api/v1/ai/voice/actions/active?voiceSessionId=...`

Returns the caller's one active root receipt for an active voice session, or
`data: null`. The lookup is bound to the authenticated organization, user and
session. Expired collecting/confirmation receipts are first moved to
`expired`. Current action permissions, field permissions, record visibility
and target revision are checked again before a receipt is returned.

### `PATCH /api/v1/ai/voice/actions/:id`

Strict body:

```json
{
  "expectedRevision": 1,
  "payload": {}
}
```

Only `awaiting_confirmation` receipts owned by the browser-session user can be
edited. The server reparses the payload through the closed action registry,
rechecks tenant modules, role and field permissions, verifies the active voice
session, rechecks a target's visibility and `updatedAt`, regenerates duplicate
warnings and preview, increments the revision and recomputes the payload hash.

The database update uses `expectedRevision` as a compare-and-swap condition.
An exact retry after an ambiguous network response returns the already stored
next revision with `replayed: true`; a different stale edit returns
`REVISION_CONFLICT`.

### `POST /api/v1/ai/voice/actions/:id/cancel`

Strict body:

```json
{
  "expectedRevision": 2
}
```

The owner can transition a `collecting` or `awaiting_confirmation` receipt to
`cancelled` with a compare-and-swap update. Repeating a completed cancellation
is safe and returns the stored cancelled receipt. Executing and terminal
receipts cannot be cancelled through this route.

## Shared controls

- browser session authentication only;
- voice pilot gate;
- same-origin JSON mutation guard for PATCH and cancel;
- per-user request rate limits;
- tenant/user/root-intent filters on every lookup and transition;
- expiry handling and safe public error codes;
- audit records for edits and cancellation;
- responses omit raw and normalized payloads.

## Deliberately absent

- no `commit` endpoint;
- no confirmation event;
- no executable command callback in the action registry;
- no model-visible CRM write tool;
- no mutation of lead, deal or task records.
