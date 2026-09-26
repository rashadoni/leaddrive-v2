# CRM Voice Action Draft API

Status: implemented in shadow mode; CRM execution remains disabled

Last updated: 2026-09-19

## Endpoint

`POST /api/v1/ai/voice/actions/draft`

The endpoint creates or idempotently replays an unconfirmed action receipt. It
does not call a CRM command and cannot modify a lead, deal, task, contact, or
company.

The route accepts only an authenticated browser session and same-origin JSON.
Bearer/API-key requests, cross-origin requests, disabled voice access, inactive
voice sessions, missing target permissions, and unknown actions fail closed.

## Request contract

```json
{
  "voiceSessionId": "server-issued voice session id",
  "actionType": "create_lead",
  "payload": {
    "contactName": "Ali Mammadov",
    "phone": "+994501234567"
  },
  "idempotencyKey": "draft:lead:client-generated-key",
  "providerToolCallId": "optional provider call id",
  "targetEntityId": "required only for update/convert actions"
}
```

Tenant and actor identity are never accepted in the body. They are derived from
the authenticated session. `targetEntityId` is a browser/server binding point;
future Gemini proposal tools must use server-side entity resolution and must not
be allowed to fabricate trusted record identifiers.

## Closed action registry

Exactly these actions are registered:

| Action | Canonical command | Permission | Risk / TTL | Dedupe policy |
| --- | --- | --- | --- | --- |
| `create_task` | `createTaskCommand` | `write:tasks`, CRM module | standard / 10 min | idempotency key |
| `create_lead` | `createLeadCommand` | `write:leads`, Sales module | standard / 10 min | contact coordinates |
| `update_lead` | `updateLeadCommand` | `write:leads`, Sales module | sensitive / 5 min | target revision |
| `create_deal` | `createDealCommand` | `write:deals`, Sales module | standard / 10 min | name and relations |
| `convert_lead_to_deal` | `convertLeadToDealCommand` | `write:leads` plus `write:deals`, Sales module | sensitive / 5 min | target revision |

The registry contains canonical command identifiers but no executable command
callback. This makes accidental execution through the draft route impossible.

## Validation and isolation

Before creating a receipt, the server verifies:

1. Interactive same-origin JSON request.
2. Authenticated browser session.
3. Voice pilot access and request rate limit.
4. Closed action type and per-action field allow-list.
5. Canonical command schema.
6. Role permission and tenant module.
7. Per-field edit permission, with permission-store errors failing closed.
8. Voice-session tenant, owner, active status, and expiry.
9. Target record visibility for update/conversion.
10. Target `updatedAt`, bound into the normalized payload and payload hash.
11. User idempotency key and provider-call idempotency.
12. One active root action per user voice session.

Lead updates exclude status, score, conversion, customer-stage, and other
system/qualification fields. Update and conversion previews bind to the current
lead revision. A changed record causes a stale conflict instead of silently
reusing an old receipt.

## Response contract

The response returns only the receipt envelope:

- intent ID and voice-session ID;
- action type, state, and revision;
- payload hash and expiry;
- translation-key-based preview;
- duplicate warnings;
- optional target reference;
- `replayed`, showing whether the response came from idempotent replay.

Raw provider arguments and normalized internal payloads are not returned.

New receipts enter `awaiting_confirmation` with no confirmation timestamp. A
future UI may display the receipt, but no button can execute it until the
separate commit API and its compare-and-swap security checks are implemented.

## Deliberately unavailable

- no `commit` endpoint;
- no model-visible proposal or write tool;
- no spoken confirmation;
- no direct command callback in the registry;
- no CRM mutation from the draft route;
- no compound action plan.
