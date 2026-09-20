# LeadDrive private guided demo — full Codex Cloud handoff

Status: **implementation handoff; product intent confirmed; implementation not started in this branch**

Date: 2026-09-20

Owner: Rashad Rahimsov

Working branch: `codex/demo-selected-sales-journey`

Starting commit: `df65ee2bb` (`origin/main` when this handoff was written)

## 0. Cloud: read this first

This file is the authoritative starting point for the next Codex Cloud task.
Do not reconstruct the request from the existing three-card demo player and do
not interpret the current implementation as the desired product. The existing
security/access foundation is useful; the existing static demo content is the
part that must be replaced.

Before editing:

1. Read `AGENTS.md` completely.
2. Read `.impeccable.md`, especially **Confirmed Feature Brief: Private Demo
   Center**.
3. Read `docs/DEMO_CENTER.md`, this file, `docs/voice-call-queue-flow.md`,
   `docs/voice-core-architecture.md`, `docs/call-centre-handoff.md`, and
   `docs/VIDEO-GUIDES-HANDOFF.md`.
4. Inspect the actual LeadDrive screens named in sections 4 and 8. Do not invent a
   Salesforce-looking sales module and do not use screenshots of a real tenant.
5. Work only on a clean `codex/*` branch/worktree. Stage explicit paths and make
   path-scoped checkpoint commits.
6. Treat schema/RLS, public capability access, outbound calling, background
   jobs, email/SMS, and deployment as safety-lane work.

The next task should first produce a verified inventory and design brief, then
implement one complete vertical journey. It must not attempt all 19 modules in
one unreviewable change.

## 1. The essence — do not lose this

LeadDrive needs a **private, personalised, one-session guided product demo** for
corporate prospects. It is not a public tenant, not a normal trial account, not
a static brochure, and not a fictional dashboard.

The prospect supplies corporate identity data. In the demonstration, that same
prospect becomes the lead being processed. They should watch and interact with
their own story moving through LeadDrive:

`registration → marketing source → omnichannel conversation → AI reply →
verified/consented AI phone call → lead → task → deal → commercial proposal →
closed won`

The client must recognise the **real LeadDrive product architecture and real
LeadDrive module UI**. The demonstration may use synthetic/session-scoped data
and safe presentational adapters, but the screens, navigation, controls,
terminology, and state transitions must correspond to the real application.

The owner must be able to decide from the superadmin area:

- which approved demo scenarios/sections a prospect receives;
- their order;
- link validity, absolute session duration, and inactivity timeout;
- whether the phone-call exercise is enabled;
- whether narration/video is enabled;
- when to issue, reissue, revoke, preview, or reject access.

The link is private and usable for one browser-bound session. It never grants a
tenant login and never exposes a customer tenant or customer data.

### The first production slice

Do **not** start by rebuilding all 19 catalogue entries. Build and prove this
selected sales journey first:

1. Marketing source/campaign context.
2. Omnichannel inbox.
3. AI correspondence agent.
4. Contact/lead card creation from the conversation.
5. AI voice assistant / authorised AI phone call.
6. Automatic follow-up task creation.
7. Tasks workspace.
8. Leads workspace and lead details.
9. Deal creation and pipeline progression.
10. Commercial proposal/quote creation.
11. Closed-won result and attribution back to the original source.

After this end-to-end slice is accepted, use the same scenario architecture for
the remaining approved modules.

## 2. Explicit anti-goals and lessons from the rejected version

The owner rejected the current visual demo because the synthetic sales cards do
not look or behave like LeadDrive's actual Sales module. Avoid repeating that
mistake.

The result must **not** be:

- three generic cards per module with fake metrics and a button that only
  changes text;
- a long marketing page pretending to be a product tour;
- screenshots of a live/customer tenant;
- a Salesforce skin copied onto unrelated LeadDrive concepts;
- a full tenant login handed to a prospect;
- a video-only experience with no guided interaction;
- a public URL that reveals every module to everyone;
- a single giant demo with all 19 modules regardless of the prospect;
- an actual external send/call triggered without verification, explicit
  consent, policy checks, idempotency, and audit evidence;
- a claim that screen capture or browser inspection can be made impossible.

Use Salesforce as an interaction/teaching reference, not as code, copyrighted
assets, wording, or a visual clone.

## 3. What the Salesforce audit established

The source Salesforce audit was performed in a separate local Codex task. It
was substantial but explicitly **partial**, not an exhaustive audit of every
Salesforce feature.

Archived/local task identity:

- title: `Проведи аудит Salesforce`
- thread ID: `01a0bb17-f122-7b83-ba6a-62f30895dc0a`
- local Mac workspace:
  `/Users/rashadrahimov/Documents/Codex/2026-09-19/salesforce-google-chrome-computer-use-onboarding`

Evidence produced there:

- 3,125 captured UI states/screenshots with no missing evidence in its index;
- 11 dashboards opened;
- 99 reports inspected (four access-denied states, one API error);
- 72 Flow cards inspected;
- 58 Flow version records inspected; 14 versions remained unreviewed;
- onboarding, Getting Started, guided tours, videos, and Guided Workflows were
  examined;
- sample Lead, Case, and Contact creation was observed.

Local-only source artifacts (not assumed available to Cloud):

- `outputs/salesforce-audit/REPORT.md`
- `outputs/salesforce-audit/index.html`
- `outputs/salesforce-audit/CRM_COMPARISON.md`
- `outputs/salesforce-audit/HANDOFF.md`

The important observed product patterns are embedded here so Cloud does not
depend on those local paths:

1. Registration/onboarding asks what brought the user to the product and what
   problem they want to solve; it tailors what is shown next.
2. A Getting Started hub combines short video learning, guided workflows,
   progress, and direct routes into the product.
3. The main product shell stays visible. Contextual coach marks point to real
   navigation and controls instead of replacing the product with a brochure.
4. Tours are short, ordered, pausable/skippable, and clearly show step count and
   progress. The audit observed a 33-step introductory tour.
5. Guided workflows do something recognisable with sample records. The user
   sees cause and effect rather than only reading descriptions.
6. Teaching is layered: orientation, focused task, visible result, then the next
   task. Video is a supporting asset, not the entire demonstration.
7. Navigation and learning remain connected: after an explanation, the user is
   taken to the relevant working surface.
8. The system limits the experience to selected jobs rather than pretending to
   teach the whole platform at once.

These findings answer the architecture question well enough to implement the
LeadDrive version. The 14 unreviewed Flow versions are not a blocker for the
selected sales journey.

## 4. Current repository reality

### Useful foundation already merged

The existing Demo Center was introduced through the `codex/demo-center` work
and is in `main`. Preserve and extend these capabilities unless a test proves a
defect:

- public corporate demo request form;
- superadmin request list/detail;
- admin selection and ordering of 19 allow-listed module IDs;
- superadmin preview that sends nothing and consumes no session;
- email delivery of a raw capability token while only its SHA-256 hash is
  persisted;
- six-digit email OTP with send/attempt limits;
- explicit start (opening/scanning the email link does not consume access);
- one browser-bound session with refresh recovery;
- absolute and idle expiry;
- reissue revokes previous usable grants;
- explicit revoke/reject;
- append-only access-event history;
- RLS-forced control-plane tables accessed only through explicit bypass
  handlers;
- no tenant login or tenant API access;
- no-store/no-referrer/noindex, token scrubbing, hashed rate-limit keys, and
  session-replay suppression;
- a prospect-specific watermark.

Primary existing files:

- `docs/DEMO_CENTER.md`
- `prisma/schema.prisma` (`DemoRequest`, `DemoGrant`, `DemoAccessEvent`)
- `prisma/migrations/20260919170000_demo_center_one_session/migration.sql`
- `src/lib/demo-center/access.ts`
- `src/lib/demo-center/catalog.ts`
- `src/lib/demo-center/email.ts`
- `src/lib/demo-center/security.ts`
- `src/lib/demo-center/session.ts`
- `src/lib/demo-center/telemetry.ts`
- `src/lib/demo-center/validation.ts`
- `src/components/demo-center/demo-access-shell.tsx`
- `src/components/demo-center/demo-player.tsx`
- `src/components/admin/demo-request-editor.tsx`
- `src/app/(marketing)/demo/page.tsx`
- `src/app/admin/demo-requests/page.tsx`
- `src/app/admin/demo-requests/[id]/page.tsx`
- `src/app/demo-access/[token]/page.tsx`
- `src/app/demo-preview/[id]/page.tsx`
- `src/app/api/v1/public/demo-requests/route.ts`
- `src/app/api/v1/public/demo-access/[token]/**`
- `src/app/api/v1/admin/demo-requests/[id]/**`
- `src/app/api/v1/admin/demo-grants/[id]/revoke/route.ts`
- `src/__tests__/demo-center.test.ts`
- `src/__tests__/demo-center-api.test.ts`
- `src/__tests__/demo-center-admin-api.test.ts`

### What is inadequate and must change

`src/lib/demo-center/catalog.ts` currently defines each module as exactly three
generic `DemoStep` entries containing three metrics and three records.
`src/components/demo-center/demo-player.tsx` renders those values as invented
product scenes. This is the rejected architecture.

Do not add more fake metrics to it. Replace the content model with a versioned
scenario model capable of rendering real LeadDrive-aligned scenes, coach marks,
actions, videos, captions, expected transitions, and completion evidence.

### Existing real product areas to reuse or mirror

Inspect these actual product surfaces and their supporting APIs before shaping
demo scenes:

- Leads: `src/app/(dashboard)/leads/**`, `src/components/leads/**`,
  `src/components/lead-detail-modal.tsx`, `src/components/lead-form.tsx`.
- Deals: `src/app/(dashboard)/deals/**`, `src/components/deals/**`,
  `src/components/deal-form.tsx`.
- Quotes/proposals: `src/app/(dashboard)/quotes/**`, `src/lib/cpq/**`, and quote
  relations in `prisma/schema.prisma`.
- Tasks: `src/app/(dashboard)/tasks/**`, `src/components/tasks/**`,
  `src/lib/tasks/**`.
- Omnichannel: `src/app/(dashboard)/inbox/**`, `src/components/inbox/**`,
  `src/lib/inbox/**`.
- AI CRM voice assistant: `src/app/(dashboard)/ai/voice/page.tsx`,
  `src/components/ai/**`, `src/lib/ai/voice/**`.
- AI phone calls: `src/components/leads/lead-ai-call-action.tsx`,
  `src/lib/voice-agent/**`, `src/app/api/v1/voice-call-queues/**`, and
  `src/components/voice-call-queues/**`.
- Human/browser calling: `src/components/leads/lead-browser-call-action.tsx`,
  `src/components/call-widget.tsx`, `src/app/api/v1/calls/**`.
- Marketing attribution: `src/lib/marketing-attribution/**`.

Reuse shared presentational components where they can safely accept a demo data
adapter. Do not mount authenticated pages inside the public demo and do not let
demo components call tenant routes.

## 5. Product roles and complete flows

### Prospect flow

1. Prospect opens `/demo` and submits name, company, position, corporate email,
   phone, language, and request note. A short Salesforce-inspired discovery
   step also asks what brought them to LeadDrive and which business challenge
   matters now (for example lead handling, deals, follow-up, reporting, or
   omnichannel). These answers help the admin recommend a scenario; they never
   grant modules automatically.
2. Prospect accepts the general demo/privacy consent. This is not yet consent
   to an automated phone call.
3. The request is stored in the control plane and the owner is notified.
4. Superadmin reviews the request, chooses the scenario sections and order,
   configures timeouts, enables/disables the call exercise, and previews it.
5. Superadmin issues access. Earlier usable grants are revoked.
6. Prospect opens the invitation and verifies corporate email using OTP.
7. If the live call exercise is enabled, prospect verifies the phone number via
   a separate phone OTP or equally strong provider-verified challenge.
8. Prospect explicitly starts the one browser-bound session.
9. A short Azerbaijani orientation identifies the interface and explains that
   all product records are synthetic/session-scoped.
10. The prospect follows the selected scenario. Coach marks point to actual
    LeadDrive-aligned controls, and every interaction produces a visible state
    change.
11. At the call step, the prospect sees the verified destination, calling
    window, AI disclosure, recording/transcription disclosure if applicable,
    and a separate unchecked explicit consent control.
12. Only after consent and a server-side preflight may a single test AI call be
    queued. Repeated clicks return the same attempt; they must not redial.
13. The call result appears in the demo timeline. If connected, the AI summary,
    outcome, agreed next action, and auto-created task become visible.
14. The prospect advances the same self-lead through deal and quote scenes to a
    closed-won result.
15. The final screen summarises what was completed, ends the capability session,
    and provides a contact/sales follow-up action without reopening the demo.

### Superadmin flow

1. Open **Admin → Demo Center** and inspect request identity, source, consent,
   and risk signals.
2. Select a versioned scenario and choose its allowed sections; show coverage
   percentage and estimated duration.
3. Reorder sections and optionally enable video, narration, and live call.
4. Configure link expiry, session limit, inactivity timeout, and permitted call
   window.
5. Preview the exact prospect-specific playlist with zero sends/calls/events.
6. Issue or reissue the invitation.
7. Observe delivery, OTP, verification, session, step, video, call, task, deal,
   quote, completion, denial, and error events.
8. Revoke immediately or reject the request.
9. See a compact conversion summary: started, completed, sections viewed,
   call outcome, follow-up task, and sales handoff state.

### Internal sales follow-up

The prospect should become a real internal LeadDrive sales lead without gaining
tenant access. Recommended boundary:

- `DemoRequest` remains the external/control-plane source of truth.
- After verification (not merely an unverified form POST), a server-only command
  creates or links a lead inside the configured LeadDrive sales organisation.
- The organisation ID is deployment configuration, not a browser-provided ID.
- Deduplicate by verified normalised email and verified E.164 phone.
- Store the relation (`crmLeadId` or a separate mapping) without returning the
  internal record ID to the public player.
- The public demo renders a sanitised/session snapshot using the prospect's
  supplied name/company/phone mask. It does not read the internal tenant lead.
- Consent/source/campaign/demo-request ID must be preserved in the internal
  lead metadata for audit and attribution.

Do not create a new tenant for each prospect and do not let the public route
run an arbitrary tenant-scoped command.

## 6. Interaction architecture

### Recommended manifest model

Replace the fixed `module → three cards` contract with a versioned scenario
manifest. A manifest should contain at least:

- stable `scenarioId` and `version`;
- Azerbaijani title/summary and optional `ru`/`en` localisations;
- ordered sections and total estimated duration;
- required capabilities (email verification, phone verification, live call,
  video, narration);
- section-to-real-product-route/component mapping;
- steps with stable IDs, title, instruction, target anchor, placement,
  required/optional action, expected state transition, and completion rule;
- optional short video asset, poster, captions, transcript, and narration
  metadata;
- synthetic/session data dependencies;
- entry/exit states and rollback/reset behaviour;
- analytics event names;
- accessibility fallback when a target or motion is unavailable.

Example shape (illustrative, not a demand for these exact TypeScript names):

```ts
interface DemoScenarioManifest {
  scenarioId: "prospect-to-closed-won"
  version: number
  sections: DemoScenarioSection[]
}

interface DemoScenarioStep {
  id: string
  scene: "marketing" | "inbox" | "lead" | "task" | "deal" | "quote" | "result"
  target: string
  action: "observe" | "click" | "type" | "choose" | "confirm" | "wait"
  completion: DemoCompletionRule
  video?: DemoVideoAsset
}
```

Never use unstable CSS selectors as the only tour contract. Give reusable
product/demo controls stable `data-demo-anchor` identifiers and test that every
required anchor exists.

### Rendering strategy

Use one dedicated public demo shell with the same information architecture as
LeadDrive. Inside it, use safe scene adapters that share real presentational
components/tokens where possible and receive only a session-scoped synthetic
snapshot. The safe data source is a dedicated demo journey API protected by the
capability session, not tenant APIs.

Every scene action should update a durable or reconstructable journey state.
Refresh must restore the current step and records. Back/forward must not repeat
an external side effect. Preview mode must use the identical renderer but a
pure in-memory fixture and must never emit external effects.

The guided layer needs:

- progress (`step n of m` and section progress);
- next/back/skip where permitted;
- focus management and keyboard control;
- target spotlight/coach mark without hiding the surrounding UI;
- visible result after each required action;
- pause/resume for video and narration;
- reduced-motion support;
- mobile/tablet adaptation without removing critical actions;
- recovery state if the expected anchor does not render;
- expiry/revocation/connection-loss handling inherited from the current shell.

### Journey state machine

Suggested states:

`PREPARED → STARTED → MARKETING_CAPTURED → CONVERSATION_OPENED → AI_REPLIED →
LEAD_CREATED → PHONE_READY → CALL_QUEUED → CALLING → CALL_RESULT_RECORDED →
TASK_CREATED → DEAL_CREATED → QUOTE_CREATED → CLOSED_WON → COMPLETED`

Alternative terminal/attention states:

`CALL_DECLINED | CALL_BLOCKED | CALL_NO_ANSWER | CALL_BUSY | CALL_FAILED |
CALL_ATTENTION_REQUIRED | EXPIRED | REVOKED`

The non-call path must remain completable. Declining or failing the call should
show a truthful simulated result and continue, clearly marked as not a completed
live call.

## 7. Self-lead and live AI-call contract

This is the highest-risk part. Existing AI-call code is a disabled foundation,
not blanket authorisation to call demo prospects.

### Separate three concepts

1. **Demo invitation email OTP** — already implemented.
2. **Phone ownership verification and live-call consent** — not implemented by
   the current Demo Center and required before calling.
3. **Azerbaijani narration for recorded guide videos** — a separate media
   pipeline; it is not the telephone agent.

Google AI Studio credentials alone do not provide PSTN/SIP delivery. The live
call still requires the approved telephony/PBX route and voice-agent runtime.

### Required call preflight

Before any call attempt, the server must prove:

- the grant and one-session credential are active;
- the call exercise is included in the issued scenario;
- corporate email is verified;
- phone is canonical E.164 and ownership is verified;
- explicit call consent exists, with timestamp, wording/version, IP/device hash
  metadata, language, and recording/transcription choice;
- the current time is inside configured calling hours and the prospect's
  timezone is known;
- there is no suppression/opt-out/DNC block;
- no active or recently completed demo call exists for this request, phone, or
  dedupe window;
- per-request, per-phone, per-IP, and daily tenant limits allow it;
- provider/runtime readiness and cost guard are healthy;
- the internal linked lead still matches the verified phone revision;
- an idempotency key has been durably reserved before provider initiation.

### Call behaviour

- The agent immediately identifies itself as an AI assistant calling for the
  LeadDrive demo.
- It confirms the person expected the call and provides a simple spoken opt-out.
- It uses Azerbaijani first, with only approved language fallback.
- It performs a short qualification/demo conversation, not a deceptive cold
  sales call.
- It records provider lifecycle truthfully: queued, accepted, ringing,
  connected, no answer, busy, failed, unknown/attention required.
- It never treats provider acceptance as a connected conversation.
- It never auto-redials after uncertain delivery.
- Spoken opt-out must create the durable suppression record before this feature
  may be generally enabled.
- After a proven terminal result it may save transcript/summary references,
  disposition, agreements, and exactly one deduplicated next task.
- The browser polls/streams status but never initiates a second attempt on
  refresh.

Reuse the invariants in `docs/voice-call-queue-flow.md`. Do not bypass its
disabled/live-readiness gates just because the recipient is a demo prospect.
No agent or automated test may place a real call. A final controlled call
requires the owner's explicit per-call authorisation.

### Suggested persistence additions

Exact schema is for implementation review, but the durable model must cover:

- `DemoRequest`: normalised/verified phone, timezone, linked internal lead,
  source/campaign, and separate consent versions/timestamps;
- `DemoGrant`: scenario ID/version, selected section IDs, call-enabled flag,
  narration/video flags;
- `DemoJourney`: current state, version, synthetic snapshot, current step,
  started/completed timestamps;
- `DemoCallAttempt`: request/grant/journey/lead links, idempotency key, verified
  phone revision/hash, consent evidence, provider correlation, lifecycle,
  terminal outcome, transcript/summary references, and task ID;
- expanded `DemoAccessEvent` vocabulary for phone verification, consent, video,
  anchors, journey transitions, call lifecycle, and sales handoff.

All new control-plane tables require `ENABLE ROW LEVEL SECURITY`, `FORCE ROW
LEVEL SECURITY`, least-privilege policies, indexes/constraints, migration-role
handling consistent with the existing migration, and cross-tenant/no-context
tests.

## 8. First scenario: exact coverage map

Cloud must validate this map against the current product UI and produce an
inventory before implementation. The target is **at least 80% of meaningful
sections within each selected product area**, measured by an explicit section
inventory—not by counting arbitrary coach marks.

| Stage | Real LeadDrive area | Minimum story/evidence |
|---|---|---|
| 1 | Demo registration | Corporate identity captured; source/campaign and general consent saved |
| 2 | Marketing | Show the originating campaign/source and an attributed inbound response |
| 3 | Omnichannel | Open the prospect conversation in the real-aligned Inbox layout |
| 4 | AI correspondence | AI draft/reply, safety/approval state, visible sent/simulated result |
| 5 | Lead creation | Create the self-lead card with source, company, contact, owner, status, and timeline |
| 6 | Lead qualification | Show lead score/qualification and the next recommended action |
| 7 | Phone exercise | Verify destination, consent, preflight, call lifecycle, truthful outcome |
| 8 | AI result | Display summary, disposition, agreements, and transcript/recording availability truthfully |
| 9 | Tasks | Auto-create one follow-up task, then show owner, due time, relation, and status |
| 10 | Deal | Convert/link lead to deal and show pipeline stage, amount, probability, and next step |
| 11 | Quote | Build a commercial proposal using actual quote concepts, line items, totals, validity, and status |
| 12 | Closed won | Move the deal to a valid won state and show attribution and activity history |
| 13 | Completion | Summarise completed journey, close session, and create internal follow-up without exposing tenant access |

For each selected area, create a coverage file/table with:

- actual section/tab/control inventory;
- included/excluded decision;
- reason for exclusions;
- tour/video/interactive coverage type;
- stable step IDs;
- important icons, labels, tooltips, focus/hover states, transitions, and motion
  that must remain recognisable in the demo;
- verification evidence;
- computed percentage.

The owner explicitly asked that the demo cover at least 80% of the relevant
sections. A single overview per module does not satisfy this.

## 9. Video and Azerbaijani narration

The product requires Salesforce-like short instructional videos as part of the
guided experience. Reuse the existing LeadDrive help-video pipeline instead of
building another recorder:

- `scripts/produce-guides.mjs`
- `video/scenarios/overrides.mjs`
- `scripts/help-video/generate-browser-guided.mjs`
- `scripts/help-video/build-browser-guided-scenarios.mjs`
- `src/components/help/help-video-launcher.tsx`
- `src/components/help/help-drawer.tsx`
- `src/content/help/video-assets.ts`

Existing `video/player/*.VOICE.mp4` and approved audio may be reused only after
confirming that the screen version, wording, tenant data boundary, and rights
are appropriate for the private demo. Do not assume every existing video is
current.

Video requirements:

- Azerbaijani first; later `ru`/`en` variants may share the visual capture;
- captions and a text transcript always available;
- visible cursor and controlled focus;
- one goal per short clip;
- exact version mapping to scenario and UI build;
- no real customer data, credentials, notifications, bookmarks, or unrelated
  browser chrome;
- poster image and graceful fallback when video cannot load;
- completion never depends exclusively on audio;
- no autoplay with sound before user action;
- analytics for start, completion, skip, replay, and error.

Hard repository rule: **never generate narration with local TTS**. No
`edge-tts`, macOS `say`, `pyttsx3`, `espeak`, `gTTS`, Coqui, or local fallback.
Use only user-supplied human audio or an explicitly approved external provider
workflow with credentials supplied through environment variables. Do not
commit credentials. Google AI Studio may be evaluated as the approved external
workflow, but model/voice/licensing/quality must be verified; do not silently
substitute another provider.

## 10. Security and privacy invariants

These are release blockers, not polish:

1. Public demo code never receives a tenant session.
2. Public demo routes never accept a browser-supplied organisation/tenant ID.
3. Returned payloads contain only the issued scenario and safe session data.
4. No customer tenant rows, real names, phone numbers, messages, amounts, or
   screenshots appear in the demo.
5. Capability, verification, session, and phone tokens are hashed at rest and
   redacted from logs, errors, analytics, referrers, and replay.
6. Opening the email does not consume the session; explicit start does.
7. One grant can be active in one browser only and survives a safe refresh.
8. Reissue/revoke/expiry immediately removes access and prevents external
   effects.
9. Every external effect is idempotent and starts only after durable intent.
10. Preview mode is effect-free by construction, not by hiding buttons alone.
11. Watermark remains visible but is described as deterrence, not DRM.
12. Corporate email and phone data follow retention/deletion policy; handoff
    must not invent a retention period.
13. Recording/transcription consent is separate and jurisdiction-aware.
14. Rate limits are durable/distributed where they guard paid calls or OTPs;
    process-local counters are not sufficient.
15. All error states fail closed without implying a call/message happened.

## 11. Required UX states

At minimum design and test:

- request empty, invalid, duplicate, rate-limited, accepted, notification
  failed but persisted;
- under review, rejected, fulfilled;
- no scenario selected, scenario selected, reordered, previewing;
- invitation issuing, sent, delivery failed, reissued;
- email OTP ready, sent, invalid, exhausted, expired, verified;
- phone verification unavailable, sent, invalid, exhausted, verified;
- verified but not started;
- active in this browser, active elsewhere, refresh recovered;
- current step loading, anchor missing, action pending, action succeeded,
  optional step skipped;
- video loading, playing, paused, completed, skipped, failed;
- call disabled, consent not given, outside hours, provider unavailable, queued,
  ringing, connected, no answer, busy, failed, attention required, completed;
- task/deal/quote transition success and idempotent retry;
- session completed, expired, revoked, connection lost;
- admin access history and conversion summary;
- desktop, tablet, mobile, keyboard-only, screen reader, and reduced-motion
  behaviour.

All prospect-facing copy must be natural Azerbaijani. Admin copy should follow
the application's current localisation policy; the current English-only demo
admin is not a reason to add more untranslated strings.

## 12. Delivery plan and checkpoint commits

### Phase A — inventory and contracts

- Map the selected real product screens and meaningful sections.
- Define the 80% coverage calculation and record exclusions.
- Write the versioned scenario schema and fixtures.
- Add architectural tests that prevent public demo code from importing/calling
  tenant data routes.
- Produce a clickable static/synthetic prototype in superadmin preview only.

Checkpoint: `docs(demo): define guided sales journey and coverage contract`

### Phase B — guided renderer

- Replace the generic metric/record player with the scenario renderer.
- Build LeadDrive-aligned safe scenes and stable demo anchors.
- Add progress, coach marks, focus, keyboard, reduced motion, responsive states,
  restart/reset, and refresh restoration.
- Keep existing capability/OTP/session lifecycle intact.

Checkpoint: `feat(demo): add LeadDrive guided journey renderer`

### Phase C — self-lead and internal handoff

- Add verified identity and deduplicated internal lead linking.
- Add session snapshot and journey transitions.
- Preserve source/campaign/consent attribution.
- Never return internal tenant IDs or data to the public player.

Checkpoint: `feat(demo): create verified prospect self-lead journey`

### Phase D — phone verification and call foundation

- Implement separate phone verification and consent journal.
- Add call-enabled scenario/admin controls and durable idempotent attempt model.
- Integrate with existing voice readiness gates; keep live calls disabled by
  default.
- Build truthful status UI and simulated/provider-stub tests.

Checkpoint: `feat(demo): add consented demo-call workflow foundation`

### Phase E — tasks, deal, quote, closed won

- Drive the session snapshot through one deduplicated task, deal, quote, and
  valid closed-won transition.
- Show source attribution and the internal follow-up state.
- Ensure refresh/retry never duplicates records.

Checkpoint: `feat(demo): complete prospect-to-closed-won story`

### Phase F — videos/narration

- Reuse the established guide pipeline.
- Produce/version Azerbaijani clips and captions for the selected scenario.
- Use only approved external/user-provided audio.
- Add video telemetry and fallback states.

Checkpoint: `feat(demo): add versioned Azerbaijani guided media`

### Phase G — admin analytics and hardening

- Coverage/estimated-duration editor.
- Full event timeline and conversion summary.
- Revocation/external-effect fences and retention tooling.
- Accessibility, responsive, PII, RLS, rate-limit, and threat-model review.

Checkpoint: `fix(demo): harden private journey and admin evidence`

Do not combine all phases into one commit or one PR.

### Owner decisions that may be deferred, but never guessed

Phases A-C can proceed without these. Stop at the relevant external-effect gate
and ask the owner when they become necessary:

- the configured internal LeadDrive sales organisation that will own verified
  demo leads;
- the exact telephony/PBX provider and demo caller ID approved for the live
  exercise;
- call recording/transcription disclosure and retention policy;
- approved call hours, timezone rule, repeat-attempt cap, and cost cap;
- final Azerbaijani telephone-agent script and human-handoff destination;
- the external narration provider/model/voice and approved credentials;
- final video scripts and voice pronunciation approval;
- production release route after the repository/deployment discrepancy in
  section 14 is reconciled.

## 13. Acceptance criteria

The first journey is acceptable only when all of the following have evidence:

### Product fidelity

- The selected scenes match the current LeadDrive navigation, terminology, and
  important controls; the owner no longer sees an invented Sales UI.
- The coverage inventory proves at least 80% of meaningful sections for every
  selected product area, with explicit exclusions.
- A prospect can follow one coherent self-lead story from registration to
  closed won.
- Every required action produces a visible and persistent state change.
- Video supports the workflow but does not replace interactive guidance.

### Access/security

- No tenant authentication or tenant API access is granted.
- A link open/prefetch does not consume the session.
- Only explicit start consumes it; the same browser can refresh/recover.
- Another browser cannot enter the active session.
- Reissue, revoke, expiry, and inactivity close it.
- Only server-issued scenario sections are returned.
- Tokens and PII do not leak to logs, Sentry, analytics, referrers, or replay.
- Cross-tenant/no-context access to control-plane rows fails closed.

### Self-lead and effects

- Unverified/spam requests do not create duplicate internal leads.
- Verified identity creates or links exactly one internal lead using server-side
  organisation configuration.
- Public responses never expose the internal organisation or lead ID.
- Refresh/retry does not duplicate task, deal, quote, or call attempts.
- Preview sends no email/SMS/call and creates no tenant records.

### Call

- No call can start without verified phone and explicit versioned consent.
- Calling hours, suppression, caps, provider health, and idempotency are
  enforced server-side.
- Repeated clicks yield one attempt.
- Accepted/ringing is not reported as connected.
- Unknown provider delivery stops in attention-required; it never redials.
- Opt-out path is durable.
- A controlled live test is performed only with owner authorisation and proves
  provider correlation, audio, terminal result, lead analytics, and task.

### Quality

- Azerbaijani copy is reviewed; `az/en/ru` message parity passes when messages
  change.
- Keyboard, screen-reader announcements, focus movement, reduced motion, and
  touch targets are verified.
- Targeted unit/API/component tests pass.
- `npx tsc --noEmit`, relevant lint, `npm run i18n:check`, Prisma validation and
  generation (when schema changes), migration/RLS checks, and a production
  build run in CI or the approved heavy worker.
- Browser evidence covers request → issue → OTP → start → guided journey →
  completion, plus revoke/reissue/second-browser/error paths.

## 14. Current verification and deployment truth

This handoff itself changes documentation only. No implementation tests or
build were run for a documentation-only commit beyond `git diff --check`.

Important routing discrepancy for the next agent:

- the current checkout remote is
  `https://github.com/rashadoni/leaddrive-v2.git`;
- host-level instructions still name `rashadrahimov/leaddrive-v2` in places;
- `clients/registry.json` currently identifies the primary public host as
  `13.140.132.245` / `app.leaddrivecrm.org`;
- current `main` at `df65ee2bb` removed `.github/workflows/deploy.yml` in
  `b594797fb`, while older host documentation describes a GitHub Actions release
  route.

Therefore a future Cloud task may push its **feature branch** and open a draft
PR, but must not claim or perform a production deployment until it reconciles
the current repository deployment documentation, workflow availability,
registry, remote owner, and the active task's explicit deploy authorisation.
Never deploy directly from this feature worktree.

The Contabo host used to prepare this handoff is development/inspection, not
LeadDrive production. Heavy builds and full browser E2E do not belong there.

## 15. Cloud completion report format

At every checkpoint report:

- outcome and user-visible behaviour;
- exact changed paths;
- schema/RLS/external-effect implications;
- tests actually run and their results;
- checks marked `NOT RUN` with the reason;
- remaining blockers requiring owner credentials or authorisation;
- commit SHA and draft PR URL when pushed;
- screenshots/video evidence for visible work;
- updated coverage percentage for each selected area.

Never say “Salesforce-like demo complete” merely because a new player page
renders. Completion means the private, selected, self-lead journey works and is
proven against the acceptance criteria above.
