# Conversation Collaborators (Internal Participants) — Design

- **Date:** 2026-06-08
- **Status:** Design approved by user; build starting.
- **Batch:** Feature 1 of 3 (inbox/reports). Siblings (separate specs/builds): inbox status counts, Reports surfacing.

## Goal
Let an inbox user add internal colleagues to a specific customer conversation. The colleagues then see that conversation surfaced to them and get notified of new messages. The external customer never sees the collaborators. No limit on the number of internal participants.

## Decision: visibility model **B (participants)**, NOT model A (private)
Conversations stay team-wide visible — the *current* behavior, where every org user can already see every conversation. Adding a participant does **not** restrict access; it **surfaces** the conversation to the participant and **notifies** them. (Model A — private conversations gated by ACL — was explicitly considered and rejected by the user.)

Why this matters: keeps the change small and safe. No access-control rewrite, no risk of hiding conversations from people who currently rely on seeing them. "Только мы" in the request means *internal-only / the customer doesn't see them*, not *hidden from the rest of the team*.

## Data model
New table `ConversationParticipant`:
- `id`, `organizationId` (tenant scope)
- `socialConversationId` → `SocialConversation` (the canonical conversation row)
- `userId` (the internal participant), `addedBy`, `createdAt`
- **UNIQUE** (`socialConversationId`, `userId`)
- **INDEX** (`organizationId`, `userId`) — drives the "Со мной" view

Conversations without a `SocialConversation` row yet (email/SMS derived threads) get one ensured/created on first participant-add, via the same inbox resolveKey the assignee/snooze path already uses. Participants always attach to that canonical row.

## Behavior
- **Add / remove:** conversation header → **«Добавить участника»** → org-user picker → insert row. Avatars strip + remove (✕). No limit.
- **"Со мной" view:** new inbox filter listing conversations where the current user is a participant (surfaced, not buried in the team-wide list), alongside the existing assignee views.
- **Notifications:** on a new inbound message, notify all participants (reuse `createNotification`, kind `inbox.message`) — the same path the assignee notification already uses, fanned out to participants and de-duplicated against the assignee.
- **Customer-invisible:** participants are internal-only; nothing is sent outward (no "X joined" message to the customer).

## API
- `POST /api/v1/inbox/conversations/[id]/participants` `{ userId }` → add (validate `userId` ∈ org).
- `DELETE /api/v1/inbox/conversations/[id]/participants/[userId]` → remove.
- Conversation GET decorates with the participant user objects.
- Inbox list GET includes `participants` per conversation so the client can render avatars + compute the "Со мной" filter (mirrors the existing rail `viewCounts` pattern).

## Out of scope (this feature)
- Model A private conversations / per-conversation ACL.
- Real-time presence / typing indicators.
- Per-participant read receipts.

## Testing
- Unit: add/remove participant (org-scope enforced, unique constraint, no-limit), the "participating" filter, participant notification fan-out (assignee de-dup), customer-invisible (no outbound side effect).
- Local checks: `npx tsc --noEmit`, vitest, `npx prisma migrate dev`.
- Architect review per the project gate.
