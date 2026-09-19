# CRM Voice Action-Intent Foundation

Status: schema foundation implemented; action APIs and commit execution remain disabled

Last updated: 2026-09-19

## Purpose

`AiActionIntent` is the durable safety boundary between a model proposal and a
CRM mutation. Gemini will eventually receive `propose_*` tools only. A proposal
can create or revise an intent, but the CRM command cannot run until a separate
authenticated UI request claims that intent after the user presses the exact
action button.

This table stores provider tool arguments and normalized action data. It never
stores microphone audio. Full transcripts also remain outside this record.

## Ownership and isolation

Every intent is bound to all of the following trusted server-side identities:

- tenant (`organizationId`);
- authenticated owner (`userId`);
- durable CRM voice session (`voiceSessionId`);
- optional tenant-bound parent intent for a future compound plan.

Composite foreign keys include `organizationId`, so cross-tenant user, session,
and parent references fail in PostgreSQL. The table enables and forces RLS with
the canonical `app.org_id` tenant context and the controlled maintenance bypass.
The action APIs must additionally filter every owner-facing operation by both
`organizationId` and `userId`; tenant RLS is not a substitute for per-user
authorization.

## Lifecycle

```text
collecting -> awaiting_confirmation -> executing -> succeeded
     |                |                    |-----> failed
     |                |                    `-----> stale
     |                |-----> cancelled
     |                |-----> expired
     |                `-----> stale
     |-----> cancelled
     `-----> expired
```

Editing an awaiting receipt moves it back to `collecting`, increments the
revision, recomputes normalization/preview/warnings and produces a new payload
hash before it can return to `awaiting_confirmation`.

The database rejects incoherent combinations such as:

- `executing` without confirmation, start time, lease token, and lease expiry;
- `succeeded` without a stored result;
- `failed` without a safe error code;
- an active/terminal state with timestamps belonging to another lifecycle;
- malformed payload hashes, JSON envelope shapes, or timestamp ordering.

## Concurrency and replay invariants

- `(organizationId, userId, idempotencyKey)` deduplicates repeated client
  requests and double clicks.
- `(organizationId, voiceSessionId, providerToolCallId)` deduplicates a repeated
  provider tool call inside its session.
- A partial unique index permits only one active root intent for the same
  tenant, user, and voice session. Child intents do not compete with their
  compound-plan root.
- The normalized payload hash binds `actionType`, `revision`, and canonical JSON
  using SHA-256.
- The default expiry helper is ten minutes. The action registry will be allowed
  to shorten or extend this by declared risk policy.
- Lease columns are present now so the commit worker can later claim execution
  atomically and recover an interrupted attempt without issuing a second CRM
  mutation.

## Deliberately not enabled by this slice

- no model-visible write or commit tool;
- no draft, edit, active, cancel, or commit API;
- no action registry or command dispatch;
- no confirmation UI;
- no mutation of leads, deals, or tasks through an action intent.

The next slice adds the closed action registry and server-only schemas used to
build validated drafts. Commit remains unavailable until the API, receipt UI,
explicit confirmation evidence, command re-authorization, compare-and-swap,
and idempotent result replay are all in place.
