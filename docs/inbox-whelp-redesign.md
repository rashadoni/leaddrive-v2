# Inbox Redesign — Whelp-grade Omni-Channel Workspace

> Status: **Inbox redesign Phases 1–8 + Phase 7 chatbot auto-reply — ALL built.** Phases
> 1–6 (shell / status / tags / notes / composer / folders / realtime-SSE), Phase 8 analytics
> (messages + conversations + FRT), and Phase 7 auto-reply slice-1/2a/2b/2c (rules CRUD +
> all-5-social-channel send + webhook wiring) are **on `origin/main` & deployed to LeadDrive,
> DORMANT** (auto-reply enable OFF by default). The existing `/inbox` stays untouched until
> the new one reaches parity; the Phase-2 blocker was resolved via **Option-D**. **Unpushed
> (deploy gated on target): `8a18a647`** — the auto-reply enable-check fix; without it the
> deployed feature is UN-enable-able — **+ `38ba0192`** — Phase 7 slice-1b chatbot admin UI
> (`/inbox/chatbot-rules`). See "Phase 2 — architectural blocker" + PROGRESS below.
> **Next: the safe net-new runway is SPENT — Phase 7 auto-reply is feature-complete; the
> remaining work is deploy (gated on target) → enable + live-smoke (needs the user) → gated
> shared-path items** (Phase 6 slice-2 LISTEN/NOTIFY · per-channel attachment SEND · AHT
> migration) or a separate product (Phase 9 bulk · Phase 10 mobile). See end of PROGRESS.

## Why

A prospect compared us to **Whelp** (`whelp.co`, AZ omni-channel help-desk) and
preferred its UX. Their hero screen ("Vahid Pəncərə" / single window) is a
**5-zone workspace**. Our current `/inbox`
(`src/app/(dashboard)/inbox/page.tsx`) is a flat 2-zone mail-client: list +
thread, no folders, no assignment UI, no status/snooze, no conversation tags,
no internal notes, no customer context panel, a thin composer, and a
destructive per-row Delete. Feature-wise we are **ahead** of Whelp (9 channels
vs 5, full CRM, Journey engine, AI automation, web-chat widget) — the gap is
the **inbox UX of this one screen**.

Full comparative audit (evidence-grade, file:line) lives in the session notes;
the capability deltas this redesign closes are tracked in the Phases table.

## Reference layout (Whelp screen, p.8)

Whelp shows 5 columns. Their left **icon-rail** is their product nav — we
already have the global CRM sidebar for that, so **inside our page** we render
**4 zones**:

```
┌────────────┬──────────────────┬────────────────────┬──────────────┐
│  FOLDERS   │  CONVERSATION    │   MESSAGE THREAD    │  CONTEXT     │
│  (rail)    │  LIST            │                     │  PANEL       │
│            │                  │                     │              │
│ • Me    8  │ [Open|Closed|Snz]│  ┌ header: name,    │ Details      │
│ • Unassig. │ search…          │  │ assignee, close, │  email       │
│ • All  324 │ ┌─ Jane Brown 2m │  │ snooze, ⋮        │  last seen   │
│ • Others   │ │  preview…      │  │                  │  first seen  │
│ • Chatbot  │ │  [New customer]│  bubbles (ch+time)  │  #convs      │
│ • Spam     │ ├─ Bella …       │                     │ Channels     │
│ ── Folders │ │  [VIP]         │  ┌ composer ──────┐ │ Notes        │
│ • Design   │ └─ …             │  │[Reply|Note]     │ │ Tags         │
│ • Finance  │                  │  │ ch▾ 📎 😊 ⚡ Send│ │ Attachments  │
└────────────┴──────────────────┴────────────────────┴──────────────┘
```

## Zone → data mapping (what already exists vs new)

| Zone | Element | Backing data | State |
|---|---|---|---|
| Folders | Me / Unassigned / All / Other agents | `SocialConversation.assignedTo` — but populated on only ~4 of 9 channels, and the list ignores it | **⚠ see Phase 2 blocker** |
| Folders | per-channel counts | `/api/v1/inbox` groups by channel already | exists |
| Folders | Custom folders (Design/Finance…) | new `InboxFolder` model | **Phase 5** |
| List | Open/Closed/Snoozed tabs | `SocialConversation.status` (open/resolved/archived) | partial — map + add `snoozed` |
| List | Snooze | new `snoozedUntil` column | **Phase 2** |
| List | conversation tags (VIP…) | new `ConversationTag` (Contact.tags exists but is contact-level) | **Phase 3** |
| Thread | bubbles, channel, time, status | `/api/v1/inbox` messages | exists |
| Thread | assignment dropdown | `PATCH /conversations/[id]` accepts `assignedTo` (writes a row the list doesn't read yet) | **⚠ see Phase 2 blocker** |
| Thread | composer: attachments/emoji | web-chat already supports attachments | **Phase 4** |
| Thread | quick replies inline | `TicketMacro` (settings/macros) exists | **Phase 4**, wire in |
| Context | email/phone/last-first seen/#convs | contact + conversation aggregates | partial — compute |
| Context | Notes (per-conversation) | new `ConversationNote` | **Phase 3** |
| Context | Tags | new `ConversationTag` | **Phase 3** |

## Phases

| Phase | Scope | Touches prod `/inbox`? |
|---|---|---|
| **0** | This spec + audit | no |
| **1** | **4-zone shell** at `/inbox/v2`: folders rail, list w/ status tabs, thread, context panel — wired to existing `/api/v1/inbox`. Interactive primitives (snooze/assign/tags/notes) rendered as disabled placeholders labelled by phase. | no (new route) |
| **2** | Status (open/closed/snoozed) + **snooze** + **assignment** UI. Migration: `SocialConversation.snoozedUntil`. Reuse web-chat assign pattern. | no |
| **3** | **Conversation tags + internal notes**. New models `ConversationTag`, `ConversationNote` + migration + API. | no |
| **4** | **Rich composer**: attachments, emoji, inline quick-replies (TicketMacro), Reply/Note toggle. | no |
| **5** | Custom **team folders** (`InboxFolder`). | no |
| **6** | **Realtime** (SSE/WebSocket) replacing 15s polling. | shared |
| **7** | Inbound **chatbot builder** (extend journey-flow-editor pattern). | no |
| **8** | **Support analytics**: bot-vs-agent, FRT/AHT, efficiency gauge, per-channel. | no |
| **9** | **Bulk messaging** to WhatsApp/Telegram/FB/Push (expand `Campaign.type`). | no |
| **10** | Agent **mobile app** (separate track). | no |

Phases **1–4** deliver the visual + interaction parity the prospect asked for.

## Phase 2 — architectural blocker (discovered 2026-06-05)

The Phase 2 plan above assumed `SocialConversation.status`/`assignedTo` could be
surfaced directly. Investigation found that assumption is **wrong**:

- The inbox list (`GET /api/v1/inbox`, `route.ts`) synthesises conversations by
  grouping `ChannelMessage` rows on a computed `resolveKey` (contact/email/phone/
  chatId). The conversation objects it returns have **no `id`, no `status`, no
  `assignedTo`, no link to any persisted row** (`route.ts:187-200`).
- `SocialConversation` is a **separate** model with `status`/`assignedTo`, served by
  a different endpoint (`/api/v1/inbox/conversations`). It IS populated — but only
  **partially**: facebook / instagram / vkontakte / telegram webhooks call
  `upsertSocialConversation` (`src/lib/facebook.ts:49`) and set
  `ChannelMessage.conversationId` (the FK `ChannelMessage.conversationId →
  SocialConversation`). **whatsapp, inbound SMS, and email ingest do NOT** — they
  write `ChannelMessage` only. So `SocialConversation` covers **~4 of 9 channels**.
  (Telegram's link is fire-and-forget, `src/app/api/v1/webhooks/telegram/route.ts:90-98`
  — not awaited, errors swallowed → best-effort.)
- Net: the `ChannelMessage.conversationId` FK **already exists** and 4 channels
  populate it, but `GET /api/v1/inbox` **ignores it** and re-derives threads from raw
  `ChannelMessage` via `resolveKey`. So the list the v2 UI renders has no `id`/status,
  and `PATCH /conversations/[id]` mutates a row the list never reads.

So Phase 2 is NOT "surface existing data" — it needs a decision on where
per-conversation state lives. Options:

- **D — Enforce + read the existing `conversationId` FK (recommended, lowest cost):**
  the join already exists and 4 channels populate it. Backfill + enforce
  `conversationId` on the 3 missing ingest paths (whatsapp / inbound SMS / email),
  harden the fire-and-forget telegram link, then make `GET /api/v1/inbox` GROUP BY
  `conversationId` (fall back to `resolveKey` only when null) and read
  status / assignment / snooze off the joined `SocialConversation`. No new model, no
  resolveKey-keyed table, durable across contact merges. Reuses existing schema.
- **A — Full unify on `SocialConversation`:** same end-state as D but framed as a
  from-scratch rebuild of conversation persistence. Unnecessary now that the FK is
  known to exist; higher risk, more churn on the shared `/api/v1/inbox` the legacy
  `/inbox` also uses.
- **B — Thread-key state table:** persist status/snooze/assignment in a new table
  keyed by a stabilised `resolveKey`. No ingest changes, but the key isn't durable
  across contact merges / identity changes — the worst choice given D exists.
- **C — Reorder:** do Phase 3/4 (tags/notes/composer) or pin state to `Contact`
  first, defer conversation-level state until the D pass is scheduled.

Recommended: **D** (reuses the existing FK, lowest blast radius, durable). Decision
required before Phase 2 can land without a fake — a client-only status filter that
doesn't persist = exactly the tail the no-loose-ends rule bans.

**DECISION (2026-06-05): User chose C — reorder.** _(SUPERSEDED 2026-06-06 — the
Option-D pass was scheduled and Phases 2-UI / 3b-notes / 4b have since landed; this
block is kept as the dated point-in-time record. For current state + the actual next
phase, see the header and the PROGRESS log below — not this paragraph.)_ At the time,
Phase 2 conversation-state (status / snooze / assignment) was deferred until an
Option-D pass was scheduled. Next work *then*: **Phase 4 (rich composer)** —
attachments / emoji / inline quick-replies (`TicketMacro`) need no conversation
persistence, so they were unblocked first. Phase 3 tags/notes: pin to `Contact`
(`Contact.tags` exists) where it fits; conversation-level tags/notes waited for the D
pass. The Phase-2 placeholders in `inbox/v2` (disabled status tabs / snooze / assign)
stayed labelled-and-disabled — not removed, not faked — until D landed.

**PROGRESS (loop, 2026-06-05):**
- **Phase 4a ✅** — emoji picker + quick-replies (reuse `TicketMacro` `add_comment`
  text via `extractQuickReplies`). Attachments split to **Phase 4b** (POST has no
  attachment field; per-channel send is its own sub-phase).
- **Phase 3a ✅** — **contact-level tags** in the context panel: read/add/remove via
  `GET`/`PATCH /api/v1/contacts/[id]` (optimistic + revert on failure), pure
  `appendTag`/`dropTag` helpers. Conversation-level tags + internal **Notes** stay
  blocked (need conversation persistence → Option-D); the Notes placeholder is
  relabelled to say so. Frontend-only — does NOT touch the shared `/api/v1/inbox`.
  Known limitation: a non-admin role lacking the `tags` field-permission gets a
  stripped read / no-op write (the contacts route filters by field-permission) —
  acceptable for now, noted so it isn't mistaken for a bug.
- **Option-D slice-1 ✅** — `GET /api/v1/inbox` now annotates each thread with its
  persisted `SocialConversation` state (`status` / `assignedTo` / `snoozedUntil`),
  derived per-thread from `messages.find(conversationId)` so grouping stays
  **byte-identical** (resolveKey unchanged → legacy `/inbox` threads unaffected;
  regression-tested: a telegram+email contact stays ONE thread). Migration
  `20260606120000_add_social_conversation_snoozed_until` adds the column. Join is
  batched + org-scoped + skip-when-empty. **Known limit (→ slice-2):** a contact
  merged from TWO SocialConversations surfaces only the most-recent one; D-2 will
  surface them as a list. **Next:** D-slice-2 (enforce `conversationId` on
  whatsapp/sms/email ingest + backfill, harden telegram), then the Phase-2 UI
  (status tabs / snooze / assign) wired to these now-surfaced fields.
- **Option-D slice-2a/2b ✅** — telegram + whatsapp ingest now reliably link each
  inbound message to a SocialConversation (telegram's fire-and-forget → awaited
  try/catch; whatsapp captures the saved message and links it, externalId = waId).
  Persist-message-first: a link failure degrades to heuristic grouping, never
  drops the message or blocks the webhook 200 (architect-verified no message-loss).
  **Next:** D-2c (sms-inbound + email-inbound, same persist-first/awaited-link/
  try-catch pattern), then D-2d (backfill existing rows), then the Phase-2 UI.
  **Phase-2 UI note:** `upsertSocialConversation` increments `unreadCount` on every
  inbound — resolved/snoozed threads will need that gated when the status tabs land.
- **Option-D slice-2c plan CORRECTION (2026-06-06):** the original plan listed
  "sms-inbound + email-inbound" as missing ingest paths — but investigation shows
  **neither creates a ChannelMessage**: `public/email-inbound` routes inbound email
  to Tickets/Comments, and `webhooks/sms-inbound` only handles STOP opt-outs. There
  is no inbound sms/email ChannelMessage to link, so D-2c as planned is a no-op.
  The real remaining gap is **outbound** sends: `POST /api/v1/inbox` (`route.ts:434`)
  creates outbound ChannelMessages with NO conversationId. Linking those (upsert by
  recipient `to`, normalised per channel) would tie agent replies to the inbound
  thread — but it edits the SHARED POST the legacy `/inbox` also uses (regression
  risk). Plus D-2d backfill of existing rows. Decision needed before touching the
  shared outbound path.
- **Phase 2 UI ✅ (2026-06-06)** — status tabs (Opened / Closed / Snoozed via
  `convStatusTab`), **snooze** (date picker → `PATCH snoozedUntil`), and
  **assignment** (agent dropdown → `PATCH assignedTo`) wired to the Option-D-surfaced
  fields. `PATCH /api/v1/inbox/conversations/[id]` hardened: `status` whitelisted to
  open/resolved/archived (else 400 — an unknown value would strand a thread in the
  wrong tab); `snoozedUntil` validated (null=unsnooze | valid date | else 400);
  `assignedTo` + `folderId` guarded as real in-org rows (bare `String?` columns →
  cross-tenant write defense). Threads NOT backed by a SocialConversation (no
  `socialConversationId` — e.g. email/sms) keep these controls disabled-and-labelled,
  never faked.
- **Phase 3b Notes ✅ (2026-06-06)** — per-conversation internal notes, unblocked by
  Option-D: new `ConversationNote` model (FK→SocialConversation, cascade) +
  `GET`/`POST /api/v1/inbox/conversations/[id]/notes`, org-scoped, POST cross-tenant
  404 guard + non-empty 400. Notes show for social-backed threads; the placeholder
  explains why for non-backed ones.
- **Phase 5 Team Folders ✅ (2026-06-06, commit `967e2a21`)** — new `InboxFolder`
  model (no FK; orphan-on-delete resets `folderId→null`), `GET`/`POST`/`DELETE`
  `/api/v1/inbox/folders[/[id]]`, org-scoped. UI: create/delete folders, filter the
  list by folder, assign a conversation to a folder. Deleting the active-filter
  folder resets the filter (no empty-locked list — architect-caught).
- **Phase 4b Attachments — DISPLAY ✅ (2026-06-06, commit `244b25d7`)** — inbound
  media renders in the thread (inline `<img>` for image messages, else a document
  link) and the context panel (`extractAttachments`: image thumb / paperclip + type).
  Reads the TOP-LEVEL `ChannelMessage.mediaUrl`/`messageType` columns (a first cut
  wrongly read `metadata.*` → phantom display against real data; architect caught it,
  fixed end-to-end + the test fixtures corrected to the prod shape so green = real).
  Per-channel **SEND** stays deferred (composer paperclip disabled + labelled) — POST
  has no attachment field; sending is its own per-channel sub-phase. Post-deploy smoke
  owed: eyeball one real FB/WhatsApp media thread. **Deferred (P2, deferred_findings):**
  `GET /api/v1/inbox` `findMany` has no `select` → ships every ChannelMessage column;
  add a projection.

- **Phase 6 slice-1 — Realtime via SSE ✅ (2026-06-06, commit `a28330dd`)** — took
  the **additive v2-only** path (the documented default lean), so zero legacy-inbox
  blast radius. New `src/lib/inbox-stream.ts` (pure, server-safe) + new SSE route
  `GET /api/v1/inbox/stream`: a cheap **change-detector** (org-scoped `count +
  max(createdAt)` signature, 5s poll) that emits `refresh` on a delta; the v2 client
  re-runs its existing `fetchInbox()` — so the heavy inbox-building stays single-
  sourced and the stream never duplicates it. Cookie/session auth via `getOrgId`
  (EventSource sends no custom header). Leak-safe lifecycle (abort + cancel clear the
  intervals; if-closed guard after the baseline await; safeEnqueue). **No nginx.conf
  change needed** — the route sets `X-Accel-Buffering: no` so nginx streams without
  buffering (verify on first prod deploy). Client: 15s poll is now gated on
  `!streamLive` (fallback only); reconnect cap (4 consecutive failures → close +
  poll-only) kills the expired-session 401 reconnect storm; a `connected` resets the
  count so transient blips recover. 10 unit tests, tsc 0, 2 architect passes.
  **Declared slice-1 limits:** detector is message-only (a silent reassignment/status
  PATCH that adds no `ChannelMessage` won't push — the 15s fallback still catches it);
  detector watches the whole org (a new message in any channel refreshes the current
  filtered view). Both fold into slice-2.
- **Phase 6 polish — `streamLive` Live/Polling indicator ✅ (2026-06-06, commit `f28876ef`)**
  — additive dot in the status-tab row; closed the last Phase 6 suggestion.
- **Phase 7 slice-1 — inbound auto-reply rules ✅ (2026-06-06, "не останавливайся")** —
  net-new foundation, NO shared/prod touch. New `ChatbotRule` model + migration
  `20260606160000` (no org FK, orphan-on-delete like InboxFolder), pure
  `src/lib/chatbot-engine.ts` `matchChatbotRule` (active-only · channel filter ·
  priority DESC / createdAt ASC · contains[comma-ANY] / exact / starts_with / always ·
  fail-closed unknown type · empty-text skip), org-scoped management API
  (`/api/v1/inbox/chatbot-rules` GET/POST + `[id]` PATCH/DELETE; getSession auth;
  cross-tenant 404 guard; trigger/value coherence). 29 tests (engine + API guards +
  the deferred SSE auth-401). Explore-first confirmed no existing rule-bot + Journeys
  is OUTBOUND-only → not a duplicate runtime. **Deferred (declared):** slice-2 wires
  `matchChatbotRule` into the shared webhook ingest + sends via a unified
  `sendChannelReply` — MUST ship a loop-guard + per-org enable + rate-limit first
  ([P1] in deferred_findings: `always`-trigger w/ no dedup = reply storm). `matchCount`
  unincremented until slice-2. Admin UI = slice-1b.
- **Phase 8 slice-1 — read-only message analytics ✅ (2026-06-06)** — net-new, ZERO
  shared/nav/UI touch. Pure `src/lib/inbox-analytics.ts` `summarizeMessageAnalytics`
  (folds `channelMessage.groupBy([channelType,direction])` into totals + per-channel
  in/out split; null-channel→"unknown"; sorted total DESC) + `pct`. Read-only
  `GET /api/v1/inbox/analytics` (org-scoped via getOrgId; `?from=&to=` window;
  index-backed groupBy). Direct-URL page `/inbox/analytics` (NO nav link — same
  "verify before linking" stance as v2): 7d/30d/All toggle, total/in/out cards +
  per-channel bars. 12 tests. **Declared scope:** message-level only; conversation
  metrics (FRT/AHT, resolution-rate) are slice-2 (need per-conversation timing; only
  ~4/9 channels persist a SocialConversation → would be partial).
- **Phase 8 slice-2 — conversation status metrics ✅ (2026-06-06)** — additive to the
  slice-1 analytics files (non-breaking response spread). Pure `summarizeConversationStats`
  (folds `socialConversation.groupBy(status)` → open/resolved/archived/other +
  resolutionRate = **resolved/total only** — archived is a SEPARATE disposition, not
  counted as resolved). API adds an index-backed `socialConversation.groupBy([status])`
  (`@@index([organizationId,status])`, same `?from/?to` window) → `data: { ...messages,
  conversations }`. Page gains a "Conversations" card (resolution % + status pills),
  labelled **"social channels only"** + "started in range" — SCOPED to
  SocialConversation-backed channels (telegram/whatsapp/facebook/instagram/vk);
  email/SMS don't persist one, so they're honestly excluded (verified: only
  `lib/facebook.ts` writes SocialConversation; sms-inbound doesn't). 16 tests.
  **FRT** (per-conversation message timing) → slice-3 (below); **AHT** needs a `resolvedAt` column.
- **Phase 8 slice-3 — First Response Time ✅ (2026-06-06)** — net-new + additive. Pure
  `computeFrtStats` (first inbound → first outbound at/after it, per conversation; median
  + avg minutes; answered/unanswered; NaN-safe; sorts internally; ignores agent-initiated
  no-inbound threads). SEPARATE bounded endpoint `GET /api/v1/inbox/analytics/frt` (caps
  500 most-recent SocialConversation in window; `capped` flag → UI "last 500", no silent
  truncation; isolated from the cheap groupBys, page fetches both in parallel). Page gains
  a "First response time" card (median + avg, answered, "still awaiting first reply"),
  social-channel-scoped. 11 new tests. **AHT/handle-time deferred** — needs a `resolvedAt`
  column (= migration = gated). Latent scale note [P3]: the inner message scan is unbounded
  per-conversation (fine at scale; bound per-conv if it ever bites).
- **Phase 7 slice-1b SKIPPED this iteration (declared reorder)** — a chatbot-rules
  admin UI whose rules don't fire (send-wiring gated behind the [P1] loop-guard) would
  be a misleading dormant-feature tail. Deferred until slice-2 wiring lands.

- **Phase 7 — chatbot auto-reply ✅ FULLY BUILT (2026-06-06).** slice-1: `ChatbotRule` model
  + `matchChatbotRule` engine + CRUD API. slice-2a (`66142e48`): `maybeAutoReply` orchestrator
  (enable OFF-by-default · rate-limit/loop-guard · send) + `chatbotTookOwnership`. slice-2b
  (`ed7b1d2d`): wired into telegram + whatsapp webhooks (rule-first → Da Vinci AI fallback).
  slice-2c (`4991a432`): extended send + wiring to facebook/instagram/vkontakte — all 5 social
  channels. enable-fix (`8a18a647`, **unpushed**): the flag is `"chatbotAutoReply"` in the
  `org.features` STRING ARRAY (was wrongly read as an object → un-enable-able). slice-1b
  (`38ba0192`, **unpushed**): admin UI `/inbox/chatbot-rules` (master toggle + rules CRUD).
  Verified LeadDrive channel configs: whatsapp/telegram/facebook configured (will fire);
  instagram/vkontakte NOT configured (code ready, no token → won't send there). **DORMANT** —
  enable OFF; never live-smoke'd.

**NEXT — Phases 1–8 + Phase 7 auto-reply ALL built; the safe net-new runway is SPENT.**
- _Deployed:_ Phases 1–6, Phase 8 analytics, Phase 7 slice-1/2a/2b/2c are on `origin/main` +
  deployed. Auto-reply is DORMANT and — until the unpushed enable-fix lands — un-enable-able.
- _Unpushed → deploy gated on your target:_ **`8a18a647`** (enable-fix — REQUIRED before the
  feature can be turned on) **+ `38ba0192`** (slice-1b admin UI). Push to deploy.
- _Then (needs you):_ enable for an org (the master toggle / add `"chatbotAutoReply"` to
  `features`) + a live smoke (you send a test inbound — telegram easiest).
- _Gated (need a steer):_ **per-channel attachment SEND** (shared POST) · **Phase 6 slice-2**
  LISTEN/NOTIFY (prod-DB trigger) · **AHT** (`resolvedAt` migration). _Separate products:_
  Phase 9 bulk · Phase 10 mobile. _Follow-ups [P3]:_ nav link + i18n for the inbox-v2 pages;
  unify the two channel-send dispatchers; whatsapp non-forceText fetch timeouts.
- _Loop note:_ net-new runway spent — the next move (deploy the fix+UI → enable → smoke) needs a user decision.

## Decisions

- **New route `/inbox/v2`, not in-place** — user choice. Zero risk to the
  live `/inbox`. No nav link yet (direct URL only) until verified; nav item
  added behind a `feature: "inbox_v2"` flag when ready.
- **Old `/inbox/page.tsx` is not edited** in this work. Shared channel
  helpers extracted to `src/lib/inbox-channels.tsx` (new) so the new screen
  doesn't copy-paste them; the old screen keeps its inline copy untouched.
- **English labels** in Phase 1 (enterprise B2B is English-only per product
  memory); i18n keys folded in alongside Phase 2–4 logic, not as a separate pass.
- **No deletion of any existing UI** — per project UI-protection rule.
- **Module gating is implicit via route prefix.** `/inbox/v2` is access-gated
  by the `omnichannel` module because `matchNavItem` longest-prefix-matches it
  to `/inbox` (which carries `module: "omnichannel"`), and the `(dashboard)`
  layout enforces that on direct URL. ⚠️ Do NOT rename the route to
  `/inbox-v2` or a non-`/inbox` prefix — that would silently drop the gate.
  When promoting to a nav item, give it `feature: "inbox_v2"` (hidden until
  enabled) AND keep it under the `/inbox` prefix.
- **Cleanup TODO (Phase ≥ when legacy retired):** the legacy
  `inbox/page.tsx` still has its own inline `channelIcon`/`channelColor`/
  `channelLabel`. When the legacy screen is deleted, remove that inline copy —
  `src/lib/inbox-channels.tsx` is the single source.
- **Phase 4 quick-replies reuse `TicketMacro`** (not a new model): a macro's first
  `add_comment` action text is surfaced as a canned inbox reply via
  `extractQuickReplies` (`src/lib/inbox-channels.tsx`). `TicketMacro` is a ticket
  concept — if macros are ever refactored, keep an `add_comment`-style text action,
  or the inbox composer's quick-replies silently empty out.
