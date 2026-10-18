# Non-Fund write-path and external-effect inventory

Status: **K0.2 PARTIAL — bounded static evidence, not all-module adoption.**

Reviewed task tree: `1a37a4f44bc03b4df7bdf685fad12d6b2355016d`,
`codex/kafka-test-stack-20261017`, 2026-10-17. This records the code in that
snapshot, not a claim about the latest main or live configuration. It extends
the [Fund inventory](./WRITE_PATH_INVENTORY.md), without repeating Fund's
transaction/projection contract. Progress and release evidence belong in the
[session journal](../kafka-readiness-session-log.md).

Only the entrypoints and helper boundaries identified below were inspected.
Runtime tests, production inspection, provider calls, backup/restore and replay
were **NOT RUN**. Warehouse and Accounting remain outside this work and follow
their separate card-by-card process. No domain is declared fully migrated.

## 1. Shared interpretation and tenant boundary

- [withRls / withRlsAuth](../../src/lib/with-rls.ts) resolve the principal and
  organization before entering the handler's tenant scope; authorization depends
  on the wrapper and principal type. [Inbox writes](../../src/lib/inbox/route-auth.ts)
  additionally use a session-write boundary. Preserve these distinctions in a
  worker; a tenant ID carried in an event is not itself authorization.
- Provider ingress usually resolves the organization through a bounded lookup
  and then uses [runWithTenant](../../src/lib/rls-context.ts). The
  [Prisma boundary](../../src/lib/prisma.ts) supplies transaction-local RLS
  context. Signature/secret validation and tenant routing must precede event
  admission; a replay worker must not rediscover tenant ownership from today's
  mutable channel settings.
- A search for `appendDomainEvent`, `enqueueEffect`, `consumeIdempotently` and
  `processKafkaEvent` in `src/app` and `src/lib` found canonical append calls in
  Fund routes, but no adoption of these entrypoints in the inspected non-Fund
  chains. This is a named-symbol search, **not** proof that every alias, SQL
  trigger, script or dynamic writer has been classified.
- [EffectOutbox helper](../../src/lib/event-platform/effects.ts) rejects
  shadow/replay effects because its reviewed replay-safe registry is empty.
  Direct senders below do not automatically inherit that fence. A database
  audit row, provider receipt, HTTP request ID or in-memory callback is not a
  canonical event/command receipt simply because it records activity.

## 2. CRM and Sales: actual REST command chains

| Entrypoint → writer | Tenant boundary and writes/effects | Observed duplicate behavior | Replay risk / integration boundary |
|---|---|---|---|
| [POST leads](../../src/app/api/v1/leads/route.ts) → [createLeadCommand](../../src/lib/crm-commands/lead/create-lead.ts) | `withRlsAuth("leads", "write")`; actor carries resolved org/user/request ID. Writes Lead, scores it, then triggers audit, assignment, workflows, profile refresh, notifications and webhooks. | Email/phone matching returns `POSSIBLE_DUPLICATE` warnings; creation still proceeds. No command receipt was found in this inspected REST chain. | Re-running the create command can create another Lead and another effect fan-out. Persist a command identity and event in the business transaction before adapting this path. |
| [PUT/PATCH lead](../../src/app/api/v1/leads/[id]/route.ts) → [update command](../../src/lib/crm-commands/lead/update-lead.ts); DELETE remains in the route | Tenant/record filtering; updates through the command, direct tenant-filtered delete for deletion. | Inspected REST caller forwards `x-request-id` as actor metadata, not a canonical idempotency receipt. Full update-side effect branches are **NOT EXHAUSTIVELY INSPECTED**. | Do not use the live REST command as a projection reducer. Preserve delete semantics and establish a deletion/tombstone contract separately. |
| [POST lead conversion](../../src/app/api/v1/leads/[id]/convert/route.ts) → [conversion command](../../src/lib/crm-commands/lead/convert-lead-to-deal.ts) | Tenant-scoped transaction conditionally marks Lead converted; reuses/creates Company and Contact and creates Deal. Effects run after the conversion transaction. | Conditional claim and already-converted check stop a second conversion. A repeat is a validation rejection, not retrieval of a durable command response. | Preserve this atomic claim. Projection rebuild must not convert again or dispatch the Deal/Lead-created effects. |
| [POST deals](../../src/app/api/v1/deals/route.ts), [PUT/PATCH deal](../../src/app/api/v1/deals/[id]/route.ts) → [create](../../src/lib/crm-commands/deal/create-deal.ts) / [update](../../src/lib/crm-commands/deal/update-deal.ts) | `withRls`, explicit tenant actor and command permissions. Direct Deal mutation; stage transition fan-out includes workflows, webhooks, activity/notifications, attribution invalidation, sequence exits and a loyalty hook. | Update supports an expected-version check for callers that supply it; stage effects compare old/new stage. The loyalty call supplies `referenceId=deal.id`; see the partial loyalty appendix below. No general REST command receipt was found. | State-transition checks are not rebuild isolation. Reconstructing a prior stage and applying the live update would re-enter live hooks. Voice receipt adapters are a separate, **NOT INSPECTED** boundary. |
| [POST contacts](../../src/app/api/v1/contacts/route.ts) | `withRls`; writes tenant Contact directly, then existing hooks/audit. | No stable request claim observed in the inspected create path. | Contact replay needs canonical identity and explicit projection writes; bulk/import/contact-update paths remain outside this pass. |
| [POST deal send-email](../../src/app/api/v1/deals/[id]/send-email/route.ts) | Authenticated tenant lookup of Deal and Contact; temporary attachments, direct `sendEmail`, then Activity creation. | No request/effect key is passed to the sender in this route. | A retry after provider acceptance or Activity failure can send again. Preserve attachments by safe references; do not put customer bodies/files into inventory or replay evidence. |

The shared [CRM execution context](../../src/lib/crm-commands/execution-context.ts)
can collect callbacks until a caller-owned transaction commits. Without that
transaction it dispatches immediately; collected callbacks are still in-memory
and failures are logged. This is useful transaction ordering, not a durable
effect outbox or crash-recoverable dispatcher.

## 3. Support and email intake

| Entrypoint → writer | Tenant boundary and writes/effects | Observed duplicate behavior | Replay risk / integration boundary |
|---|---|---|---|
| [POST tickets](../../src/app/api/v1/tickets/route.ts) → [ticket factory](../../src/lib/ticket-factory.ts) | Tenant wrapper; transactional ticket-number allocation, Ticket and entitlement milestone creation; assignment and hooks follow. Factory is also called from AI/inbox/web-chat paths. | Ticket-number locking/retry avoids number collisions; it does not identify a repeated business request. `fireHooks:false` exists for callers that own a separate claim. | Number uniqueness is not request dedupe. Inventory each alternate caller's claim before promoting the factory to an event consumer. |
| [PUT ticket](../../src/app/api/v1/tickets/[id]/route.ts) | Tenant-filtered state writes; closure/update paths can invoke notifications and email/WhatsApp helpers. | State-change conditions exist; no global canonical command/effect receipt established in this pass. | Rebuild ticket views independently from live closure/survey/customer-send paths. DELETE, PATCH, attachments, SLA jobs and portal variants need their own complete inventory. |
| [POST ticket comment](../../src/app/api/v1/tickets/[id]/comments/route.ts) | Tenant Ticket check; transaction creates comment and claims attachments. After commit, non-replayed requests can notify, update response milestones and send WhatsApp. | Optional `clientRequestId`; [unique `(ticketId, clientRequestId)` index](../../prisma/migrations/20260904233000_add_ticket_attachments_and_comment_idempotency/migration.sql), content checks and P2002 recovery return existing comment. Legacy requests without key/attachments directly create a new comment. | Existing replay detection suppresses the send tail. A crash after comment commit but before the tail is not repaired by replaying that request; durable effect recovery is still distinct work. Do not remove the existing key. |
| [POST public/email-inbound](../../src/app/api/v1/public/email-inbound/route.ts) | Shared-secret admission; ticket/contact/intake routing resolves org before tenant work. Writes comments, EmailLog and ChannelMessage and may create a Ticket. | Message-ID checks protect portions of EmailLog/ChannelMessage ingestion; the email/SMS partial unique index protects non-null external IDs. | In the existing ticket branch, reopen/comment work precedes the EmailLog duplicate check; in the contact branch, TicketComment creation also precedes that check. Dedupe of the log is not dedupe of the whole intake transaction. Missing-ID and concurrent intake/create paths need separate tests. |

The [email route matcher](../../src/lib/ticketing/email-intake.ts) maps configured
recipient addresses to tenant intake routes; it is not an event/effect receipt.
Do not run old emails through live intake to rebuild support analytics.

## 4. Marketing campaign sends and derived attribution

| Entrypoint → writer | Tenant boundary and writes/effects | Observed duplicate behavior | Replay risk / integration boundary |
|---|---|---|---|
| [POST campaign send](../../src/app/api/v1/campaigns/[id]/send/route.ts) → [sendCampaign](../../src/lib/campaigns/send-campaign.ts) | Tenant campaign-write authorization. Shared sender invokes email/SMS/WhatsApp/Telegram per recipient, then updates campaign state/counters and contact/attribution data. | Manual route refuses `sending`; its conditional `scheduled → sending` claim only applies to scheduled campaigns. No equivalent claim is taken by that route for other statuses. | Do not assume one campaign-level claim protects all manual sends or each recipient. Preserve an explicit run/recipient/channel business key; ambiguous partial sends must reconcile, not restart the recipient loop. |
| [Scheduled cron](../../src/app/api/cron/campaign-scheduled-send/route.ts) → [scheduled worker](../../src/lib/campaigns/scheduled-send-job.ts) | Cross-tenant due discovery, then `runWithTenant` for each claim/send; bounded batch. | Conditional scheduled claim competes with manual send. Refusal before sending can return to draft; an exception while sending leaves `sending` for manual review. | Preserve the no-automatic-resend behavior. Claim state is not proof of per-recipient delivery or a Kafka offset checkpoint. |
| [Touchpoint recorder](../../src/lib/marketing-attribution/touchpoint-recorder.ts) | Caller-supplied tenant and optional transaction; creates derived CampaignTouchpoint rows. | Deterministic `sourceKey`, `createMany(skipDuplicates:true)`; helpers include email-log-based keys and campaign/contact SMS keys. | Useful projection identity, not evidence that the original external send happened exactly once. Best-effort live recording can fail independently; reconstruct only from verified source facts without calling senders. |

Campaign CRUD, A/B winner processing, segmentation, attribution recomputation,
tracking callbacks, sequence/cadence workers and all social broadcast variants
are **NOT EXHAUSTIVELY INSPECTED**. No claim that Marketing is event-sourced.

## 5. Omnichannel sends and provider ingress

| Entrypoint → writer | Tenant boundary and writes/effects | Observed duplicate behavior | Replay risk / integration boundary |
|---|---|---|---|
| [POST inbox](../../src/app/api/v1/inbox/route.ts) → [sendConversationReply](../../src/lib/inbox/send-conversation-reply.ts) | Session inbox-write authorization and tenant-scoped target resolution; external transport then ChannelMessage/conversation updates. | Chatwoot-backed delivery has a tenant/conversation lock, durable pending row, namespaced operation key, payload hash and unknown-outcome fence. Confirmed repeated operations do not send again. Other inspected email/SMS/Telegram/WhatsApp branches call their senders directly; they do not acquire that Chatwoot claim. | Preserve Chatwoot claims/reconciliation and avoid claiming universal coverage from the optional `deliveryIdempotency` field. Every remaining transport needs its own durable effect contract. |
| [POST conversation messages](../../src/app/api/v1/inbox/conversations/[id]/messages/route.ts) | Session inbox-write scope, tenant Conversation lookup; direct WhatsApp/Telegram/Facebook/Instagram/VK branch, then outbound row and conversation update. | No operation receipt/key in this inspected route. Rejects synthetic `platform="inbox"` anchors. | This alternate direct-send entrypoint must be included; adapting the main inbox sender alone leaves a bypass. |
| [WhatsApp webhook](../../src/app/api/v1/webhooks/whatsapp/route.ts) | Validates Meta signature, resolves the channel, enters its tenant scope; message processing can create/link contact, message, conversation and run automation/AI/ticket tails. | [Meta dedupe helper](../../src/lib/social/meta-inbound-idempotency.ts) checks provider ID and catches duplicate insert; [partial unique index](../../prisma/migrations/20260920160000_meta_inbound_idempotency/migration.sql) covers tenant/external ID for inbound WhatsApp/Facebook/Instagram. | Persisting the inbound row and completing every downstream tail are not one atomic canonical consumer checkpoint. Re-entry must distinguish already-ingested from downstream-complete. Call/status/media subpaths were not exhaustively reviewed. |
| [Chatwoot webhook](../../src/app/api/v1/webhooks/chatwoot/route.ts) | URL-secret channel resolution rejects ambiguous ownership, then tenant scope; inbound messages feed conversation/flow/reply logic. | External-message-ID check, additional same-content check, and [TikTok-channel partial unique backstop](../../prisma/migrations/20260620050000_inbound_tiktok_external_unique/migration.sql). Chatwoot transport is represented as TikTok in this path. | Preserve transport identity separately from UI channel labels. Polling/repair in [chatwoot-inbound](../../src/lib/inbox/chatwoot-inbound.ts) is a separate writer and only its dedupe boundary was inspected, not its entire lifecycle. |
| [Telegram webhook](../../src/app/api/v1/webhooks/telegram/route.ts) | Bot-token channel lookup; configured secret-header check; tenant scope after routing. Direct ChannelMessage create, conversation link, notification and optional auto-reply. | Stores `message_id` as external ID and chat ID in metadata. No whole-handler update-ID claim or duplicate short-circuit was observed in this route; the inspected Meta/email/SMS unique indexes do not cover Telegram. | Re-delivery can repeat effects. Any new identity must include bot/channel and chat scope, not assume Telegram message ID is globally unique. Demo-update consumption is a separate, **NOT INSPECTED** branch. |
| [SMS inbound](../../src/app/api/v1/webhooks/sms-inbound/route.ts) | Configured org and verified shared secret, then tenant scope. STOP writes suppression; other messages are ingested by a fire-and-forget task before an immediate TwiML response. | Provider message ID check plus [email/SMS partial unique index](../../prisma/migrations/20260609071733_channel_message_inbound_idempotency/migration.sql); P2002 treated as duplicate. Without provider ID this key is unavailable. | HTTP acknowledgement can precede durable ingestion. Keep STOP/compliance semantics separate; durable admission and downstream delivery need distinct receipts. |

[Conversation event dispatch](../../src/lib/inbox/conversation-events.ts) invokes
flag-gated flows and blocks on unconfirmed outbound delivery. Its
[action executor](../../src/lib/inbox/conversation-actions.ts) supplies operation
keys to `sendConversationReply`; this does not turn all transport branches into
Kafka-fenced effects. Full AI, chatbot, flow, media and reconciliation paths are
**NOT EXHAUSTIVELY INSPECTED**; preserve existing unknown-delivery terminal gates.

## 6. Voice calls and authentication SMS

| Entrypoint → writer | Tenant boundary and writes/effects | Observed duplicate behavior | Replay risk / integration boundary |
|---|---|---|---|
| [POST calls](../../src/app/api/v1/calls/route.ts) | `withRlsAuth("voip", "write")`; tenant channel and owned-reference checks. Transaction locks operation identity/permissions, creates CallLog before `provider.initiateCall`. | Required idempotency header namespaced by user; tenant advisory lock, existing-row payload/target checks, replay response and unknown-outcome no-redial behavior. [DB dispatch fence](../../src/lib/voip/outbound-dispatch-lock.ts) and [process fence](../../src/lib/voip/outbound-dispatch-gate.ts) remain distinct. | Preserve the durable call identity and never invoke `initiateCall` during reconstruction. CallLog repair and initiating a new physical call are different permissions. Other call modes/providers require separate evidence. |
| [Twilio call webhook](../../src/app/api/v1/calls/webhook/route.ts) | Resolves existing non-AI Twilio CallLog, validates Twilio signature with selected configuration, then tenant scope. Updates call and creates Activity/contact events for terminal statuses; missed inbound call can run workflows. | Lookup by CallSid identifies the call, but the inspected terminal branch creates Activity on each invocation; no callback receipt/terminal-transition compare-and-swap protects that whole tail. | Callback replay is not harmless: duplicate activity and missed-call automation can recur. Other [Asterisk lifecycle](../../src/app/api/internal/asterisk/call-lifecycle/route.ts) and [3CX callbacks](../../src/app/api/v1/calls/webhook/threecx/route.ts) are **NOT INSPECTED**, not assumed equivalent. |
| [SMS OTP send](../../src/app/api/v1/auth/sms-otp/send/route.ts), [2FA resend](../../src/app/api/v1/auth/resend-sms-2fa/route.ts) → [sendOtp / sendSms](../../src/lib/sms.ts) | OTP send uses tenant scope when org resolves, explicit bypass for pre-auth no-org writes; 2FA resend authenticates the user and uses stored verified phone/org. `sendOtp` invalidates prior unused codes, inserts a bcrypt hash, then sends SMS. | Phone/IP or per-user throttles at routes; [rate limiter](../../src/lib/rate-limit.ts) uses process-local state. No durable command/effect receipt in `sendOtp`. Tenant customer SMS requires tenant provider; auth OTP explicitly permits environment-provider fallback. | A replay can invalidate a valid code and incur another billable SMS. Exclude OTP generation/delivery from replay; no plaintext code, token or recipient PII in canonical recovery evidence. Other OTP/auth callsites and provider callback variants are **NOT INSPECTED**. |

## 7. Shared senders and legacy dispatch are migration boundaries

- [Email sender](../../src/lib/email.ts) applies existing configuration/compliance
  handling and EmailLog writes, then Resend/Postmark/SMTP delivery. Default
  `allowProviderFallback=true` can progress to another provider after an
  unconfirmed attempt; callers can explicitly disable fallback. The inspected
  direct Deal/inbox/campaign callers do not supply a durable effect key. Keep
  delivery-unknown reconciliation separate from definite failure; do not replay
  this helper as a reducer. Dedicated email delivery-job paths are **NOT INSPECTED**.
- [SMS sender](../../src/lib/sms.ts) resolves tenant/provider settings and invokes
  the provider. Logging/rate limits at callers are not a provider idempotency
  guarantee. Provider-specific reconciliation and external receipt retention are
  **NOT INSPECTED**.
- [Custom webhook dispatch](../../src/lib/webhooks.ts) rechecks tenant/creator
  authority and generates one delivery UUID for retries within that invocation.
  Transport-unknown exceptions stop retries. A new invocation generates a new
  UUID: this is not a persisted event/subscription effect identity across replay.
  Marketplace connector dispatch is a different path and remains **NOT INSPECTED**.
- [Workflow engine](../../src/lib/workflow-engine.ts) contains direct email/SMS
  and webhook actions. This pass identified those effect boundaries, not every
  trigger/condition/job writer. [InMemoryEventBus](../../src/lib/platform-events/event-bus.ts)
  remains per-process fire-and-forget. `EventStream*`, queue dispatch/retry,
  platform-event publishing/CDC bridges and integration imports are **NOT
  EXHAUSTIVELY INSPECTED**; neither their names nor stored logs establish Kafka
  delivery or compatibility with canonical `DomainEvent`.

## 8. Partial loyalty hook appendix — not whole-domain coverage

The Deal-won hook leads to [applyAutoEarn](../../src/lib/loyalty/auto-earn.ts).
This helper checks explicit organization/contact ownership, optionally checks a
non-null `referenceId`, then commits balance compare-and-swap and
LoyaltyTransaction creation in one transaction. The [partial unique index](../../prisma/migrations/20260620100000_loyalty_txn_referenceid_unique/migration.sql)
on organization/type/reference and P2002 winner lookup protect repeated keyed
awards. A null reference has no equivalent reference-key protection. Preserve
these existing controls; a successful duplicate rejection is not a projection
rebuild or a historical-rule calculation.

- Rules, settings and tier definitions are read from their current state.
  `input.now` controls expiry/tier timestamps, but the helper does not pass it as
  `asOf` to [evaluateEarn](../../src/lib/loyalty/earn-pipeline.ts), whose validity
  comparison defaults to the current clock. Directly replaying this helper does
  not reproduce historical rules or their effective date.
- After commit, [sendEarnNotification](../../src/lib/loyalty/loyalty-push.ts)
  sends a fire-and-forget [Expo push](../../src/lib/push/expo-push.ts). Its token
  set removes duplicate devices within one invocation, not duplicate effects
  across events. No durable event/effect receipt is passed to this sender;
  replay of a keyed award also does not repair a missed post-commit push.
- The inspected cron identity boundaries are [birthday](../../src/lib/loyalty/birthday-cron.ts)
  (`birthday:<contactId>:<year>`) and [expiry](../../src/lib/loyalty/expiry-cron.ts)
  (supplied clock, due earn rows and `expiredAt` marker). These are operational
  guards, not evidence of full deterministic recovery. Their entire callers,
  reversals, redemptions, manual adjustments and app/checkout writers remain
  **NOT INSPECTED**.

Any future loyalty shadow reducer needs immutable historical facts and a
separate projection target; it must not invoke the live auto-earn/push path.
This appendix neither activates loyalty consumers nor proves recovery of all
financial paths.

## 9. Prioritized follow-up, without activating any sender

1. Map remaining alternate writers before assigning ownership to a consumer:
   bulk/import/public lead/contact endpoints, voice/AI command adapters,
   support portal and cron writers, campaign variants, sequence workers and
   every provider callback. Record transaction, stable identity and authority.
2. For the rows above, separate source mutation, derived projection and external
   effect. Add canonical event/outbox in the source transaction only through a
   reviewed domain contract; existing after-commit callbacks are not durable.
3. Preserve established keys (comment UUID, CallLog operation identity,
   Chatwoot key/hash, inbound provider ID, attribution sourceKey). Rebuilds need
   their own consumer/build identity while external-effect identities remain
   stable and replay-fenced. Never erase a live claim merely to make replay run.
4. Exercise synthetic duplicate, concurrent duplicate, crash-before/after-commit,
   provider-accepted-but-response-lost, tenant mismatch and out-of-order cases.
   Assertions must cover both state parity and **zero additional external sends**.
5. Only after per-path completeness, authorization and transport evidence may a
   separately approved production canary be considered. This document grants no
   activation, offset reset, customer replay or provider-send authority.

Remaining module catalogue entries are **NOT INSPECTED**: payments/refunds,
invoices/bills, loyalty paths beyond the partial appendix, entitlements beyond the named callers,
approvals/e-sign, provisioning/security configuration, MTM/workforce/mobile,
industry modules, analytics/Data Cloud, builders and integration imports.
Warehouse/Accounting remain explicitly excluded. Use the
[module catalogue](./MODULE_EVENT_CATALOG.md) as an inventory queue, not a claim
that all 27 modules are complete. K0.2 remains open.

## 10. Bounded Payments extension — 2026-10-18

Source reviewed: main `ce71dacf9a413facda602fb433963e1cbe79412b`; the current
task's frozen `a222b769f` changes only recovery-report code, not these payment
writers. This supersedes **NOT INSPECTED** above only for the named Payments
chains below. No provider account/settings, live transactions or credentials
were inspected; no payment/refund, webhook, runtime test, rebuild or replay ran.
Invoice/bill writers, subscriptions/checkout/import/cron alternate callers,
Warehouse and Accounting remain outside this pass and their existing process.

| Named source boundary | Observed identity / transaction | Recovery constraint |
|---|---|---|
| [POST payment-intents](../../src/app/api/v1/payment-intents/route.ts) | `withRlsAuth("payments", "write")`; tenant/active provider lookup, then `provider.createIntent`, then local intent INSERT. Inspected caller/provider parameters carry no stable business-operation/idempotency key or canonical command/event/effect receipt. | Provider acceptance and local INSERT are not atomic. A missing local row is not permission to recreate an external intent. Creating an intent is not itself proof of a captured charge. |
| [POST payment-refunds](../../src/app/api/v1/payment-refunds/route.ts) | Tenant/active provider and refundable-state checks precede a Serializable transaction. Inside it: sum nonfailed refunds, over-refund guard, `provider.refund`, refund INSERT, optional intent state update. Caller gets retryable409 on serialization conflict. | Preserve the DB sum/transaction guard, but a DB rollback cannot undo a successful external refund. Do not retry this provider tail from replay or treat every conflict/timeout as safe to reissue. Inspected request/provider interface has no stable operation key. |
| [Webhook admission](../../src/app/api/v1/payment-webhooks/[provider]/route.ts) | Provider-row ID resolves tenant under bounded bypass; active/secret checks and provider signature parse precede tenant-scoped receipt INSERT. Prisma schema declares unique `(organizationId, providerId, externalId)`. P2002 returns200/duplicate without checking existing status or comparing payload hashes. | Preserve the existing uniqueness boundary, but received/processing/failed is not completed. Receipt INSERT, domain handler and final status update are separate. A crash after receipt admission can suppress redelivery without completed domain work. |
| Same webhook's state handlers | Actual code already uses Serializable transactions for intent transitions and refund+parent updates, with up to3 P2034 retries outside the handler. Refund success checks existing status. Unknown event type/missing referenced object may become ignored; failures are marked failed and receive200. | The header's old “without transaction”/slice-3 comment is stale. Preserve real atomic updates while adding durable admission/completion/reconciliation. SQL transaction retry here does not establish provider-call retry safety elsewhere. |
| [PATCH payment-intents/id](../../src/app/api/v1/payment-intents/[id]/route.ts) | Tenant write authorization; rejects client-supplied succeeded/partially_refunded/refunded. Reads prior status, validates pure state machine, then updates by ID; inspected chain has no expected-state compare-and-swap transaction/command receipt. | Preserve provider-controlled settlement restriction. Rebuild is not permission to invoke mutable live status routes; concurrent ordering needs its own proof. [Refund/id](../../src/app/api/v1/payment-refunds/[id]/route.ts) is GET-only. |

### Real provider versus stale stub comments

- [Stripe](../../src/lib/payments/providers/stripe.ts) actually imports the
  Stripe SDK and calls `paymentIntents.create` and `refunds.create`; inspected
  calls do not supply a stable business idempotency option. Current route/
  registry/type comments calling every provider a slice-1 stub are stale.
  Whether a live configured provider exists or any duplicate operation has
  happened is **NOT INSPECTED**. No claim of a real repeated charge is made.
- Reviewed [PayPal](../../src/lib/payments/providers/paypal.ts) and
  [YooKassa](../../src/lib/payments/providers/yookassa.ts) create/refund methods
  still return synthetic references; [Robokassa](../../src/lib/payments/providers/robokassa.ts)
  creation is synthetic and refund rejects for manual handling. PayPal/
  Robokassa webhook verification rejects as unimplemented; YooKassa has its
  own local verifier/payload shape. These source facts are not certification
  of provider protocol/SDK integration, configuration or real delivery.
- The inspected [provider interfaces](../../src/lib/payments/types.ts) have
  amount/currency or externalRef/reason, not a durable operation key. Stripe
  converts major-unit JS numbers with `Math.round(amount * 100)` and explicitly
  notes unsupported zero-decimal currencies; refund totals convert DB Decimal
  to number. A future exact-money replay must have a governed currency contract,
  not copy this live provider arithmetic as its source of truth.
- [Schema](../../prisma/schema.prisma) stores intent/refund amounts as
  Decimal(18,4); webhook uniqueness is not the generic immutable event store.
  Named routes do not explicitly append canonical events or effect-outbox
  receipts. This named-chain finding does not exhaust aliases, middleware,
  SQL triggers, migrations or every alternate writer in the application.

### Required before Payments can join a replay scope

1. Define immutable provider-confirmed facts/corrections and typed schemas,
   privacy/minimization and historical provenance. Do not copy credentials,
   client secrets or unrestricted raw provider payloads into Kafka/receipts.
2. Claim a stable tenant/provider/business-operation identity durably before
   sending; retain request hash, lease/fence, attempts and accepted/unknown
   outcome independently of projection version. An ambiguous provider result
   requires read-back/reconciliation, not a blind new refund/create request.
3. Couple admission/completion to durable processing state; distinguish
   duplicate-done, pending, failed and altered payload. Preserve existing
   tenant/signature/uniqueness and real Serializable domain updates; do not
   collapse them into “event ID seen means all work completed”.
4. Build a separate exact, currency-aware shadow projection from accepted
   facts; never call create/refund or re-enter live webhook/status routes.
5. Add synthetic crash-before/after-provider and DB-commit, ambiguous outcome,
   duplicate/altered event, concurrent refund, wrong-tenant, out-of-order and
   zero-replay-send tests. Existing `api-payment-intents`, `api-payment-refunds`,
   `api-payment-webhooks` and `api-payment-providers` test files were located
   but NOT RUN/re-certified in this read-only inventory. Provider/currency and
   full source-writer coverage remain open before any production adoption.
