# LeadDrive module event catalog and migration matrix

Status: **GOVERNED CATALOG — all domains are registered; only the Finance Fund
pilot has concrete canonical events in this release**
Catalog date: 2026-09-01
Applies to: every module in `src/lib/modules.ts`, intentionally ungated
verticals, and cross-cutting platform capabilities

This catalog is the completeness boundary for the event platform. It prevents
Kafka adoption from protecting Finance while leaving another module able to
repeat a payment, message, approval, points award, or tenant provisioning
operation during replay.

## How to read the catalog

Migration profiles are defined in the
[target architecture](./KAFKA_EVENT_SOURCING_ARCHITECTURE.md):

- **A — event-sourced aggregate:** the immutable stream is authoritative;
  current state is a projection/snapshot.
- **B — transactional state plus domain events:** current PostgreSQL state
  remains authoritative; mutations append an event/outbox atomically.
- **C — immutable ingress:** retain and deduplicate the provider receipt, then
  emit a normalized canonical event.

Many domains need more than one profile. For example, an ordinary invoice can
start in Profile B while its payment lifecycle and fund ledger use Profile A,
and its provider webhook uses Profile C.

Migration waves are risk ordered:

| Wave | Scope | Exit condition |
|---|---|---|
| 0 | Governance, fences, schemas, ownership, current safety gaps | No high-risk path relies on an untracked DB/provider dual write |
| 1 | Shared outbox/inbox/event store/effect controls | Synthetic loss, duplicate, crash, tenant-isolation, and replay drills pass |
| 2 | Money, points, stock, entitlements, approvals, provisioning, external effects | High-consequence state is append-only or correction-based and rebuildable |
| 3 | Core operational CRM domains and normalized communications | Versioned shadow projections reach parity for canary tenants |
| 4 | Industry clouds, analytics, and high-volume facts | Retention, privacy, scale, and per-tenant rebuild tests pass |
| 5 | Legacy dispatcher retirement and DR evidence | Cross-region/archive rehydration and operator-run recovery drill pass |

## Complete product-domain matrix

Event names below are proposed contract families. Every concrete event receives
its own versioned schema and owner before implementation.

The machine-readable topic registry currently covers 27 domain slugs and
expands them to 86 physical-topic templates. CI compares that registry to
`src/lib/modules.ts`. This proves catalog totality, not runtime adoption. The
only concrete schemas and database-authoritative stream in this slice are
`finance.fund-opened.v1`, `finance.fund-transaction-recorded.v1`,
`finance.fund-metadata-updated.v1`, `finance.fund-archived.v1`, and the
rollback-compatibility `finance.fund-reactivated.v1` event.

| Domain / catalog coverage | Durable facts and proposed canonical events | Rebuildable projections and external effects | Profile / wave / required protection |
|---|---|---|---|
| **Platform tenancy, auth, settings** (`settings`, users, plans, API keys, RLS context) | `tenant-created`, `tenant-status-changed`, `module-entitlement-changed`, `user-invited`, `role-assignment-changed`, `api-key-revoked`, `configuration-changed` | Effective module/permission matrix, tenant routing, user access index; identity invitations and provisioning are effects | **A+B, W2.** Entitlement and permission order must be monotonic; tenant ID comes from trusted transaction context; cross-tenant replay needs two approvers |
| **Authentication and SMS OTP** (`sms-otp`) | `authentication-challenge-issued/verified/failed/expired`, `mfa-enrollment-changed`; never include an OTP, password, session token, or secret | Short-lived challenge/rate-limit state and security audit; SMS delivery is an external effect | **B + effect/C receipt, W2.** Very short data retention, one-use atomic consume, stable send key, anti-replay/rate limits, hashed/non-secret references only |
| **CRM** (`crm`: company, contact, task, project, activity) | `company-created/updated/merged`, `contact-created/updated/merged`, `task-assigned/completed`, `project-status-changed`, `activity-recorded` | Relationship timeline, task boards, activity feed, search; optional notification effects | **B, W3.** Stable merge/correlation IDs; corrections preserve old identity links; no PII in event keys/headers |
| **Sales** (`sales`: lead, deal, pipeline, quote, offer, territory, sequence, quota) | `lead-qualified`, `deal-created/stage-changed/won/lost`, `quote-issued/accepted`, `sequence-enrolled`, `territory-assigned`, `quota-changed` | Pipeline/forecast, velocity, quota attainment, sequence state; email/task creation through effect outbox | **B** plus **A** for accepted commercial commitments, **W3.** Aggregate version enforces stage order; sequence replay cannot resend steps |
| **Contracts** (`contracts`, approvals, versions, clauses, e-sign) | `contract-created/versioned/approved/rejected/executed`, `approval-delegated`, `esign-envelope-requested/signed/declined`, `milestone-reached` | Current contract/version, approval queue, renewal/risk views; e-sign provider calls and reminders are effects | **A+B+C, W2–3.** Approval/e-sign audit is append-only; signed artifacts by encrypted immutable reference; unknown provider outcome reconciled |
| **Marketing** (`marketing`, campaigns, journeys, segments, forms, surveys, landing pages, web tracking, attribution, orchestration) | `campaign-activated/paused`, `journey-enrolled/advanced`, `segment-membership-changed`, `form-submitted`, `survey-response-recorded`, `web-session-observed`, `touchpoint-recorded`, `orchestration-run-completed` | Audience membership, journey state, attribution, pacing and web analytics; email/mobile/ad activation are effects | **B+C, W3.** Stable client/provider event and send keys; consent and suppression checked by effect worker; replay never resends or reactivates audiences |
| **Loyalty** (`loyalty`) | `loyalty-account-opened`, `points-earned/redeemed/expired/adjusted`, `tier-changed`, `reward-claimed` | Wallet balance, tier, redemption availability, liability; reward fulfilment is an effect | **A, W2.** Double-entry/append-only points ledger, decimal/integer units, unique business award key, correction event instead of balance edit |
| **Omnichannel** (`omnichannel`, inbox, channel messages, web chat) | `message-received/accepted/delivered/failed`, `conversation-opened/assigned/closed`, `consent-changed`, `channel-connected/disconnected` | Unified conversation timeline, unread/queue state; sends, read receipts, callbacks are effects/ingress | **B+C, W2–3.** Provider receipt ID plus payload hash; stable outbound message key; original body has policy-controlled encrypted storage |
| **Social monitoring and legal** (`social`, `social-legal`) | `observation-ingested/versioned`, `mention-classified/matched`, `reply-approved/requested/sent`, `legal-case-opened/evidence-added/action-approved`, `source-deletion-recorded` | Mention/search clusters, subject relevance, cases, outbound state; crawling, publishing, takedown/legal sends are effects | **B+C** with **A** for approval/evidence chains, **W2–4.** Preserve `IngestEnvelope`, evidence hashes, approval events, provider capability proof; replay cannot publish |
| **VoIP / telephony** (`voip`) | `call-permission-granted/revoked`, `call-requested/started/connected/ended`, `recording-available`, `usage-recorded`, `suppression-changed` | Queue state, call timeline, usage, consent audit; dial/start/recording retrieval are effects | **B+C** with append-only consent, **W2–3.** Stable call/effect key, provider callback dedupe, consent fence, encrypted recording reference, no replay dialing |
| **Support** (`support`: tickets, SLA, entitlement milestones, knowledge base) | `ticket-created/assigned/escalated/resolved`, `sla-started/breached/paused`, `entitlement-consumed`, `article-published` | Queue, SLA clocks, entitlement milestone, customer portal; notification/escalation effects | **B** plus **A** for entitlement consumption, **W2–3.** Deterministic SLA clock inputs; replay never repeats customer messages or consumes entitlement twice |
| **Finance** (`finance`: invoices, payments, bills, funds, budgets, forecasts) | `invoice-issued/voided`, `payment-intent-created/authorized/captured/failed/refunded`, `fund-transaction-recorded/reversed`, `bill-approved/paid`, `budget-approved/adjusted` | Fund/bank balance, receivables, cash flow, budget actuals, profitability; charge/refund/accounting export are effects | **A+B+C, W2 first. Fund pilot implemented:** open/transaction/metadata/archive/reactivation facts, exact decimal values, command receipts, canonical outbox, and active balance projection. Reversal, other Finance aggregates, Kafka consumers, and external effects remain open. |
| **Analytics, reports, CDP/Data Cloud** (`analytics`, `data-cloud`) | Consume every approved domain event; emit `profile-merged`, `insight-calculated`, `segment-materialized`, `forecast-snapshot-created`, `report-snapshot-created` only when they are durable business facts | Unified profile, dashboards, forecasts, saved reports, search/indexes, attribution | **B projection consumers, W4.** No analytics event may mutate source truth; builds are versioned, deterministic, tenant-scoped, and disposable; late-event policy recorded |
| **MTM route, field force, workforce** (`mtm`) | `route-assigned/changed`, `visit-started/completed`, `workday-event-recorded`, `attendance-verified/corrected`, `timesheet-approved`, `mobile-command-accepted`, `sync-change-recorded` | Route/coverage/KPI, latest location, workforce schedule/timesheet, mobile sync feeds; route notifications are effects | **A+B+C, W2–4.** Preserve mobile command receipts, sync operations, write fences, sequence streams and route-notification outbox; location has short retention and restricted access |
| **MTM pharmacy promotion and points** (`mtm`) | `promotion-version-published`, `promotion-executed/reviewed`, `points-earned/adjusted`, `reward-claimed/fulfilled`, `evidence-recorded` | Promotion execution, approval, points balance, reward liability; reward fulfilment/notifications are effects | **A, W2.** Existing ledger/event/operation IDs become canonical dedupe keys; immutable formula/policy version in each earning event |
| **Health Cloud** (`health`) | `patient-registered/linked`, `encounter-recorded/corrected`, `care-plan-created/changed`, `medical-record-referenced`, `consent-changed` | Care timeline and authorized operational views; provider notifications/integrations are effects | **B+C, W4.** Restricted classification, field encryption/reference-only clinical documents, consent/erasure/legal-hold rules, no PHI in Kafka metadata |
| **Insurance Cloud** (`insurance`) | `policy-quoted/bound/changed/cancelled`, `beneficiary-changed`, `claim-filed/assessed/approved/rejected/paid`, `rating-version-published` | Policy/claim status, exposure and service-team views; payment/provider notifications are effects | **A+B+C, W4** after shared payment controls. Immutable policy/rating version and claim decision chain; monetary settlement uses Finance ledger |
| **Public Sector Cloud** (`public-sector`) | `citizen-case-opened/updated/closed`, `license-applied/issued/revoked`, `grant-applied/awarded/disbursed`, `official-assigned` | Case, license, grant workflow and statutory audit; notices/disbursement are effects | **A+B, W4.** Statutory retention/legal hold, explicit authority/approval events, restricted tenant/operator access, disbursement via Finance |
| **Media Cloud** (`media`) | `subscriber-status-changed`, `content-inventory-changed`, `ad-placement-booked/delivered`, `consumption-recorded` | Subscriber entitlement, content/ad inventory, delivery and consumption analytics; ad/provider actions are effects | **B+C, W4.** High-volume consumption has separate retention/partition plan; subscription entitlements are Profile A; dedupe provider delivery IDs |
| **Energy & Utilities** (`energy`) | `customer-service-started/stopped`, `meter-reading-received/corrected`, `outage-declared/restored`, `service-call-created/completed` | Latest meter/billing inputs, outage map/status, field service queue; dispatch/customer alerts are effects | **B+C** with append-only readings, **W4.** Device/provider dedupe, event-time/late-data policy, correction events, restricted location data |
| **Commerce** (`commerce`) | `cart-checked-out`, `order-placed/confirmed/cancelled`, `shipment-dispatched/delivered`, `return-requested/received/refunded`, `promo-redeemed` | Order/fulfilment/return state, inventory reservation; fulfilment, refund and customer messages are effects | **A+B+C, W2–4.** Order/payment/stock sagas have stable command keys and compensations; replay cannot duplicate fulfilment/refund |
| **Inventory and warehouse** (commerce/MTM shared) | `stock-received/reserved/released/moved/adjusted`, `low-stock-threshold-crossed` | On-hand/available/reserved quantity, movement history, low-stock state; replenishment alert is an effect | **A, W2.** Append-only signed quantity movements, invariant `available = on_hand - reserved`, no direct quantity overwrite |
| **Education Cloud** (`education`) | `student-registered`, `course-published`, `enrollment-requested/accepted/withdrawn/completed`, `term-opened/closed` | Roster, course capacity, learner timeline; enrollment notifications are effects | **B** with **A** for capacity/credential commitments, **W4.** Stable enrollment key, privacy/retention policy, deterministic capacity projection |
| **Financial Services Cloud** (`financial-services`) | `household-member-linked/unlinked`, `financial-account-linked/updated`, `goal-created/reforecast`, `life-event-recorded` | Household/account/goal views; institution synchronization is ingress/effect | **B+C, W4.** This is not the accounting ledger; restricted classification, consent, provider cursor/idempotency, no credentials in events |
| **Nonprofit** (`nonprofit`) | `donor-created/merged`, `donation-pledged/received/refunded`, `grant-awarded/disbursed`, `volunteer-activity-recorded`, `program-status-changed` | Donor/program/grant impact and fund restrictions; receipts/disbursements/messages are effects | **B** plus **A** for money/restrictions, **W2–4.** Donation/payment events link to Finance ledger; stable receipt key; corrections preserve tax/audit history |
| **Revenue recognition** (`revenue-recognition`) | `obligation-identified/modified/satisfied`, `recognition-schedule-approved/changed`, `revenue-recognized/reversed`, `period-closed` | Recognition schedule, recognized/deferred balances and audit roll-forward | **A, W2.** Immutable contract/policy/currency version, approval sequence, reversal rather than edit; closed-period changes require explicit adjustment |
| **Trade promotion management** (`tpm`) | `promotion-proposed/approved/activated/closed`, `tactic-committed`, `trade-spend-committed/accrued/settled`, `retail-audit-recorded` | Promotion budget, accrual/settlement, execution audit; retailer/provider sends and settlement are effects | **A+B+C, W2–4.** Spend ledger and approvals are append-only; settlement uses Finance; evidence by hash/reference; no duplicate activation |
| **AI, automation, workflows, scheduled actions** (`ai`, `settings`) | `workflow-triggered/step-completed/failed`, `ai-action-proposed/approved/executed/rejected`, `prediction-produced`, `scheduled-action-due/completed` | Workflow/process state, AI audit/shadow results, schedules; model calls and approved actions are effects | **B+C, W2–3.** Prompt/model/config hashes, deterministic rule inputs, human approval event, stable action key; replay uses recorded output or shadow mode and makes no billable call |
| **Platform metadata and builders** (`settings`: custom fields, Lightning pages, OmniStudio, forms, templates, report definitions) | `metadata-version-published/retired`, `page-definition-published`, `script-definition-published`, `template-version-published`, `report-definition-changed` | Effective metadata/page/script/template versions and compiled caches; runtime script actions route through workflow/effect controls | **B, W3.** Immutable published version/hash, draft-versus-active pointer, schema compatibility, tenant-scoped cache invalidation; replay references the version active at occurrence time |
| **Notifications and outbound integrations** (cross-cutting) | `notification-requested`, `effect-authorized`, `effect-attempted/succeeded/definitely-failed/reconciliation-required`, `delivery-receipt-received` | User notification feed and delivery status; email, SMS, push, webhook, social, voice, payment and app calls | **A effect state + C receipts, W2.** One stable `(tenant, effect type, effect key)`; lease fencing; provider read-back; `UNKNOWN` is never an automatic retry |
| **Apps, accounting/provider integrations, provisioning** (cross-cutting) | `app-installation-requested/installed/revoked`, `provider-entitlement-changed`, `provisioning-step-completed/failed`, `import-received/applied`, `credential-rotated` | Installation/provisioning/import status; provider mutations and imports are effects/ingress | **A+B+C, W2.** Provisioning step idempotency, encrypted credential references only, source cursor/checksum, compensation plan before activation |
| **Security, compliance, audit, privacy** (cross-cutting) | `security-policy-changed`, `privileged-access-used`, `subject-erasure-requested/completed`, `legal-hold-applied/released`, `audit-export-created` | Security evidence, erasure/hold status, compliance reports; security notifications/exports are effects | **A append-only, W1–2.** Separate write-once copy and access domain, tamper evidence, payload minimization, controlled redaction/cryptographic erasure |

## Existing implementation signals to preserve

These are migration inputs, not proof that the target architecture is already
complete:

- `PlatformEventLog` persists a platform event before an in-process fan-out.
  Keep its compatibility contract while replacing correctness-critical fan-out
  with the canonical outbox/Kafka path.
- `EventStream`, `EventStreamEvent`, subscriptions, delivery attempts, and dead
  letters provide useful control-plane concepts. They must not become a second
  competing offset/dispatcher truth.
- `PaymentWebhookEvent`, `IngestEnvelope`, `MtmSyncOperation`, mobile command
  receipts, social outbound events, call events, subscription events, and
  domain-specific outboxes already carry provider or idempotency evidence.
  Preserve those identifiers when adapting them to canonical events.
- `MtmPharmacyPointsLedgerEntry`, `LoyaltyTransaction`, `StockMovement`,
  `SubscriptionEvent`, `EsignAuditEvent`, `EntitlementAuditEvent`, and similar
  histories are candidates for Profile A migration; they are not automatically
  complete event stores until sequence, immutability, schema, correction, and
  replay contracts pass the gates.
- BullMQ remains available for bounded jobs. A BullMQ job ID is not a substitute
  for a domain event ID or an external effect idempotency key.

## Catalog registration contract

No new module, aggregate, provider integration, scheduled worker, or external
effect is complete until its owner adds a catalog entry containing:

1. source-of-truth profile and aggregate boundaries;
2. command and past-tense event names with schemas;
3. tenant derivation, partition key, and aggregate-version rule;
4. data classification, PII inventory, retention, legal hold, and erasure
   treatment;
5. projection names, versions, invariants, and maximum rebuild time;
6. external effects, stable business keys, provider reconciliation method,
   and `UNKNOWN` handling;
7. correction/compensation semantics and forbidden in-place edits;
8. migration wave, owner, SLO, archive class, and runbook link.

The current CI totality check compares the module registry with the
machine-readable domain/topic and concrete-schema registries. Provider/effect
and worker registries remain a required extension. Unknown module domains and
unregistered implemented Fund event types already fail CI rather than silently
bypassing event governance.

## Domain acceptance template

Before one row is marked implemented, attach evidence for:

- [ ] atomic command + event + outbox transaction;
- [ ] unique aggregate sequence and event ID;
- [ ] duplicate command/event/effect tests;
- [ ] crash tests before and after database commit and offset commit;
- [ ] tenant mismatch and cross-tenant replay rejection;
- [ ] schema compatibility and restricted-data lint;
- [ ] deterministic full-history shadow rebuild;
- [ ] per-tenant count, value, checksum, and domain-invariant parity;
- [ ] zero non-replay-safe effects during replay;
- [ ] provider success, definite failure, timeout/`UNKNOWN`, and reconciliation
      tests;
- [ ] correction/compensation drill;
- [ ] archive and disaster-recovery watermark evidence;
- [ ] independent operator execution of the recovery runbook.
