# Assigned lead AI call flow

Status: Phase 1 and the Phase 2 selected-lead sequential queue are implemented as guarded foundations, but remain disabled for live calls. The per-lead analytics slice is implemented. The Phase 3 all-eligible snapshot and Phase 4 optimisation are not implemented yet.

## Current implementation boundary

Implemented in Phase 1:

- a dedicated **AI call** action on the lead overview, with a preflight and an explicit consent attestation;
- server-derived lead phone and exact sales ownership checks — the browser cannot choose a different number or lead;
- a VoIP-admin-only manual-call switch, off by default;
- VoIP-scoped calling hours that fail closed when missing or invalid;
- tenant suppression/consent checks, duplicate active lead and phone fences, and rolling 24-hour attempt caps;
- a durable `VoiceCallSession`, pre-generated provider correlation, and idempotent initiation with no automatic redial after an uncertain dispatch;
- normalized provider/conversation outcomes, zero-turn terminal callbacks, and retry-safe post-call analysis claims;
- owner-scoped AI call readers and lead-linked analytics; correlated AI transcripts/insights cannot be overwritten by generic call tools;
- deterministic provider/runtime-config selection and bounded provider connection/originate requests.
- a phone-level sales-call permission control on the lead card: a seller can record a durable block, while only a manager can remove the sales-scope block and attest permission; all actions are idempotent, append-only audited, and bound to the current lead phone revision;
- the same canonical-phone block is enforced for both manual AI calls and ordinary CRM sales click-to-call before an attempt is durably started.

Implemented in Phase 2:

- selected assigned leads are previewed and revalidated on the server, with stable exclusion reasons and a maximum of 100 submitted IDs;
- creation stores only eligible leads in an immutable prepared queue and never dispatches a call;
- an explicit start action and a durable cron worker advance at most one provider call per organisation;
- database fences cover active organisation, owner, lead and normalised phone, including manual-vs-queue races;
- the next item is not claimed until the prior session has a durable terminal result;
- pause-after-current, resume, skip-next and cancel-remaining are owner-scoped and audited;
- assignment, active seller, phone stability, DNC/consent, prior connected conversation, calling hours, provider readiness and rolling attempt limits are checked again immediately before dispatch;
- unknown provider delivery stops the queue in `attention_required`; a later proven terminal result leaves remaining work paused for explicit review.
- the manager-only uncertain-delivery screen and CAS/audit transition are implemented, but the production endpoint intentionally keeps every fence: ARI channel absence cannot prove that a timed-out originate will not create the channel later;
- a late proven PBX callback corrects the resolved item's displayed outcome without restoring queue keys or restarting work.

Still required before the switch may be enabled for customer calls:

- a confirmed path from an explicit spoken caller opt-out to the durable suppression record; the lead-card action exists, but the voice runtime does not yet create this record automatically;
- cost proof for every billable provider. The OpenAI organisation has a verified hard monthly API limit, but it is shared across projects and does not cap carrier/PBX charges;
- production PBX proof that every terminal outcome, including zero-turn/no-answer/busy/failure, reaches the correlated callback through durable retry/outbox handling. The durable outbox patch is locally tested but not deployed, and the live dialplan still has no correlated emitter for pre-answer outcomes;
- a provider-finality or cancellation-tombstone contract for timed-out originates before the manager resolver may release an uncertain session; read-only ARI 404 probes alone remain fail-closed;
- an operational path for a missing callback after a provider-accepted manual AI call; queue items age into `attention_required`, but an accepted standalone manual session can still require reconciliation;
- one separately authorised controlled call that proves correlation, media, terminal outcome, lead analytics, and the next-step record end to end.

Until those checks pass, deployment of this code is a disabled foundation only: no live AI call is authorised by this document.

## Product decision

Use one unified call queue for a salesperson instead of building a second campaign product inside CRM.

Lead source (SMM, advertisement, manual creation, form, import, or integration) is a filter and prioritisation signal. It must not create a separate calling flow. The hard boundary is ownership: a salesperson can prepare or start calls only when `assignedTo` is their own user ID. Sharing may grant read access to a lead and its analytics, but it does not grant calling authority. Automatic jobs remain pinned to the lead owner captured at queue time.

The three entry points share the same server-side eligibility engine:

1. **Call now** on a lead — one explicit AI call, linked to that `leadId`.
2. **Call selected** on the leads list — the salesperson reviews selected leads and creates a sequential queue.
3. **Process untouched leads** — a saved filter for “Assigned to me · no connected CRM call” opens a preview. “Start queue” creates durable queue items; it never launches a fan-out of browser requests.

## Seller experience

### Leads list

Default seller view:

- owner: **Me** (server-enforced for sales roles);
- optional source, pipeline, priority, language, and created-date filters;
- conversation filter: **No connected CRM call**;
- columns: last attempt, connected-conversation state, next eligible time, and skip reason;
- row selection plus **Call selected with AI**;
- **Prepare all eligible** applies the current server-side filter and opens a preview.

The preview shows:

- eligible count;
- grouped exclusions (no valid phone, opted out, outside calling hours, already queued/active, connected before, inaccessible/reassigned);
- estimated order, not a promise that every lead will be dialled;
- an explicit **Create call queue** action.

### Queue workspace

The queue is sequential at first: one active call per salesperson and a small tenant-wide concurrency cap.

Controls:

- start/resume;
- pause after the current call;
- skip the next lead with a reason;
- cancel remaining queue items;
- open the current lead;
- retry only failures that the policy marks retryable.

Rows expose operational states, not provider jargon:

`prepared → checking → calling → waiting for result → analysing → completed`

Terminal alternatives:

`skipped | no_answer | busy | failed | cancelled | blocked | attention_required`

After a call ends, the queue advances only after the attempt is durably recorded. Transcript analysis may finish asynchronously; its summary, sentiment, agreements, and next steps appear in the lead overview when ready.

### Lead overview

The lead keeps the manual **AI call** action even when it has prior conversations. Manual calls still obey suppression, permissions, duplicate-active-call, and allowed-hours rules.

The overview shows lead-linked analytics only. It never associates historical calls by phone-number coincidence.

## Eligibility contract

Every preview and every queue-item claim re-evaluates eligibility on the server. A stale preview cannot authorise a call.

A queued automatic call is eligible only when all conditions hold:

- tenant and lead are active;
- the lead is still assigned to the initiating salesperson;
- a plausible normalised phone is present;
- voice contact is not opted out, suppressed, or blocked;
- the current time is inside the tenant/lead calling window;
- no active or queued call exists for the same tenant and lead;
- attempt and configured rate/budget limits allow another call;
- the selected conversation policy still matches.

“No connected CRM call” does not mean “there is no `CallLog` row”. Failed and unanswered attempts are real rows. New call rows persist a canonical external phone plus normalised provider/conversation outcomes. Queue preview and claim use exact canonical phone matching, never suffix or fuzzy matching. A call counts as a connected conversation only after the provider/media path proves answer/customer speech, or a narrowly defined legacy same-lead human-call fallback proves a completed call with positive duration.

Legacy rows that cannot be normalised remain uncertain rather than guessed. The UI therefore keeps the honest label **No connected CRM call** and never claims “never spoken” from missing data.

## Persistence and idempotency

A browser loop is not a queue. The minimum durable design is:

- `VoiceCallBatch`: tenant, creator, owner scope, immutable filter/selection snapshot, counts, status, pause/cancel timestamps;
- `VoiceCallSession`: one lead-level queue item/business process, linked to the batch, captured owner, priority/order, eligibility snapshot, state, next eligible time, lease, final outcome, and existing CRM relations;
- `VoiceCallAttempt`: session, attempt number, idempotency key, provider correlation, linked `CallLog`, timestamps, outcome, retry class;
- `CallLog`: explicit `callMode` (`human` or `ai`), answer/outcome fields, and the existing `leadId`/insight fields.

Required invariants:

- unique active session per tenant + lead + call purpose;
- unique provider initiation idempotency key per attempt;
- atomic lease/claim so two workers cannot dial the same session;
- reassignment check immediately before initiation;
- provider callbacks update the correlated attempt exactly once;
- pause/cancel prevents new claims but never corrupts the active call;
- retries create a new attempt and follow a bounded policy; no automatic retry after a connected conversation.

## Permissions

- Sales: calls only leads where `assignedTo` is the current user; `owner=me` is forced server-side. Shared leads remain read-only for this workflow.
- Manager/admin: may preview another seller or team, but every batch is still owner-scoped and auditable.
- Queue creation requires lead-read plus VoIP-write permission.
- Queue viewing follows ownership for sales and team visibility for managers.
- Inaccessible records return `404` to avoid identifier enumeration.

The current generic bulk and sequence endpoints cannot be reused unchanged: their tenant checks are not a substitute for record visibility, and sequence call steps currently open `tel:` and write manual activity rather than an AI `CallLog`.

## Rollout

### Phase 1 — assisted and measurable

- lead overview analytics;
- explicit AI call from the lead with `leadId` preserved;
- server-side ownership, consent/suppression, duplicate-call, allowed-hours, and rate/cost preflight;
- idempotent initiation and normalised answer/conversation outcomes;
- small tenant and daily caps;
- audit skip reasons and outcomes;
- no automatic retries.

Implementation status: code-complete as a disabled foundation, including lead-card sales-call permission operations and exact connected-history checks. Live enablement is blocked by the items in **Current implementation boundary** above.

### Phase 2 — selected sequential queue

- `VoiceCallBatch` + `VoiceCallSession` queue for selected own leads;
- server-side filters for owner/source and **No connected CRM call**;
- multi-select preview;
- concurrency `1`, pause/resume/cancel, atomic leases, and duplicate-active-session protection;
- reassignment and eligibility recheck immediately before every call;
- manager queue dashboard and cost/rate controls;
- bounded retry policy for technical failure/no answer;
- automatic creation of a deduplicated follow-up task from agreed action items.

Implementation status: code-complete as a disabled foundation. Queue creation and execution require independent tenant and server switches, both off by default. Calls are strictly sequential: creating a queue does not call anyone, and starting it can dispatch at most one item before a durable terminal result. Live enablement remains blocked by the items in **Current implementation boundary** above, especially durable PBX terminal delivery, automatic spoken opt-out handling, complete cost proof and standalone accepted-call reconciliation.

### Phase 3 — all eligible snapshot

- “Prepare all eligible” from a saved filter;
- snapshot of the exact lead IDs and exclusion reasons shown in preview;
- scheduled start inside valid voice calling hours;
- filters by source, campaign, date, pipeline, priority, and status;
- tenant-wide concurrency, daily volume, duration, and cost limits.

Implementation status: design only.

### Phase 4 — optimisation

- source/priority scoring;
- per-language agent selection;
- adaptive call windows based on confirmed contact history;
- queue performance analytics by source and owner.

Implementation status: design only.

## Non-goals for the first release

- arbitrary cold-contact databases;
- parallel fan-out from the browser;
- unlimited “call all” without preview and caps;
- phone-number-only linkage;
- automatic retries after a connected conversation;
- automatic status changes, messages, or reassignment based only on an LLM summary.

## Acceptance evidence

Before enabling automatic queues, prove:

- a sales user cannot preview, queue, or read another seller's unshared lead;
- repeated submissions produce one session/attempt;
- reassignment between preview and claim skips safely;
- pause/cancel blocks new calls;
- opt-out and calling-window changes are honoured at claim time;
- a provider timeout/no-answer is not treated as a conversation;
- one connected call removes the lead from the default untouched filter;
- every completed attempt links to the correct `leadId` and surfaces its analytics in that lead overview.
