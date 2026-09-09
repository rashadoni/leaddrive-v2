# Help Video Audit - 2026-07-03

## Scope

Audit source: `src/content/help/video-assets.ts`.

The app currently exposes 100 help-video entries. A complete entry needs all six files:

- `<slug>.az.VOICE.mp4`
- `<slug>.az.poster.jpg`
- `<slug>.en.VOICE.mp4`
- `<slug>.en.poster.jpg`
- `<slug>.ru.VOICE.mp4`
- `<slug>.ru.poster.jpg`

## Current Coverage

Approved complete video sets: 3 / 100.

Approved asset sets:

- `ai-actions`
- `inbox-automation`
- `whatsapp-business-calls`

Blocked local/synthetic voiceover asset sets:

- None.

Missing, incomplete, or blocked assets: 97 / 100.

## Quality Findings

- `ai-actions` has been rebuilt in all three languages with browser-guided capture and approved Microsoft Azure Speech audio.
- `inbox-automation` has been rebuilt in all three languages with browser-guided capture and approved Microsoft Azure Speech audio.
- `whatsapp-business-calls` has been rebuilt in all three languages with browser-guided capture and approved Microsoft Azure Speech audio.
- The old `scripts/help-video/generate-section-training.py` generator creates slide-style training videos. That no longer matches the requested standard.
- The new standard should be: real page, visible cursor, visible click feedback, route navigation, section-specific scenario, and localized narration.

## Tooling Status

- Browser automation: available through Playwright (`playwright@1.58.2`).
- Video tooling: `ffmpeg` and `ffprobe` are installed.
- Existing Remotion project: `video/remotion-ai-actions`.
- Local TTS is prohibited for help videos. Do not use `edge-tts`, Microsoft Edge neural voices, macOS `say`, `pyttsx3`, `espeak`, `gTTS`, Coqui, or any other locally generated synthetic narration.
- Approved voiceover sources are user-provided recorded human audio or an explicitly approved external studio/provider workflow. If no approved audio source is available, mark voiceover as blocked instead of generating a local TTS fallback.
- The browser-guided generator must receive approved audio through `--audioDir <dir>` or `HELP_VIDEO_APPROVED_AUDIO_DIR`. It must fail when approved audio is missing.

## Backlog By Domain

### Core CRM

Missing: `dashboard`, `deals`, `companies`, `contacts`, `boards`, `products`, `notifications`, `projects`, `task-templates`.

Priority: high. These are primary navigation areas and should be covered first after the AI/support pilot.

### Sales

Missing: `leads`, `web-to-lead`, `lead-rules`, `quotes`, `sequences`, `forecast`, `sales-forecast-settings`, `forecast-snapshots`, `forecast-waterfall`, `forecast-velocity`, `pipelines`, `quotas`, `territories`.

Priority: high. These are customer-facing sales workflows.

### Contracts

Missing: `contracts`, `contract-lifecycle`, `contract-templates`, `intake-forms`, `contract-request`, `contract-analytics`.

Priority: high. These flows need scenario-led explanation because users can confuse request, template, approval, and analytics screens.

### Marketing

Missing: `cdp-insights`, `cdp-merge-queue`, `campaigns`, `segments`, `loyalty-builder`, `loyalty-dashboard`, `loyalty-tiers`, `loyalty-earn-rules`, `loyalty-promo-codes`, `loyalty-pos`, `email-templates`, `email-log`, `attribution-models`, `campaign-roi`, `ai-scoring`, `journeys`, `events`, `landing-pages`, `surveys`, `account-engagement`.

Priority: medium-high. A partial scenario set already exists in `video/scenarios/marketing-module.json`, but it has not been rendered as browser-guided videos.

### Support / Omni-Channel

Ready but needs quality rebuild: none.

Missing: `tickets`, `escalation`, `complaints`, `agent-desktop`, `entitlements`, `skill-routing`, `agent-calendar`, `voip`, `voip-insights`, `knowledge-base`, `sla-policies`, `channels`, `portal-users`, `settings-voip`.

Slot note: `entitlements` is registered in `src/content/help/video-assets.ts` for `/support/entitlements` and has a help article under `src/content/help/entitlements`. Its six video assets remain missing until approved human/studio voiceover is supplied.

Priority: high. These flows involve safety, routing, and customer communication.

### Finance

Missing: `invoices`, `subscriptions`, `finance`, `budgeting`, `budget-config`, `profitability`, `pricing`, `invoice-settings`, `finance-notifications`, `reports`, `report-builder`, `ai-command-center`.

Priority: medium-high. Finance videos should be scenario-first and avoid generic KPI tours.

### MTM / Route & Field

Missing: `mtm-overview`, `mtm-map`, `mtm-routes`, `mtm-visits`, `mtm-tasks`, `mtm-customers`, `mtm-photos`, `mtm-alerts`, `mtm-orders`, `mtm-skus`, `mtm-categories`, `mtm-equipment-types`, `mtm-equipment`, `mtm-repair-requests`, `mtm-agents`, `mtm-analytics`, `mtm-leaderboard`, `mtm-activity`, `mtm-reports`, `mtm-settings`.

Priority: medium. This is a large set and should be batched after the primary CRM/support/sales flows unless the user prioritizes MTM.

## Production Standard For New Videos

Each rebuilt video must include:

- scenario script in `az`, `en`, and `ru`;
- real browser page capture, not static slides;
- cursor movement to the element being discussed;
- click/hover feedback when the narration says to click or inspect;
- one concrete task outcome, not a generic page overview;
- localized title card and final recap;
- approved human/studio voiceover present in each language, or explicitly marked blocked;
- poster image per language;
- ffprobe verification for dimensions, duration, and audio stream;
- screenshot/frame check for at least one representative frame.

## Recommended Execution Order

1. Create the first high-value missing batch: `dashboard`, `deals`, `companies`, `contacts`, `tickets`, `channels`.
2. Continue by domain: sales, contracts, marketing, finance, MTM.
