# WhatsApp module

WhatsApp remains part of the CRM. Entry points are Campaigns (WhatsApp type),
Inbox, Automations, Settings → Channels → WhatsApp, and Settings → Integrations.
No separate subscription product or new customer-facing top-level menu is created.

## Campaigns

Starting a draft snapshots a normalized, deduplicated audience and its rendered
message/template in one transaction. The existing scheduled-campaign cron drains
the durable recipient queue in bounded batches. An interrupted worker never blindly
replays an in-flight request. Explicit throughput rejections can retry three times;
timeouts, provider 5xx and missing provider IDs remain **unknown** until a receipt
resolves them. Unknown is not a delivery failure suitable for an automatic resend.

The campaign detail shows recipient history and counts for pending, sending,
accepted, delivered, read, failed, unknown and skipped. API acceptance is not
delivery. Cancelling stops pending work; a request already in flight can finish.
Started campaigns cannot be edited, reset or deleted; their delivery evidence is
retained. A new campaign is required for a deliberately new send.

The worker rechecks the tenant, configured sending channel, contact opt-out and
conversation STOP preference immediately before sending. Free-form messages need
a recent inbound on the same full phone number and receiving channel (23-hour
conservative cutoff). Outside that window, select an approved template belonging
to the sending channel. Body parameters and text/image/video/document headers are
supported. Dynamic URL/copy-code buttons and location headers are rejected before
dispatch rather than silently sent without their required parameters.

The maximum audience is 50,000 unique recipients per campaign, dispatched in
batches of up to 100 per cron invocation. This is a safety bound, not a throughput
guarantee. The migration creates an empty ledger; it never replays old campaigns.

## AI and automations

WhatsApp supports the existing flow `ai_reply` action. A handled reply/menu/draft
suppresses a second default AI answer. AI respects the budget, assigned human and
owned reply lease; history uses the newest messages. Provider-accepted outgoing
messages are recorded as sent, with delivery/read driven by provider receipts.
STOP, UNSUBSCRIBE and ОТПИСКА persist an opt-out, including lead-only conversations.

AI configuration and live channel credentials are not enabled or changed by this
release. Test first in the owner's conversation before enabling a business-wide
automation. Unit tests do not establish real WhatsApp delivery or model quality.

## Phone privacy

An administrator can enable customer-phone hiding in WhatsApp settings. It is off
by default. The server reads the fresh organization setting and masks structured
phone fields, recognizable text/URL aliases and phone-derived keys in guarded JSON
responses for non-admin human users. Canonical conversation IDs keep replies usable.
Exports and unredactable responses are denied to these users. Administrators and
explicitly scoped API integrations retain their existing access.

This is not file redaction: numbers embedded in uploaded photos, recordings or
documents are not altered. The setting's UI states this limit. It does not promise
protection against arbitrary encodings or data outside the guarded CRM routes.

## Make, Zapier, Pabbly and Google Sheets

Two events are available for an administrator's explicit webhook subscription:
`whatsapp.message_received` and `whatsapp.message_status`. An API-key subscription
requires Inbox scope, rechecked at dispatch. Events carry IDs, direction, status
and timestamp only; no phone number, message content, credentials or raw provider
payload is included. Deduplicate on `data.id` (provider message ID plus status).

For example, connect a Make custom webhook or Zapier Catch Hook, select the events
in Settings → Integrations, then add a Google Sheets row action in that service.
Any subsequent CRM data lookup needs its own appropriately scoped authorization.
No external subscription is created automatically. This does not add native Google
Sheets OAuth or claim a published Zapier marketplace app.

## Release verification

Use the PR checks plus a production build. The focused queue tests cover competing
workers, restart, retry limits, opt-out, exact recipient/channel matching, early and
late receipts, cancellation and provider ambiguities. Verify the ledger migration
against PostgreSQL with RLS, cross-tenant foreign keys, recipient uniqueness and
concurrent claims. After the owner approves the visible release list, deploy via
main and verify the exact artifact SHA before testing real delivery and AI replies.

Meta partner status, immunity from WhatsApp bans, unlimited usage and seven-day
staff support are not software features established by this change.
