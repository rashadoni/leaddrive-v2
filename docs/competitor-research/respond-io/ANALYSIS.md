# respond.io — omni-channel promo (60s) — visual breakdown + gap vs LeadDrive

Source: WhatsApp promo clip `respond-io-promo-60s.mp4` (720×720, 60s, voiceover==captions).
Frames in `frames/` (named by timestamp). Captured 2026-06-22.

respond.io positions as **"the leading customer conversation platform"** — a
conversation/inbox layer that sits ON TOP of an external CRM (Salesforce/HubSpot).
LeadDrive is the opposite shape: a full CRM where conversations live natively next
to contacts/deals. So this is a *feature-surface* comparison of the inbox layer, not
a like-for-like product comparison.

## Full narration / script (captions, verbatim)
1. "Drowning in customer messages, calls and emails?" (icons: TikTok, WhatsApp, phone)
2. "Respond to them all in one place" → "Meet respond.io"
3. "the leading customer conversation platform, built to handle high chat volumes and calls"
4. "so you never lose an opportunity again"
5. "Track customer journeys to prioritize hot prospects to close high value deals faster"
6. "Connect CRMs like Salesforce or HubSpot"
7. "Personalize customer conversations and move them down the funnel faster"
8. "Keep the momentum going with AI and Automation. Let AI Agent handle routine tasks,
   from answering FAQs, and routing chats, to updating contact details in real time"
9. "Then re-engage customers at scale with personalize offers, and [drive] repeat business"
10. "Need [to] see the big picture? Review customer interactions and measure team performance"
11. "that's reliable, secure and backed by exceptional customer support"
12. "respond.io is built over eight years of expertise and global trust. Book a demo today."

## What's actually on screen (per key frame)

**t14s / t20s — Unified inbox (`chatlist-labels`, `crm-integrations`)**
- Top tabs **`Chats | Calls`** — calls are a first-class peer of chats.
- Conversation thread shows **inline call events**: "Contact answered an incoming call.
  Duration: 30s", "Call ended" — voice is threaded INTO the conversation, not a separate log.
- Per-conversation **lead-stage label dropdown**: `New Lead / Hot Lead / Payment / Customer /
  Cold Lead` (colored). Pipeline staging done right on the chat. Left list shows these labels +
  per-channel icon (WhatsApp/Telegram/…) + online dot.
- Composer: channel selector (`Whatsapp ▾`), **`AI Assist`** (sparkle) inline compose helper,
  snippets (`/`), variables (`$`), emoji, attachments. A product card ("Level 1 – Beginner
  Course, USD 100.00") was sent inline → **catalog/product send**.
- Right rail = **integrations marketplace**: monday.com, Zapier, WooCommerce, Pipedrive,
  Salesforce (and generic CRM). 3rd-party connector ecosystem.

**t30s — AI-Agent visual automation builder (`ai-agent-flow-builder`)**
- Drag-drop canvas, zoom/undo controls, `Save` / `Test`.
- Flow "Assignment: AI Agent — assign a contact to an AI agent every time a contact starts…":
  `Trigger: Conversation Opened` → `AI Agent: Answer Questions` → **3 outcome branches**:
  - **Success** → `Close Conversation` (Category: New Lead)
  - **Failure: Others** → `Failure Message` → `Assign to Team` (user in Sales team)
  - **Failure: Idle** → `Failure Message` → `Close Conversation` (Category: Spam)
- i.e. an AI agent node with success/failure routing, auto-categorize, auto-close, auto-assign.

**t36s — `Send Broadcast`** — one-click bulk re-engagement across messaging channels.

**t44s / t48s — Analytics (`interactions-gauge`, `team-performance-dash`)**
- Interactions gauge (219), and a team dashboard: total messages (21415), **per-agent activity
  bars** (workload/performance), donut (318), 75%/52% KPI bars, trend bar-chart.

---

## GAP ANALYSIS — respond.io vs LeadDrive omni-channel

LeadDrive inventory verified in code (Explore audit, 2026-06-22). Channels wired: WhatsApp,
Telegram, SMS, Email, Web-chat, TikTok (Chatwoot relay), Facebook, Instagram, VK, VoIP(read).

### ✅ Parity — we already have it
| Capability | LeadDrive evidence |
|---|---|
| Unified multi-channel inbox | `src/lib/inbox-channels.tsx`, `src/app/(dashboard)/inbox/`, 11 channels |
| AI auto-reply w/ persona + escalation | `src/lib/social/ai-autoreply.ts`, `AiAgentConfig agentType="inbox"`, `/inbox/ai-agent` |
| Contact linking + tags + lifecycle on convo | `/api/v1/inbox/route.ts` contact-resolution; `Contact.category/source` |
| Team performance analytics (per-agent, FRT, resolution) | `/api/v1/inbox/analytics/team/route.ts` |
| Conversation/ call insights (sentiment, topics) | `/api/v1/conversation-insights/` |
| Native CRM (deals/contacts) — they need to *connect* one, we ARE it | whole repo |

### 🔴 Gaps — respond.io has, we don't (ranked by leverage)
1. **AI-Agent visual flow builder for chat** — drag-drop canvas where an AI-Agent node
   answers FAQs, then branches success/failure → auto-categorize / auto-close / auto-route to
   team. We have a *marketing* journey builder (`journey-flow-editor.tsx`) + rule-based chatbot,
   but NO visual builder for conversation routing/AI-agent orchestration. **Biggest gap.**
2. **Automated routing/assignment** — skill/round-robin/queue auto-assign. Ours is manual
   (`assignedTo` set by hand) + keyword escalation only.
3. **Broadcast on messaging channels** — one-click `Send Broadcast` to WhatsApp/Telegram/etc
   for re-engagement. Our campaigns are **Email/SMS only**; social/WhatsApp bulk send NOT built.
4. **Voice calls as first-class inline channel** — `Calls` tab + call events threaded in the
   conversation + (implied) click-to-call. Ours: VoIP is **inbound, read-only** (logs+insights),
   not threaded inline, no outbound from inbox.
5. **AI auto-updates contact fields / auto-categorizes** "in real time" — AI writes back to the
   record. Ours: AI replies + escalates, doesn't auto-mutate contact fields/category.
6. **AI Assist compose helper** — inline rewrite/suggest while a HUMAN agent types. We have
   auto-reply bot but no agent-side compose assist surfaced.
7. **Canned snippets `/` + variables `$` in composer** — quick replies / templates per channel.
   Not clearly present for us.
8. **3rd-party integrations marketplace** (Salesforce/HubSpot/monday/Zapier/WooCommerce/
   Pipedrive). We're CRM-native so less critical, but no Zapier/connector story.
9. **Native mobile app for inbox** — they show a phone mockup. We're web-only (the MTM app is a
   different field-ops product, not the inbox).
10. **Inline product/catalog send** — send a priced product card into the chat.

### 🟢 Our edges over respond.io
- Conversations are **native to a full CRM** (deals, pipeline, marketing, finance) — no external
  CRM to wire, no sync lag, no per-seat conversation-tax on top of a CRM.
- **Native TikTok bridge** live in prod (two-way), VK channel.
- **24h AI auto-follow-up** cron + per-channel AI/agent matrix + Gobustone persona editor.
- We own the data end-to-end (multi-tenant, RLS plumbing, encryption-at-rest).

### Suggested roadmap order (highest leverage first)
1. Visual AI-Agent flow builder for chat (reuse `journey-flow-editor.tsx` canvas → add
   conversation triggers + AI-Agent/route/categorize/close nodes).
2. Messaging-channel broadcast (extend campaigns send-path to WhatsApp/Telegram, respect 24h window).
3. Auto-routing rules (round-robin / load / skill) on conversation-open.
4. AI Assist compose helper + canned snippets in the inbox composer.
5. Outbound/click-to-call + thread call events inline (build on existing VoIP insights).
