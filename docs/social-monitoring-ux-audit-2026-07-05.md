# Social Monitoring UX Audit

Date: 2026-07-05  
Route audited: `https://app.leaddrivecrm.org/social-monitoring`  
Scope: live production UI, current code in `src/app/(dashboard)/social-monitoring/page.tsx`, `src/components/social/monitoring-source-watchlist.tsx`, and Social Monitoring locale copy.

## Verdict

The current Social Monitoring UI is not user-friendly enough for operators or tenant admins. It works as an accumulated implementation surface, but not as a product workflow. The page mixes provider setup, monitoring sources, connected owned accounts, analytics, WhatsApp group settings, AI policy, delivery safety, filters, and mention actions into one long screen.

This should be treated as a UX architecture redesign, not a visual polish pass.

## Evidence

- Live production loaded successfully after the 2026-07-05 deploy fix; no `Internal Server Error` remained after reload.
- Live main content container height was about 630px with about 3184px of scrollable content.
- The top viewport contained: AI search, page title, tour/help buttons, AI settings link, refresh, inbox wiring, import conversations, Twitter connect, add account, TikTok setup, and onboarding/help content before the user reaches sources or mentions.
- A live DOM scan found 217 visible controls across the current screen state.
- The page component owns many unrelated local states: accounts, mentions, seven filters, account creation, WhatsApp group settings, AI reply settings, inline reply, AI drafts, lead conversion, evidence modal, source keywords, polling, inbox wiring, import, and more.
- Mention cards expose too many same-level actions: reviewed, reply/open-original/manual-replied, AI, escalate, ignore, ticket, lead, task, and sentiment buttons.
- Watchlist and account concepts are visually adjacent but semantically different: external pages/search sources vs owned connected accounts/reply identities.

## Health Score

| Dimension | Score | Key finding |
| --- | ---: | --- |
| Information architecture | 1/4 | One page contains several separate products: setup, collectors, analytics, inbox triage, reply workflow, and settings. |
| Task clarity | 1/4 | The first screen does not answer "what should I do next?" or separate "our page" from "external monitored source". |
| Interaction design | 2/4 | Many actions exist, but primary/secondary/destructive actions are not structured. |
| Accessibility | 2/4 | Several small icon/raw buttons rely on `title` or visual affordance; destructive actions need clearer labels and confirmation/undo. |
| Responsive resilience | 2/4 | Header actions wrap and can feel crowded; long Azerbaijani/Russian labels make the issue worse. |
| Operational trust | 3/4 | Safety/dry-run messaging exists, but it is overexposed and competes with the workflow. |

Total: 11/24. Rating: significant redesign needed.

## P0/P1 Findings

### P0: No Primary Workflow

Users should understand the operational loop in seconds:

1. Connect owned pages/profiles that can identify the tenant.
2. Add external sources to monitor.
3. Review new mentions.
4. Reply, escalate, or convert.
5. Track coverage and failures.

The current page presents all of these at once. The result is cognitive overload.

Recommendation: split the page into persistent tabs or segmented modes:

- `Overview`: operational status, today's work, source health, urgent mentions.
- `Sources`: external pages, hashtags, keywords, search/provider/browser sources.
- `Owned Accounts`: connected Facebook/Instagram/TikTok/Twitter identities and reply capability.
- `Mentions`: focused triage queue with filters and bulk actions.
- `Reply Queue`: AI drafts, approvals, blocked/live-send states.
- `Settings`: WhatsApp group, delivery matrix, AI policy, provider constraints.

### P0: "Our Page" and "External Page" Are Mixed

The user explicitly needs to distinguish:

- Our owned pages/profiles: `nokaut.az`, `kishiklubu.az`, etc. These determine reply identity and available official APIs.
- External pages/profiles/hashtags/search URLs: monitored sources where the system may only read/triage and often cannot reply directly.

Today, both concepts appear as adjacent chips/cards, and the add flow hides the difference inside a modal.

Recommendation: make this distinction the first add-source decision:

- `Connect Our Page`: OAuth/account identity, permissions, reply capability, inbox wiring.
- `Monitor External Source`: URL/hashtag/keyword, collection method, coverage tier, manual reply policy.

### P1: Header Action Overload

The current header has several unrelated actions at the same visual priority:

- AI settings
- Refresh all
- Add to Inbox
- Import conversations
- Connect Twitter
- Add account
- Tour/help

Recommendation: keep only one primary action in the header:

- Primary: `Add Source`
- Secondary menu: `Refresh`, `Import Conversations`, `Connect Channel`
- Help/tour: move to a small icon/menu, not beside the title.

### P1: Setup Content Blocks Hide the Work

TikTok setup, AI automation hint, AI reply settings, and external-send matrix appear before the main operational work. These are important, but they should not dominate the default screen.

Recommendation:

- Show compact status chips in `Overview`.
- Move details into `Settings` or expandable "Setup health" panels.
- Only surface a blocking setup banner when it prevents the current user task.

### P1: Mention Cards Have Too Many Equal Actions

Every mention card should guide the operator toward one next action. Current cards expose many options at once.

Recommendation:

- Primary action based on policy: `Reply`, `Open Original`, `Review AI Draft`, or `Escalate`.
- Secondary actions under an overflow menu: ignore, convert to task, evidence, sentiment correction.
- Conversion group as a compact split button: `Create Lead`, `Create Ticket`, `Create Task`.
- Destructive/terminal actions require undo or confirmation.

### P1: Filters Are Too Dense

The filter bar has platform, sentiment, status, source type, AI status, WhatsApp status, phone lead, triage, and TikTok event filters. This is powerful but not approachable.

Recommendation:

- Default filter chips: `Needs Action`, `High Risk`, `Leads`, `Complaints`, `Unanswered`.
- Advanced filter drawer for platform/source/AI/WhatsApp/phone details.
- Persist filters in the URL so users can share and return to the same queue state.

## Proposed Redesign

### First View

The first viewport should be an operator console:

- Page title: `Social Monitoring`
- Status strip: connected owned pages, active external sources, new mentions, blocked setup.
- Primary action: `Add Source`
- Secondary menu: refresh/import/connect actions.
- Work queue tabs: `Needs Action`, `New`, `High Risk`, `Leads`, `All`.
- Below: mention queue preview, not setup documentation.

### Add Source Flow

Use a guided sheet instead of a generic modal:

1. Choose intent: `Connect Our Page` or `Monitor External Source`.
2. Choose platform.
3. Enter URL/handle/hashtag/keyword.
4. Show capability preview:
   - collection mode
   - trust tier
   - reply policy
   - required setup
5. Save and immediately show the source row with next action.

### Source Management

Move sources into a dedicated `Sources` tab with two lanes:

- `Owned identities`: pages/profiles connected through OAuth, used for reply identity and inbox import.
- `Monitored sources`: external profiles/pages/hashtags/keywords/search/provider/browser sources.

Each row should answer:

- What is being watched?
- How is it collected?
- Is it healthy?
- Can we reply from here?
- What is the next required setup action?

### Mention Queue

The main queue should be the center of the module:

- Left: filters and saved views.
- Center: mention list.
- Right drawer: selected mention detail, evidence, AI draft, reply policy, CRM conversion.

This avoids expanding every card into a mini application.

## Implementation Plan

### Slice 1: UX Shell and Navigation

- Add local tabs/segmented navigation for `Overview`, `Sources`, `Mentions`, `Reply Queue`, and `Settings`.
- Move existing sections into the correct tab without changing API behavior.
- Keep route path `/social-monitoring`.
- Browser test: desktop and narrow viewport must have no header overlap and no hidden primary action.

### Slice 2: Header Cleanup

- Replace the current action row with one primary `Add Source` button and an overflow menu for refresh/import/connect actions.
- Move tour/help into a compact help menu.
- Code test: no logic changes except event wiring.
- UI test: Azerbaijani/Russian labels must not overflow.

### Slice 3: Add Source Guided Flow

- Replace generic add-source modal with a two-path guided sheet.
- Explicitly separate owned identity connection from external monitoring.
- Show capability preview before save.
- Code tests: existing monitoring-source API tests must remain passing.
- UI tests: create source for Instagram external profile, owned Instagram account, hashtag, and search URL in browser harness.

### Slice 4: Mention Queue Redesign

- Convert cards into queue rows with a detail drawer.
- Promote one primary action based on reply policy.
- Move evidence, sentiment correction, conversions, and ignore into grouped secondary controls.
- Add URL-backed filters for saved queue states.
- Code tests: mention action route tests and filter route tests.
- UI tests: reply allowed, draft-only, high-risk, lead intent, and empty states.

### Slice 5: Settings Consolidation

- Move TikTok setup, AI policy, WhatsApp group, delivery matrix, and provider status into `Settings`.
- Surface only blocking warnings on `Overview`.
- Browser test: first viewport should show work status and queue, not setup documentation.

### Slice 6: Final Verification

- Run targeted unit/API tests for Social Monitoring.
- Run `npm run i18n:check`.
- Run targeted ESLint on touched UI files.
- Run browser checks on production-like auth session:
  - desktop 1470px
  - tablet width
  - mobile/narrow width
  - Azerbaijani and Russian labels
  - add-source flow
  - mention triage flow

## Do Not Do

- Do not add more cards to the existing one-page stack.
- Do not add another top-level button to the current header.
- Do not hide platform limitations; move them to the right workflow location.
- Do not enable live external sends as part of UX redesign.
- Do not merge owned reply identities and external monitored sources into one mental model.

