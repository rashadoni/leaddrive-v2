# Implementation Plan — closing the respond.io gaps

Companion to [`ANALYSIS.md`](./ANALYSIS.md). Turns the 7 respond.io advantages we lack into
a grounded, sliced build plan. Every "reuse" point below is verified in our code (Explore audit,
2026-06-22) with `file:line` evidence. Effort = rough developer-Claude days, **estimates not
commitments**. Captions in the promo are marketing — treat "they have X" as *claimed*, not bench-tested.

## The 7 gaps → 5 epics

The gaps aren't 7 separate features. Four of them (#1 flow builder, #2 routing, #5 AI auto-update,
plus chat-side of automation) are one **Conversation Automation Engine**. Grouping by what shares a
spine:

| Epic | Closes gaps | Effort | Priority | Why |
|---|---|---|---|---|
| **E1 — Conversation Automation Engine** | #1 visual flow builder, #2 auto-routing, #5 AI auto-update/categorize | L (~3–4 wk) | **P0** | Highest leverage; the headline differentiator in the promo |
| **E2 — Messaging Broadcasts** | #3 WhatsApp/Telegram bulk re-engage | M (~1–1.5 wk) | **P1** | Direct revenue lever (re-engagement); medium effort |
| **E3 — Agent Productivity** | #6 AI Assist composer + snippets/`/`+`$` | S (~1 wk) | **P1** | Cheapest win; reuses existing Claude infra |
| **E4 — Voice as inline channel** | #4 Chats\|Calls tabs, inline call events, click-to-call | L (~2–3 wk) | **P2** | Heaviest; provider + threading + UI; do after E1–E3 |
| **E5 — Ecosystem** | #7 integrations marketplace, mobile inbox app, inline catalog send | XL (split) | **P3** | Heterogeneous; each is its own track; defer/spike only |

### Cross-cutting architecture decisions (from grounding)
1. **Event-driven, not cron.** Journeys run on a cron enrollment loop (`journey-engine.ts`,
   `nextActionAt`); conversations must react in seconds. The engine listens on conversation events.
2. **Separate engine from Journeys, shared action layer.** Journeys are lead/contact/invoice-centric
   (`JourneyEnrollment.currentStepId`); conversations are message/session-centric
   (`SocialConversation` + `AiChatSession`). Don't shoehorn. But **reuse the action executor** —
   `send_email/sms/telegram/whatsapp/update_field/create_task` already exist in `journey-engine.ts`
   and `workflow-engine.ts` (`auto_assign`, `send_notification`, `webhook`, `slack_notify`).
3. **Reuse `@xyflow/react` canvas.** `journey-flow-editor.tsx:19` already imports it with bidirectional
   `stepsToFlow`/`flowToSteps` converters (`:178`/`:275`). Generalize the converters; add chat node types.
4. **Reuse the AI brain as-is.** `generateChannelAiReply()` (`src/lib/social/ai-autoreply.ts:61`) +
   `AiAgentConfig` (schema `:2356`, has `systemPrompt/escalationEnabled/handoffTargets/intents/agentType`).
5. **Reuse `matchChatbotRule()`** (`src/lib/chatbot-engine.ts:94`) for fast keyword triggers; add an
   `ai_classify` trigger type rather than replacing it.

---

## E1 — Conversation Automation Engine  (P0, ~3–4 weeks)

Goal: a visual builder where `Trigger: Conversation Opened → AI Agent: Answer Questions →
{Success / Failure: Others / Failure: Idle}` branches into Close(categorize) / Assign-to-team /
Failure-message — exactly the promo's `ai-agent-flow-builder` frame.

### Slice 1.1 — Event bus + action executor (headless, no UI)  ~5–6 d
- **Build new:** a conversation event emitter. Emit `conversation.opened`, `message.inbound`,
  `conversation.idle`, `ai.escalated` from the inbox ingest path.
- **Reuse:** the action vocabulary from `workflow-engine.ts:206` (`send_notification/create_task/
  update_field/auto_assign/send_email/send_sms/webhook/slack_notify`) — wrap into a
  `executeConversationAction(action, ctx)` with conversation-specific additions: `send_reply`,
  `categorize` (tags / `metadata.category`), `close` (`status=resolved`), `handoff_agent`
  (`AiAgentConfig.handoffTargets`), `create_ticket` (Ticket w/ `conversationId` backref).
- **Reuse:** `SocialConversation.status/assignedTo` (schema `:3650`) and `ConversationParticipant`
  (`:3691`) — already there, no migration for the targets.
- **Data model (new):** `ConversationFlow { id, orgId, name, status, trigger, graph Json, version }`
  and `ConversationFlowRun { id, flowId, conversationId, currentNodeId, state Json, startedAt }`.
- **Risk:** double-fire with the existing `aiReplyClaimedAt` atomic claim (schema `:3650`) — the new
  engine MUST respect that claim so we don't regress the double-reply fix (`483e4ca8`).
- **Test:** unit-test each action; integration-test `opened → ai_reply → close`.

### Slice 1.2 — Auto-routing (queues)  ~4–5 d
- **Reuse:** `User.skills[] / maxTickets / isAvailable` (schema `:431–433`) — half the model exists.
- **Build new:** `TeamQueue { id, orgId, name, skillTags[], strategy }` (strategy =
  `round_robin | least_loaded | skill_match`) + a live load counter (count of open convos per user).
- **Build new:** `routeConversation(queueId, ctx)` → picks an available, skilled, least-loaded user;
  sets `assignedTo`. Exposed as the `assign_to_queue` action node.
- **Reuse:** assignment write path already validated in
  `src/app/api/v1/inbox/conversations/[id]/route.ts:55–77`.
- **Risk:** presence is a flat `isAvailable` boolean (no away/busy, no `lastSeen`) → round-robin can
  hand a chat to someone idle. Mitigate with a "no ack in N min → re-route" fallback node.

### Slice 1.3 — Visual builder UI  ~5–7 d
- **Reuse:** clone the `@xyflow/react` canvas from `journey-flow-editor.tsx`; **generalize** the
  `stepsToFlow`/`flowToSteps` converters (`:178`/`:275`) into a flow-type-agnostic pair (they're
  currently coupled to journey step shape — `stepOrder/yesNextStepId/splitPaths`).
- **Build new node palette:** `Trigger(Conversation Opened/Inbound/Idle)`, `AI Agent`, `Branch`
  (success/failure:others/failure:idle — reuse the multi-output handle pattern at
  `journey-flow-editor.tsx:100–147`), `Send Reply`, `Assign / Route to Queue`, `Categorize`,
  `Update Contact Field`, `Close`, `Handoff Agent`.
- **UI home:** extend `/inbox/ai-agent` (today persona-only) with a "Flows" tab + `Save`/`Test`.
- **Risk:** the converters are the real work — budget a day just for making them generic + tested.

### Slice 1.4 — AI Agent node + write-back  ~3–4 d
- **Reuse:** `generateChannelAiReply()` as the node's executor; branch on its existing
  `{ reply, escalate }` return (`ai-autoreply.ts:148–353`).
- **Build new:** "update contact details in real time" — an `update_field` action that lets the AI
  set `Contact.category/source/tags` (the promo's auto-categorize). Guard with an allow-list of
  writable fields; PII-mask before the LLM, never let it write arbitrary columns.
- **Reuse:** budget guard + echo-loop protection already in `ai-autoreply.ts` (don't bypass).

**E1 done = the headline gap closed.** Demo target: rebuild the promo's exact flow on our canvas.

---

## E2 — Messaging Broadcasts  (P1, ~1–1.5 weeks)

Goal: the promo's `Send Broadcast` — bulk personalized re-engagement on WhatsApp/Telegram, not just
Email/SMS.

Status as of 2026-07-04: the backend campaign send route already has
`CampaignChannelAdapter` paths for `email`, `sms`, `whatsapp`, and `telegram`,
including WhatsApp text/template fallback handling and Telegram text delivery.
Do not present this as a full respond.io-style Broadcast Center yet: the
remaining parity gap is product UX and operational reporting, especially
recipient eligibility preview, approved WhatsApp template selection, skipped
reason visibility, per-channel delivery stats, and a calendar/table broadcast
surface.

### Slice 2.1 — Channel-adapter refactor of campaign send  ~3 d
- **Problem (grounded):** `campaigns/[id]/send/route.ts:24` hard-codes `if (type === "sms") … else
  email` — every new channel today = ~150 duplicated lines (recipient resolve + loop + attribution).
- **Build:** a `CampaignChannelAdapter` interface `{ eligible(contact), send(contact, rendered) }`;
  move email/SMS into adapters; recipient/segment resolution (`all|manual|segment|source|contacts|
  leads`) extracted once.
- **Extract:** Telegram text send is currently inlined at `inbox/route.ts:555` — lift into a **new**
  `src/lib/telegram.ts` (`sendTelegramText()`; only `telegram-media.ts` exists today) so both inbox
  and broadcast share it.

Implementation note: this backend adapter work is now present in
`src/app/api/v1/campaigns/[id]/send/route.ts`; keep the slice here as historical
context, not as an open backend prerequisite.

### Slice 2.2 — WhatsApp + Telegram adapters  ~3–4 d
- **Reuse:** `sendWhatsAppText/Template/Media` (`src/lib/whatsapp.ts:120–286`),
  `sendTelegramText` (from 2.1).
- **Hard constraint (grounded):** WhatsApp 24h window — `insideSessionWindow()` returns
  `outside_window_no_template` (`whatsapp.ts:88–145`). Outside 24h you MUST use an **approved
  template**. So the broadcast composer needs a **template picker** bound to `whatsappTemplate`
  (status `APPROVED`) with `{{1..N}}` variable mapping; free-text broadcast only to in-window contacts.
- **Build:** per-recipient eligibility split (in-window → free text; out-window → template or skip),
  throttle/rate-limit, opt-in respect.

### Slice 2.3 — UX + reporting  ~2 d
- Channel toggle in campaign builder; pre-send eligibility preview ("412 reachable now, 1,090 need a
  template"); delivery stats per channel. Reuse existing campaign status enum + attribution updates.
- **Risk:** Meta policy. Template approval is async + external; surface it, don't hide failures.
- **Current open parity gap:** this is the main remaining E2 work before LeadDrive
  should market the feature as a full broadcast center rather than campaign
  send mechanics.

---

## E3 — Agent Productivity: AI Assist + snippets  (P1, ~1 week)  ← cheapest win

### Slice 3.1 — Canned snippets `/` + variables `$`  ~3 d
- **Grounded gap:** no *dedicated* canned-reply model — BUT the composer already has a partial base:
  Phase-4 rich composer reuses each `TicketMacro`'s `add_comment` text as quick-replies
  (`inbox/page.tsx:99,205-207,379-383`), loaded from `/api/v1/ticket-macros`. `TicketMacro` (schema
  `:1975`) is action-based though, so there's no shortcut/variable/channel-scoping.
- **Build (on top of that base, not beside it):** `MessageSnippet { id, orgId, shortcut, title, body,
  channelTypes[], variables[] }`; a `/` trigger in the composer to insert (extend the existing
  quick-reply insert at `:383`); `$`/`{{contact.name}}` substitution at send-time. Effort trends to the
  low end since the insert UI already exists.

### Slice 3.2 — AI Assist button  ~2 d
- **Reuse (easy):** `getAnthropicClient()` (`src/lib/ai/anthropic-client.ts:33`) + the
  `draftSocialReply()` prompt→JSON pattern (`src/lib/ai/social-reply.ts:48`). No new dep.
- **Build:** composer "AI Assist" with actions *Rewrite / Shorten / Make polite / Translate / Suggest
  reply* over the draft + last inbound message. Reuse the existing AI cost/budget tracking.
- **Risk:** low. Main care = per-org budget guard so Assist can't blow the daily AI cap.

---

## E4 — Voice as a first-class inline channel  (P2, ~2–3 weeks)

Goal: promo's `Chats | Calls` tabs, call events threaded in the conversation, click-to-call.

### Slice 4.1 — Click-to-call  ~3–4 d
- **Reuse:** `VoipProvider.initiateCall()` + Twilio adapter are production-ready
  (`src/lib/voip/factory.ts`, `providers/twilio.ts`). **Gap:** nothing calls `initiateCall()` today.
- **Build:** a call button in the inbox/contact composer → route → `initiateCall()`, write a `CallLog`
  tagged with the originating `conversationId`.
- **Risk:** Twilio is the prod-proven adapter. Asterisk + 3CX are **real but untested-in-prod**
  server-side adapters (working `initiateCall()` w/ live `fetch` — `asterisk.ts:30` ARI, `threecx.ts:27`
  makecall) → validate, don't assume they're stubs. custom-SIP is a **deliberate client-side stub**
  (`custom-sip.ts:1` "Stub Adapter"): server `initiateCall()` is a no-op returning a config for
  browser SIP.js — for that path the dialing logic lives client-side, so it's a different (bigger) lift.

### Slice 4.2 — Thread call events inline  ~4–5 d
- **Grounded gap:** `CallLog` (schema `:11348`) exists but is isolated — not shown in the inbox.
- **Decision point:** bridge `CallLog ↔ SocialConversation` (lighter) **vs** a unified
  `ChannelEvent` table (cleaner long-term, touches analytics/audit). Recommend the bridge first;
  spike the unified table separately. **This choice gates downstream work — make it explicitly.**
- **Build:** render call events (incoming/outgoing/duration/recording) inline in the thread; add the
  `Calls` filter tab.

### Slice 4.3 — Call state UI + recording/transcript link  ~3 d
- Live ringing/in-progress/ended; link to existing transcription + `conversation-insights` (we already
  have A8 Conversation Intelligence). Reuse, don't rebuild, the insights surface.

---

## E5 — Ecosystem  (P3, spike-only for now)

Three unrelated tracks; each is a project, not a slice. **Deferred — listed so they're not forgotten.**
- **Integrations marketplace** (Zapier/HubSpot/monday/WooCommerce/Pipedrive): we're CRM-native so this
  is low-priority; the cheapest slice is an **outbound webhook + Zapier trigger** (we already have a
  `webhook` action). Inbound connectors = large.
- **Native mobile inbox app:** the promo shows a phone, but that may be responsive web. Confirm demand
  before building; the MTM app is a *different* product, not reusable as an inbox client.
- **Inline product/catalog send:** send a priced product card into chat. Small, but needs a product
  catalog surface in the composer + WhatsApp interactive-message support.

---

## Sequencing & dependencies

```
P0  E1.1 event+actions ─► E1.2 routing ─► E1.3 builder UI ─► E1.4 AI node     (headline demo)
P1  E3.1 snippets ─► E3.2 AI Assist        (parallel, independent, ship first for a quick win)
P1  E2.1 adapter refactor ─► E2.2 WA/TG ─► E2.3 UX        (after E1.1 if sharing the action layer)
P2  E4.1 click-to-call ─► E4.2 inline threading ─► E4.3 state UI
P3  E5  spikes only
```

Recommended order to ship value fastest: **E3 (quick win) → E1 (headline) → E2 (revenue) → E4 → E5.**
E3 is independent and cheapest, so it lands while E1's converters/queues are being built.

## Out of scope / explicit non-goals (this plan)
- Replacing Journeys (marketing automation stays as-is; the new engine is chat-only).
- New VoIP providers beyond Twilio (3CX/Asterisk/custom-SIP adapters exist but stay unvalidated until a client needs them).
- WhatsApp out-of-window free-text broadcast (Meta-impossible; template path only).
- Multi-output branching in `WorkflowRule` (it stays the simple reactive system; flows live in E1).

## Top risks to call out before starting
1. **E1 converter generalization** — the `stepsToFlow/flowToSteps` coupling is the sneaky-hard part.
2. **E1 double-reply regression** — must honor `aiReplyClaimedAt`; we fixed this once (`483e4ca8`).
3. **E2 Meta template policy** — external, async approval; can block a broadcast at send-time.
4. **E4 call-event data model** — bridge vs unified table is a one-way door; decide deliberately.
5. **Presence fidelity** — flat `isAvailable` limits routing quality until we add real presence.
