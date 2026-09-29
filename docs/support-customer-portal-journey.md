# Customer Support Portal continuity map

This document fixes the customer-facing contract for the Support journey. It is
not a second ticket workflow: every portal action changes the same ticket and
public conversation that an authorized Support agent sees.

## Journey and recovery

| Stage | Customer action | Server contract | Visible states | Continuity and recovery |
| --- | --- | --- | --- | --- |
| Create | Enter subject, category and details; optionally mark an enabled complaint | POST /api/v1/public/portal-tickets derives organization/contact from the signed portal session, derives internal priority from the category, and stores a client request ID | draft, offline, sending, error, created | A seven-day device draft survives reload/error/offline. The same request ID is replay-safe for normal retries; the form locks while sending. Success opens the exact ticket. |
| Track | Search and open one owned ticket | List/detail queries require both session organization and contact ID | loading, empty, no results, stale refresh, error/retry, current status and next public SLA target | Background refresh never replaces usable data with a skeleton. Customer copy maps the same lifecycle to localized public labels and never exposes agent, escalation, policy, breach or priority controls. |
| Reply | Write a public reply | POST /api/v1/public/portal-tickets/[id] verifies ticket ownership and creates only a non-internal customer comment | local draft, offline, sending, error, sent | Text and the UUID remain on-device until success. A ticket/comment unique request ID makes a repeated send return the existing comment instead of duplicating it. |
| Attach | Upload up to ten files to the reply draft | Ticket-scoped upload validates size, extension, MIME and bytes; an attachment remains unbound until the reply transaction binds it | upload percentage, ready, delete, upload error, reconnect/reconcile | Saved attachment IDs are reconciled after reload. Download requires the same organization/contact-owned ticket and a public comment (or the customer's own unbound draft). Internal-comment files never qualify. |
| Resolve | Read the agent's public resolution and rate it | Resolved/closed remain terminal public statuses; CSAT is accepted only for an owned terminal ticket | resolved, closed, rating sending/error/saved | Rating does not reopen the ticket and is separately retryable. |
| Closure request | Open the opaque confirmation link | The token is hashed. A minimal bypass lookup resolves only its organization; all ticket/request reads and mutations then run in that tenant | loading, invalid/expired/error/retry, pending, confirmed, rejected, canceled | An empty or invalid action cannot close a ticket. A repeated valid action returns the already recorded outcome. |
| Confirm | Confirm that the issue is resolved | Confirmation and ticket closure commit in one transaction | closing, confirmed, error/retry | Failure leaves the pending request actionable; success removes both actions. |
| Return/reopen | Reject closure or reply to a resolved/closed ticket | Rejection and ticket reopen commit together; a terminal ticket reply and its attachments also reopen in the same transaction | returning, returned, send-and-reopen, reopened | No UI may show a sent reply while the ticket silently remains terminal. Duplicate retries do not increment reopen count twice. |
| Chat/handoff | Ask the automated helper or choose manual support | Chat availability follows the shared Support AI flag; a degraded provider response is labelled as incomplete | checking, disabled, unavailable, offline, sending, degraded, escalated | Disabled/unavailable/degraded AI always leaves a 44 px manual ticket action. The message draft is carried into the ticket form, so handoff does not erase the request. |

## Customer-safe projection

The portal may expose ticket number, subject, customer description, public
status, category label, creation/update dates, the next customer-relevant SLA
target, public comments and their safe attachment metadata, and the customer's
CSAT. It must not expose internal comments or attachments, assignee/team/queue,
priority controls, SLA policy name, breach/escalation state, entitlements,
internal tags, requester snapshots, audit records, automation controls or agent
actions.

## Isolation boundaries

- Every authenticated portal ticket list/detail/reply/rating/file request starts
  from the verified portal session and predicates on both organizationId and
  contactId.
- Article list/detail reads predicate on the session organization and published
  status; draft, archived and another tenant's articles resolve as not found.
- File reads additionally predicate on ticket ID and either a public comment or
  the current contact's unbound draft. File paths are basename-confined and
  responses are private, non-sniffable and sandboxed.
- Closure links use 256-bit opaque tokens stored only as hashes. The only RLS
  bypass returns organizationId; the hash is queried again inside that tenant.
- Unknown, cross-tenant and cross-contact resources use the same 404-shaped
  response. The client receives no ownership hint.

## Responsive and input contract

At desktop/tablet widths, ticket facts and primary actions stay in a compact
reading order; at mobile width, actions stack without disappearing. All primary
targets are at least 44 px, forms use native labels, status/error feedback is
announced, desktop reply supports Ctrl/Command+Enter, chat supports Enter with
Shift+Enter for a new line, and mobile retains explicit Send buttons. Loading
motion stops under prefers-reduced-motion; light and dark use semantic theme
tokens rather than a separate portal palette.
