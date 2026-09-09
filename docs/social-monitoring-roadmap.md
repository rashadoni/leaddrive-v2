# Social Monitoring Roadmap

> **Важно:** этот файл является историческим журналом уже выполненных этапов.
> Целевая архитектура, актуальная матрица платформ и обязательная последовательность
> следующих PR находятся в
> [`docs/social-monitoring-v2-architecture-plan.md`](./social-monitoring-v2-architecture-plan.md).

## Objective

Bring the Social Monitoring section to the client-ready flow:

- TikTok publication comments appear in Social Monitoring through the Organic API/webhook path.
- TikTok DMs stay in the unified Inbox through Chatwoot and are not promoted into the Social Monitoring feed.
- TikTok Lead Ads enter through the Business API boundary and import/dedupe CRM leads.
- TikTok leads that write a phone number in monitored comments are detected, deduplicated, and linked to a CRM lead.
- New phone leads are delivered to one configured WhatsApp group in dry-run by default.
- Positive comments can be AI-replied automatically after guardrails.
- Negative comments get an AI draft and require social media manager approval before send.
- Regeneration reasons, approval history, delivery status, and operator-visible states live in Social Monitoring.

Real external sends for WhatsApp, TikTok, or AI-generated social replies must stay in dry-run until a separate live confirmation.

## Current Evidence

- Production route checked: `https://app.leaddrivecrm.org/social-monitoring`.
- The page is accessible on production and already shows real Facebook/Instagram mentions.
- Production counts at inspection time: 56 total mentions, 53 new, 16 positive, 5 negative, 0 tickets.
- TikTok exists in the platform filter, but the TikTok filtered feed is empty.
- Connected production accounts visible in the section are Facebook/Instagram, not TikTok.
- Existing card actions: reply, ignore, convert to ticket, convert to lead, convert to task, and sentiment marking.
- Existing AI entry point points to AI automation settings; inline mention-level approval/regeneration is not present.

## Operating Rules

- Work from a clean worktree based on current `origin/main`.
- Keep slices path-scoped and commit each completed slice.
- Never stage with `git add .` or `git add -A`.
- Keep unrelated dirty files out of every commit.
- Run the narrowest meaningful verification for each slice.
- For schema changes, run Prisma validate/generate and relevant tests.
- For UI changes, verify `/social-monitoring` in browser when practical.
- Production push/deploy is allowed after successful checks, but external sends stay dry-run until live confirmation.

## Delivery Order

1. Stabilize the current Social Monitoring page and permission model.
2. Normalize TikTok/Chatwoot/native ingest into `SocialMention`.
3. Add phone lead detection, dedupe, and CRM lead linking.
4. Add WhatsApp group delivery in dry-run mode with durable status.
5. Add AI draft, approval, regeneration, send history, and guardrails.
6. Upgrade the Social Monitoring UI around the new operational states.
7. Verify with unit/API/browser coverage and production-like smoke.
8. Extend Social Monitoring into a multi-source Social Signal Monitoring engine.
9. Add Page Watchlist, Hashtag/Keyword Watchlist, source health, and coverage reporting.
10. Add official/provider/search-index/notification/browser-capture collector adapters behind explicit risk gates.
11. Add deep code-level and UI-level verification for every implementation slice before claiming completion.

## Implementation Progress

Updated: 2026-06-29.

- Done: roadmap created in a clean worktree.
- Done: Social Monitoring API gates aligned to `omnichannel`.
- Done: shared mention ingestion returns created/duplicate result and preserves workflows.
- Done: TikTok DM events from Chatwoot mirror into the omnichannel Inbox/SocialConversation path, not into public Social Monitoring comments.
- Done: Azerbaijan phone extraction and normalization for social comments.
- Done: TikTok phone mentions create or link CRM leads with duplicate handling.
- Done: new phone leads enqueue one WhatsApp group delivery as dry-run only.
- Done: AI draft storage, approval history, regeneration reasons, and dry-run send status.
- Done: Social Monitoring UI exposes AI draft generation, approve/reject, regeneration reason, and dry-run send controls.
- Done: AI cron creates Social Monitoring drafts automatically for TikTok/Facebook/Instagram/Twitter mentions; positive safe mentions are recorded as dry-run sent, negative/neutral mentions require approval, blocked topics do not get auto replies.
- Done: Social mentions store source type/provider metadata; TikTok public monitoring is comments-only, while DM replies stay in Inbox via Chatwoot.
- Done: WhatsApp group dry-run status is persisted on the SocialMention row and visible/filterable in Social Monitoring.
- Done: Social Monitoring includes a one-group WhatsApp lead destination settings card backed by the tenant WhatsApp ChannelConfig settings.
- Done: native TikTok poller no longer creates pseudo-mentions from video titles; it reports the official API limitation and leaves real comments/DMs to Chatwoot/webhook ingestion.
- Done: Social Monitoring AI panel shows previous draft versions, regenerate reasons, approval timestamp, and API filter coverage for source/AI/WhatsApp status.
- Done: production deploy and authenticated `/social-monitoring` browser smoke passed on 2026-06-29 for SHA `d5157e449f98efca5427e36b67645c3745947ee8`.
- Done: failed WhatsApp group deliveries expose the last error and can be retried manually through the same dry-run delivery adapter.
- Done: unsupported reply providers such as TikTok show an operator-visible limitation and only allow manual replied marking.
- Done: Social Monitoring phone leads are filterable by created/duplicate state and mention cards show linked lead, detected phone, and duplicate badges.
- Done: reply provider route has regression coverage for unsupported platforms and failed provider sends preserving the original mention status.
- Done: Social Monitoring shows the current AI reply mode, positive auto dry-run flag, negative approval role, and live-send-disabled status from tenant AI feature flags.
- Done: Social Monitoring includes an operator-visible TikTok setup state explaining OAuth, Chatwoot/webhook ingest, no backfill, and manual/fail-closed replies.
- Done: Social Monitoring copy now shows the external-send matrix: WhatsApp group and Social AI remain dry-run, TikTok public replies are provider-capability gated, and Inbox replies are live only when the provider is connected.
- Done: Phase 13 targeted Social Monitoring suite passed on 2026-06-29 for phone extraction, duplicate lead logic, TikTok ingest/poller, WhatsApp dry-run settings/status/retry, AI policy/drafts/settings, mentions filters, reply provider safety, enable-inbox, and viral AI.
- Done: production deploy and authenticated `/social-monitoring` browser smoke passed on 2026-06-29 for SHA `99d9cc8ef`; route loaded without login/error and the TikTok, AI needs-approval, WhatsApp failed, and phone duplicate filters switched cleanly.
- Done: live external sends were re-confirmed fail-closed on 2026-06-29: WhatsApp group delivery persists dry-run status, AI reply settings expose `sendMode: dry_run` with `liveExternalSendEnabled: false`, and AI draft sending only accepts `send_dry_run`.
- Still pending: live-provider TikTok reply integration after separate live confirmation.
- External sends status: WhatsApp group sends and AI social replies remain dry-run until separate live confirmation.
- Done: Phase 15 Social Signal Monitoring schema added on 2026-07-05 with `MonitoringSource`, `CollectorRun`, `MentionEvidence`, `MentionCluster`, `ReplyPolicy`, optional `SocialMention.clusterId`, tenant RLS policies, and conservative fail-closed reply-policy defaults.
- Done: Phase 15 verification used Prisma validate/generate plus a focused temporary-Postgres migration sanity check for the new migration. Full empty-database `prisma migrate deploy` remains blocked by an older unrelated migration `20260406200000_phase4_enterprise_features` referencing missing `ai_interaction_logs`.
- Done: Phase 16 Monitoring Sources API added on 2026-07-05 at `/api/v1/social/monitoring-sources` and `/api/v1/social/monitoring-sources/[id]` with tenant-scoped CRUD, URL/handle/query normalization, automatic collection-mode/risk classification, duplicate prevention, health summaries, and explicit unsafe live-send flag rejection.
- Done: Phase 16 verification used focused Vitest coverage for list/create/update/delete/validation/duplicates/RBAC registration, targeted ESLint on new files, `git diff --check`, and full typecheck with increased heap. Typecheck has no new errors; it still reports unrelated pre-existing errors in `src/app/(dashboard)/campaigns/[id]/page.tsx`.
- Done: Phase 17 Page Watchlist UI added on 2026-07-05 inside `/social-monitoring` with localized AZ/EN/RU watchlist copy, source stats, search, add dialog, pause/resume/delete controls, health/risk/mode badges, and disabled run-now until collector/scheduler support lands. UI copy explicitly states no live replies, no proxy/captcha bypass, and no anti-bot workaround.
- Done: Phase 17 verification used targeted ESLint on the new component and page, translation parity check, focused Monitoring Sources API tests, `git diff --check`, and browser smoke through a temporary public harness that rendered the real watchlist component and opened the add-source dialog. Local `/social-monitoring` itself is auth-gated and redirected to `/login` without a local session/DB; no auth bypass was added.
- Done: Phase 18 Hashtag/Keyword Watchlist added on 2026-07-05 with shared query expansion for base terms, hashtag variants, AZ ASCII variants, spacing/compact variants, RU/EN/AZ keyword detection, aliases from source settings, per-query priority, and per-query cadence. Expanded queries are stored in `MonitoringSource.settings.expandedQueries` with `queryExpansion.strategy=heuristic_v1`, and the add-source dialog shows the same preview before save.
- Done: Phase 18 verification used focused unit tests for query expansion/de-dup/language variants/cadence, Monitoring Sources API tests for persisted expansion metadata, targeted ESLint, translation parity, `git diff --check`, and browser smoke of the expanded-query preview through a temporary public harness. The harness was deleted before commit.
- Done: Phase 19 Collector Orchestrator added on 2026-07-05 with a collector adapter contract (`canRun`, `run`, `normalize`, `dedupeKey`, `evidence`), adaptive due-source selection, expanded-query cadence awareness, backoff for failed/partial and repeated empty runs, durable `CollectorRun` status transitions, manual run-now rate limiting, and cron execution behind `CRON_SECRET` plus RLS bypass.
- Done: Phase 19 UI/API integration added run-now support to Page Watchlist. The button calls `/api/v1/social/monitoring-sources/[id]/run`, records a safe skipped run when no adapter is configured, reloads source health, and keeps external sends disabled.
- Done: Phase 19 verification used focused Vitest coverage for scheduler/backoff/run transitions/manual rate limiting/API 404/429/success/cron auth, existing Monitoring Sources API and query-expansion regression tests, targeted ESLint, translation parity, `git diff --check`, and browser smoke through a temporary public harness confirming run-now is enabled and shows the safe `collector_not_configured` warning. The harness was deleted before commit.
- Note: Phase 19 full `npm run typecheck` was attempted with increased heap but produced no diagnostics and hung for about 90 seconds; it was stopped to avoid leaving a stale process. Earlier full typecheck in this roadmap still showed only unrelated pre-existing campaign page errors.
- Done: Phase 20 Official Collectors added on 2026-07-05 inside the collector orchestrator. Facebook owned-page sources now read `/me/posts`, post comments, and `/me/tagged`; Instagram owned sources read media comments and tagged media; Instagram hashtag sources use `ig_hashtag_search` plus `recent_media` when an official account is connected. All official findings route through shared `SocialMention` ingestion and create `MentionEvidence` with trust tier `T1`.
- Done: Phase 20 TikTok official collector remains limitation-only: it does not create pseudo-mentions from video titles and returns `official_tiktok_comments_require_webhook`, keeping real TikTok comments on Organic API webhook/provider ingest.
- Done: Phase 20 Watchlist UI now shows official collector limitations/errors in the source row and treats run-now `failed`/`partial` results as error/warning toasts instead of success.
- Done: Phase 20 verification used mocked Graph API unit tests for Facebook comments/tagged posts, Meta permission failures, Instagram hashtag media, evidence creation, and TikTok limitation; Phase 19 orchestrator/API regressions; targeted ESLint; translation parity; and browser smoke through a temporary public harness confirming visible TikTok limitation copy and run-now skipped warning. The harness was deleted before commit.
- Done: Phase 21 Provider Adapter added on 2026-07-05 with a vendor-neutral provider API adapter, approved-source gate, HTTPS-only endpoint validation, private/local host blocking, `SOCIAL_PROVIDER_ALLOWED_HOSTS` allowlist, optional encrypted/provider-env token support, provider payload normalization into `SocialMention`, and `MentionEvidence` trust tier `T2`.
- Done: Phase 21 provider sources remain read-only and fail closed: unapproved, missing, invalid, non-HTTPS, non-allowlisted, rate-limited, fetch-failed, and malformed payload states are recorded as collector errors and visible in Page Watchlist.
- Done: Phase 21b Provider Reply Action added on 2026-07-05 with explicit `settings.provider.reply.approved` metadata propagation, per-mention provider `replyCapability`, separate `SOCIAL_REPLY_PROVIDER_ALLOWED_HOSTS` host allowlist, HTTPS/private-host gates, optional provider reply token env support, and a generic fail-closed provider reply sender. Provider replies remain disabled unless the tenant live flag, `social_live_reply` feature, approved capability, target id, and reply endpoint allowlist all pass.
- Done: Phase 21c Provider Source Setup added on 2026-07-05 so admins can create or reconfigure `provider_api` monitoring sources from Page Watchlist without code changes. The API now sanitizes provider read/reply settings, stores only token env names, redacts encrypted token values in responses, returns a `providerSetup` summary, and keeps nested live-send/auto-reply flags blocked.
- Done: Phase 21 verification used provider adapter unit tests for safe gates, allowlisted fetch, credential handling, normalization, evidence creation, and malformed payloads; orchestrator/official/API regressions; targeted ESLint; translation parity; and browser smoke through a temporary public harness confirming visible Provider API allowlist limitation copy. The harness was deleted before commit.
- Done: Phase 22 Search-Index Collector added on 2026-07-05 with an approved-source gate, HTTPS-only endpoint validation, private/local host blocking, `SOCIAL_SEARCH_INDEX_ALLOWED_HOSTS` allowlist, query/domain/limit construction, strict 6-hour minimum cadence for new `search_index` sources, snippet/permalink-only normalization into `SocialMention`, `MentionEvidence` trust tier `T3`, and explicit `partialCoverage` metadata.
- Done: Phase 22 search-index sources remain manual-action/draft-only by policy surface: collector output is read/triage/evidence only and Page Watchlist exposes cadence, allowlist, rate-limit, fetch, and payload errors.
- Done: Phase 22 verification used search-index adapter unit tests for cadence/allowlist gates, query building, snippet normalization, evidence creation, and malformed payloads; provider/official/orchestrator/API regressions; targeted ESLint; translation parity; and browser smoke through a temporary public harness confirming visible Search index cadence limitation copy. The harness was deleted before commit.
- Done: Phase 23 Notification Inbox Collector added on 2026-07-05 with an approved-source gate, HTTPS-only endpoint validation, private/local host blocking, `SOCIAL_NOTIFICATION_INBOX_ALLOWED_HOSTS` allowlist, generic mailbox endpoint support, social notification email parsing, low-confidence `reviewRequired` metadata, manual-only reply policy metadata, and `MentionEvidence` trust tier `T4`.
- Done: Phase 23 verification used parser/collector unit tests for platform detection, false-positive email handling, allowlist/HTTPS gates, malformed payloads, notification ingestion, manual-only metadata, and evidence creation; orchestrator regressions; targeted ESLint; translation parity; and browser smoke through a temporary public harness confirming visible Notification inbox host limitation copy. The harness found and fixed a missing `notification_inbox` watchlist source-type label before commit.
- Done: Phase 24 Browser Capture Mode added on 2026-07-05 as an explicit experimental/internal `browser_capture` collector. It requires `SOCIAL_BROWSER_CAPTURE_ENABLED=1`, requires operator-approved source settings, only consumes already-visible operator-approved capture records, never automates hidden browsing or bypasses captcha/proxy/anti-bot controls, stores permalink/snippet/screenshot evidence with trust tier `T5`, and marks captured mentions with manual-only/no-automation metadata.
- Done: Phase 24 verification used focused browser-capture adapter unit tests for feature-flag gating, operator approval gating, approved-visible capture ingestion, ignored unapproved/malformed captures, duplicate evidence suppression, manual-only metadata, and T5 evidence; orchestrator regressions; targeted ESLint; translation parity; and browser smoke through a temporary public harness confirming visible Browser capture mode, high-risk label, feature-flag warning, and run-now skipped toast. The harness was deleted before commit.
- Done: Phase 25 Normalization, Dedupe, and Clustering added on 2026-07-05 in the shared `ingestMentionWithResult` spine. It now keeps platform/externalId as the primary idempotency key, falls back to normalized permalink matching across provider/search/browser duplicates, falls back again to same-author/same-day text fingerprints when no URL exists, and attaches every created or matched mention to a `MentionCluster` keyed by repeated text/day or normalized URL.
- Done: Phase 25 Social Monitoring API/UI now returns `MentionCluster` summaries and recent `MentionEvidence` records with source labels. Mention cards show duplicate/cluster badges and an evidence dialog with trust tier, confidence, source mode, snippet, permalink, and screenshot link.
- Done: Phase 25 verification used focused ingestion tests for URL normalization, cross-source URL duplicates, text/author/date duplicates, cluster upsert, and workflow side effects only on first creation; mentions API tests for cluster/evidence include shape; collector adapter regressions; targeted ESLint; translation parity; and browser smoke through a temporary public harness confirming duplicate badge, evidence count, source label, and evidence dialog details. The harness was deleted before commit.
- Done: Phase 26 AI Triage and Action Queue added on 2026-07-05 with deterministic local scoring for relevance, language, lead intent, complaints, PR risk, urgency, forbidden topics, recommended actions, approval-required state, and hidden-noise collapse metadata under `SocialMention.sourceMetadata.socialTriage`.
- Done: Phase 26 routing is fail-closed: high-risk/actionable mentions create `AiShadowAction` queue items and `AiAlert` records with duplicate guards, but triage never posts externally. Existing AI draft generation remains in the dry-run/approval guarded path, and Russian complaint detection no longer relies on ASCII word boundaries.
- Done: Phase 26 API/UI now supports triage filters for high-risk, lead intent, complaints, needs-action, and hidden noise. The mentions API hides `hiddenNoise` items by default and exposes them only with `triage=noise` or `showNoise=1`. Mention cards show triage risk, lead, complaint, approval, action, and score badges.
- Done: Phase 26 verification used focused scoring/queue/alert unit tests, triage route tests, mentions API filter tests, AI draft guardrail regressions, targeted ESLint, translation parity, and browser smoke through a temporary public harness confirming default noise hiding plus high-risk, lead, complaint, needs-action, and noise filters. The harness was deleted before commit.
- Done: Phase 27 Reply Policy and Action Workflow added on 2026-07-05 with a shared `ReplyPolicy` decision layer before live social replies. Official owned Twitter/Facebook/Instagram replies require both `SOCIAL_LIVE_REPLY_ENABLED=1` and tenant feature `social_live_reply`; provider API sources are draft/open-original by default and can reply only through an explicit approved provider action; search/browser/manual sources remain draft/open-original only; unsupported platforms, missing connected accounts, manual-only captures, and approval-required/forbidden topics are blocked before token decrypt or provider fetch.
- Done: Phase 27 action workflow now includes explicit escalation from Social Monitoring. Escalation creates a task, writes an AI alert, marks the mention reviewed, and audit-logs the action. Reply route now audit-logs blocked, failed, and sent attempts while preserving mention status on provider failure.
- Done: Phase 27 UI now hides live reply controls unless policy can allow live reply, shows open-original fallback and draft-only policy copy, keeps manual-replied marking separate, and exposes an Escalate action alongside AI/ignore/create actions.
- Done: Phase 27 verification used policy matrix tests, reply route blocked-send/provider-failure/audit tests, escalation route tests, AI draft guardrail regressions, targeted ESLint, translation parity, and browser smoke through a temporary public harness confirming draft-only copy, open-original fallback, hidden live Reply, and Escalate POST. The harness was deleted before commit.
- Done: Phase 28 Coverage Dashboard and Alerts added on 2026-07-05. Monitoring sources API now returns `coverage` with active/health counts, latest run, last-24h found/new/duplicate/ignored/failed/partial totals, trust-tier distribution from `MentionEvidence`, partial-coverage flag, and recent social alerts.
- Done: Phase 28 alert rules added through `coverage-alerts`: source failures, negative spikes, VIP/high-reach authors, lead intent, competitor mentions, and repeated complaints. Alerts are written as deduped `AiAlert` rows with 24h dedupe keys.
- Done: Phase 28 UI now shows a coverage dashboard inside Page & Search Watchlist with health/run metrics, trust tiers, recent alerts, and explicit partial-coverage copy for provider/search-index/notification/browser-capture sources.
- Done: Phase 28 verification used monitoring-sources API coverage tests, alert-rule unit tests, coverage-alerts API tests, targeted ESLint, translation parity, and browser smoke through a temporary public harness confirming coverage metrics, trust tiers, partial-coverage copy, and alert list. The harness was deleted before commit.
- Done: Phase 29 Deep Verification and Release Gate completed on 2026-07-05 for the Phase 24-28 Social Monitoring slices. Combined Vitest covered 20 files / 74 tests across collectors, ingestion/dedupe/clustering, AI triage, reply policy/workflow, monitoring sources, source-run cron, coverage alerts, and relevant APIs.
- Done: Phase 29 release gate also ran broad targeted ESLint across touched production/test files, `npm run i18n:check`, and `git diff --check`.
- Note: full `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --pretty false --incremental false` was attempted again for Phase 29. It produced no diagnostics for about 60 seconds and was stopped with Ctrl-C, matching the earlier hang behavior; do not count full typecheck as passed.
- Done: Phase 30 Typecheck Closure completed on 2026-07-05. The stale local `.next/dev/types` entries from temporary smoke routes were removed from the worktree, the new Social Monitoring type gaps were fixed, and full `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit --pretty false --incremental false` passed cleanly twice. Focused Social Monitoring tests and targeted ESLint also passed for the touched files.
- Done: Phase 31 external page/profile source activation fix added on 2026-07-05. New external page/profile watchlist URL entries now default to `search_index` setup instead of inert `manual`, source domain/query are derived generically from the submitted URL, global env-driven search-index configuration can serve every new source without per-source hardcoding, owned sources can be linked to a connected `SocialAccount` reply identity through the UI, and a data migration backfills existing external manual page/profile sources while keeping live replies fail-closed.
- Done: Phase 32 Source Readiness Diagnostics added on 2026-07-05. Monitoring source list/detail APIs now return machine-readable collection/reply/live readiness based on source mode, connected accounts, provider/search-index/notification/browser gates, token env presence, and the tenant live-reply gate. Page Watchlist renders compact Collection/Reply/Live readiness badges plus the next setup action so operators can see why an added source is not fully operational.
- Phase 32 verification: focused readiness unit tests, monitoring-sources API tests, provider/search-index/orchestrator regressions, targeted ESLint, translation parity, full `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`, and `git diff --check` passed. Local browser smoke in the clean temp worktree was blocked by missing `AUTH_SECRET` and `DATABASE_URL`; after production deploy `8e6298b8c6d3514b0a64ac344daaacd170692a04`, `/api/v1/ping` returned ok and authenticated Chrome smoke confirmed `/social-monitoring` -> `Mənbələr` shows the readiness badges (`Hazırlıq`, `Toplama`, `Cavab`, `Live`, `Növbəti`) without visible button overlap.
- Done: Phase 33 Monitoring Scenario Builder added on 2026-07-06. `/social-monitoring` now opens with a Scenario tab where admins define what to search, selected platforms, hashtag fallback targets, AI trigger conditions, the desired action, and the owned reply identity. Scenarios are stored in a tenant `ChannelConfig` row instead of a migration-backed model, and `liveSendAllowed` is normalized to `false` on every create/read/update path.
- Phase 33 verification: focused scenario API/lib tests, existing monitoring settings regression test, targeted ESLint, translation parity, Prisma validate with dummy `DATABASE_URL`, and `git diff --check` passed. Local authenticated UI smoke was blocked by localhost auth redirect and the local env database missing unrelated MTM/finance tables; Next build and full typecheck produced no scenario diagnostics but did not complete within local limits, so neither is counted as passed.
- Done: Phase 34 Scenario Pipeline Routing added on 2026-07-06. Saved scenarios now materialize managed `MonitoringSource` records for topics, keywords, hashtags, handles, and URLs without per-source hardcoding; existing duplicate sources are linked through `settings.scenarioLinks` rather than overwritten. Incoming mentions are enriched with `sourceMetadata.socialScenario` when they match scenario targets, and AI triage uses those matches to prevent noise hiding, require approval, create alerts, and route `create_lead`, `draft_reply`, and `escalate` recommendations.
- Done: Phase 34 keeps public replies fail-closed: scenario-managed sources force `liveExternalSendEnabled: false` and `autoReplyEnabled: false`, scenario match metadata stores `liveSendAllowed: false`, and triage creates queue/alert metadata only. No scenario path sends a public reply directly.
- Phase 34 verification: focused Vitest coverage passed for scenario matching/API source sync/ingest enrichment/triage routing (`4` files, `22` tests), targeted ESLint passed for touched production/test files, and `git diff --check` passed. Full `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` was attempted twice during the slice and stopped after repeated no-output hangs with no diagnostics; it is not counted as passed.
- Still pending after Phase 34: scenario actions do not yet create a dedicated AI draft immediately; they mark triage/recommended action and rely on the existing guarded draft cron. Production still needs configured search-index/provider credentials for external public search sources to collect real mentions.

## Social Signal Monitoring Extension

Updated: 2026-07-05.

### Product Goal

Build a multi-source monitoring engine that finds important public social signals without requiring an operator to scroll feeds all day. The system should monitor configured pages, profiles, hashtags, keywords, competitors, influencers, and campaign URLs; normalize all useful findings into `SocialMention`; use AI to rank and classify them; and route only actionable items to operators.

### Non-Goals and Safety Boundaries

- Do not build the product around hidden anti-bot evasion, captcha bypass, fingerprint spoofing, proxy rotation, or covert account automation.
- Do not promise complete coverage of all Instagram, Facebook, or TikTok content.
- Do not auto-publish public replies for risky sources such as search-index, browser-capture, or provider-only findings.
- Do not enable live public reply sends without an explicit tenant-level live confirmation and a platform/provider path that supports the action.
- Keep external sends fail-closed by default: AI public replies and WhatsApp group delivery remain dry-run unless separately confirmed.

### Source Trust Tiers

| Tier | Collection mode | Examples | Default action policy |
| --- | --- | --- | --- |
| T1 | `official_api` | Owned Facebook/Instagram comments, Instagram mentions, approved Instagram hashtag search | Live reply only where the API supports it and tenant live-send is enabled; otherwise draft/approval |
| T2 | `provider_api` | Brandwatch, Talkwalker, Sprinklr, approved TikTok/listening provider | Read/triage by default; reply only through an explicit supported provider action |
| T3 | `search_index` | Google/Bing indexed public URLs for hashtags, names, products, competitors | Read/triage/evidence only; AI draft plus open-link human action |
| T4 | `notification_inbox` | Platform email notifications, social alert mailbox, forwarded mention notifications | Read/triage/evidence; reply through original channel only after operator approval |
| T5 | `browser_capture` | Supervised operator/browser-captured visible feed results | Experimental/internal; no hidden evasion; AI draft plus manual action only |
| T6 | `manual` | Operator-saved URL, screenshot, copied post/comment | Manual evidence; AI draft plus manual action |

### Data Model Additions

1. `MonitoringSource`
   - Fields: `organizationId`, `platform`, `sourceType`, `url`, `handle`, `query`, `ownership`, `collectionMode`, `cadenceMinutes`, `keywords`, `riskLevel`, `status`, `lastCheckedAt`, `lastSuccessfulAt`, `lastError`, `settings`, `createdBy`, `createdAt`, `updatedAt`.
   - `sourceType` values: `profile`, `page`, `hashtag`, `keyword`, `search_url`, `competitor`, `influencer`, `campaign`, `notification_inbox`, `manual`.
   - `ownership` values: `owned`, `external`, `unknown`.
   - `collectionMode` values: `official_api`, `provider_api`, `search_index`, `notification_inbox`, `browser_capture`, `manual`.

2. `CollectorRun`
   - Fields: `organizationId`, `sourceId`, `startedAt`, `finishedAt`, `status`, `foundCount`, `newCount`, `duplicateCount`, `ignoredCount`, `error`, `rawStats`.
   - Used for source health, debugging, and operator-visible coverage history.

3. `MentionEvidence`
   - Fields: `organizationId`, `mentionId`, `sourceId`, `permalink`, `screenshotUrl`, `rawSnippet`, `rawPayload`, `capturedAt`, `confidence`, `sourceTrustTier`.
   - Required so every non-official or partial source can explain where a mention came from.

4. `MentionCluster`
   - Fields: `organizationId`, `clusterKey`, `primaryMentionId`, `topic`, `sentiment`, `riskLevel`, `mentionCount`, `firstSeenAt`, `lastSeenAt`.
   - Groups duplicates, reposts, repeated complaints, and viral clusters into one operator task.

5. `ReplyPolicy`
   - Fields: `organizationId`, `platform`, `collectionMode`, `sourceType`, `allowAiDraft`, `allowAutoReply`, `approvalRequired`, `liveSendAllowed`, `blockedReasons`, `updatedBy`.
   - Enforces source-aware reply behavior before any send path is reached.

### Phase 14: Social Signal Baseline

197. Re-read current Social Monitoring implementation before editing: `SocialAccount`, `SocialMention`, `SocialMentionAiDraft`, existing pollers, webhooks, AI draft service, and reply provider route.
198. Record exact current live/dry-run state in this roadmap before code changes.
199. Confirm every new source mode maps back into `SocialMention` instead of creating a second feed.
200. Confirm no new collector can trigger live external sends.
201. Add a short architecture note explaining source tiers and reply policy boundaries.
202. Verification: `git diff --check`; if architecture notes touch links or tables, visually inspect rendered markdown where practical.
203. Commit the baseline documentation slice with explicit path staging.

### Phase 15: Schema for Monitoring Sources

204. Add Prisma models for `MonitoringSource`, `CollectorRun`, `MentionEvidence`, `MentionCluster`, and `ReplyPolicy`.
205. Add unique constraints that prevent duplicate active sources for the same org/platform/sourceType/query or URL.
206. Add indexes for source health, scheduled polling, mention evidence lookup, and cluster dashboards.
207. Keep existing `SocialAccount` semantics for connected accounts; do not overload it with external watched pages.
208. Add migration and regenerate Prisma client.
209. Code tests: Prisma validate/generate, migration sanity, model-level unit tests where practical.
210. UI tests: not required for schema-only slice; record as not applicable.
211. Commit the schema slice.

### Phase 16: Page Watchlist APIs

212. Add CRUD APIs for monitored pages/profiles/search URLs.
213. Validate platform, URL shape, source type, cadence, and keywords.
214. Auto-classify source risk and default collection mode based on platform and ownership.
215. Prevent unsafe live-send flags from being set through source creation.
216. Return source health summary with every list response.
217. Code tests: create/update/delete/list, validation failures, duplicate prevention, permission gates, tenant isolation.
218. UI tests: API-only slice unless a UI is touched.
219. Commit the API slice.

### Phase 17: Page Watchlist UI

220. Add a "Monitoring sources" or "Page Watchlist" section inside Social Monitoring.
221. Support adding Instagram/Facebook/TikTok profile URLs, Facebook Page URLs, hashtag URLs, search URLs, competitor pages, influencer pages, and campaign URLs.
222. Show platform, source type, collection mode, risk level, cadence, last checked time, last success, last error, new mention count, and enabled/disabled state.
223. Add source health badges: `healthy`, `limited`, `blocked`, `needs setup`, `paused`, `dry-run only`.
224. Add edit, pause/resume, run now, and delete actions.
225. Keep UI dense and operational; avoid decorative card-heavy layouts.
226. Code tests: API interaction tests or component tests where available.
227. UI tests: browser-verify source creation, edit, pause/resume, run-now disabled/enabled states, and narrow viewport layout.
228. Commit the Page Watchlist UI slice.

### Phase 18: Hashtag and Keyword Watchlist

229. Add first-class source type for hashtags and keywords.
230. Add query expansion for brand variants, spelling mistakes, AZ/RU/EN forms, product names, campaign names, executive/person names, and competitor aliases.
231. Store expanded queries with explainable metadata so operators can see why a term is monitored.
232. Add per-query priority and cadence adjustment.
233. Code tests: query expansion, de-duplication, language variants, validation.
234. UI tests: browser-verify add/edit/remove keyword and expanded-query preview.
235. Commit the watchlist slice.

### Phase 19: Collector Orchestrator

236. Add a collector interface with `canRun`, `run`, `normalize`, `dedupeKey`, and `evidence` contracts.
237. Add adaptive scheduler that chooses due `MonitoringSource` rows by cadence, priority, source health, and backoff.
238. Record one `CollectorRun` per attempt, including partial failures.
239. Add manual `run now` endpoint with rate limiting.
240. Add backoff for rate-limit, auth failure, source blocked, and repeated empty runs.
241. Code tests: scheduler selection, backoff, run status transitions, partial failure handling, tenant isolation.
242. UI tests: browser-verify source run status changes and error rendering when the UI is touched.
243. Commit the orchestrator slice.

### Phase 20: Official Collectors

244. Add or extend official Meta collector for owned Facebook/Instagram comments and mentions.
245. Add official Instagram hashtag collector where the connected account and permissions support it.
246. Preserve platform limitations in `MonitoringSource.status` and `CollectorRun.error`.
247. Keep TikTok official collector limited to approved/currently supported surfaces; do not create pseudo-mentions from video titles.
248. Code tests: mocked Graph/TikTok responses, pagination, permission error, rate limit, dedupe, evidence creation.
249. UI tests: browser-verify official source health, limitation copy, and newly ingested mention display.
250. Commit the official collectors slice.

### Phase 21: Provider Adapter

251. Add provider abstraction for external listening services without hard-coding one vendor into the domain model.
252. Support provider credentials in encrypted settings or ChannelConnection where appropriate.
253. Normalize provider results into `SocialMention` plus `MentionEvidence`.
254. Track provider coverage, account limits, and last sync status.
255. Code tests: provider adapter contract, credential missing state, malformed provider payloads, duplicate results.
256. UI tests: provider setup/status card and provider-source mention rendering when UI is touched.
257. Commit the provider adapter slice.

### Phase 22: Search-Index Collector

258. Add search-index collector for public web indexes, scoped to configured queries and domains.
259. Store only snippets/permalinks/evidence returned by the index; do not treat search index as complete platform coverage.
260. Add strict quotas and cadence limits.
261. Mark all search-index mentions as draft/manual-action only in reply policy.
262. Code tests: query building, result normalization, URL hashing, duplicate suppression, quota/backoff.
263. UI tests: browser-verify search-index source status and "manual action required" reply state.
264. Commit the search-index collector slice.

### Phase 23: Notification Inbox Collector

265. Add connector for a monitored social notification mailbox or forwarding address.
266. Parse platform notification emails into candidate mentions and evidence.
267. Support manual review for low-confidence parsed notifications.
268. Never auto-reply from notification-only evidence.
269. Code tests: sample email parsing, false-positive handling, malformed email, duplicate notification.
270. UI tests: browser-verify notification source setup, parsed evidence, and review-required state.
271. Commit the notification inbox slice.

### Phase 24: Browser Capture Mode

272. Add `browser_capture` as an explicit experimental/internal collection mode.
273. Require feature flag and operator-visible risk label.
274. Only capture visible/operator-approved results; do not implement captcha bypass, anti-bot evasion, proxy rotation, or hidden account automation.
275. Store captured permalink/snippet/screenshot evidence and mark reply policy as manual/draft only.
276. Code tests: source gating, evidence persistence, reply policy blocking live send.
277. UI tests: browser-verify enablement gate, risk copy, manual capture flow, and captured mention display.
278. Commit the browser capture slice.

### Phase 25: Normalization, Dedupe, and Clustering

279. Route all collectors through one ingestion spine.
280. Dedupe by `platform + externalId` when available; fallback to normalized URL hash and text/author/time heuristics.
281. Link every mention to its source and evidence.
282. Cluster similar mentions across reposts, provider/search duplicates, and repeated complaint waves.
283. Code tests: dedupe keys, URL normalization, cross-source duplicates, cluster updates, workflow side effects only on first creation.
284. UI tests: browser-verify duplicate badges, cluster count, evidence drawer, and source labels.
285. Commit the normalization slice.

### Phase 26: AI Triage and Action Queue

286. Add AI scoring fields or metadata for relevance, sentiment, lead intent, complaint, PR risk, urgency, topic, language, and recommended action.
287. Hide or collapse low-relevance noise by default.
288. Route high-risk items to alerts and action queue.
289. Generate drafts in the detected language and keep forbidden-topic guardrails.
290. Code tests: relevance scoring fallback, language detection, forbidden topics, action recommendations, no-send behavior.
291. UI tests: browser-verify filters for high-risk, leads, complaints, AI needs approval, and hidden/noise mentions.
292. Commit the AI triage slice.

### Phase 27: Reply Policy and Action Workflow

293. Enforce `ReplyPolicy` before any manual, AI, or provider send action.
294. Official owned comments/DMs can use live reply only with supported provider and live tenant flag.
295. Hashtag/search/provider/browser/manual sources default to AI draft plus human action.
296. Legal, medical, personal data, aggressive conflict, and complaints require approval.
297. Add actions: create lead, create ticket, create task, assign, ignore, escalate, open original link.
298. Code tests: policy matrix, blocked live send, approval-required states, send failure preserving status, audit logging.
299. UI tests: browser-verify action buttons per source tier, approval flow, blocked send copy, open-link fallback.
300. Commit the reply policy slice.

### Phase 28: Coverage Dashboard and Alerts

301. Add source coverage dashboard showing active sources, health, last run, found/new counts, errors, and trust tier distribution.
302. Add alert rules for negative spikes, VIP authors, lead intent, competitor mentions, repeated complaints, and source failures.
303. Show "coverage is partial" copy for search/browser/provider sources.
304. Code tests: aggregate metrics, alert thresholds, dedupe of repeated alerts, source failure alerts.
305. UI tests: browser-verify dashboard metrics, source health drilldown, alert list, and responsive layout.
306. Commit the dashboard and alerts slice.

### Phase 29: Deep Verification and Release Gate

307. Run model and migration checks for schema slices.
308. Run collector unit tests for every collector touched.
309. Run ingestion/dedupe/cluster tests for every source type touched.
310. Run AI policy and draft tests for every AI behavior touched.
311. Run permission and tenant isolation API tests for every route touched.
312. Run targeted lint/typecheck for touched files.
313. Run `npm run i18n:check` if locale files change.
314. Run `npx tsc --noEmit` before release when code, schema, or shared types change and it is practical.
315. Browser-verify `/social-monitoring`.
316. Browser-verify Page Watchlist create/edit/pause/run-now.
317. Browser-verify Hashtag/Keyword Watchlist.
318. Browser-verify source health and coverage dashboard.
319. Browser-verify mention evidence drawer and source labels.
320. Browser-verify AI action queue, approval, and blocked-send states.
321. Browser-verify narrow viewport for all changed Social Monitoring UI.
322. Production deploy only after explicit user authorization or an already-authorized release slice.
323. Post-deploy smoke starts with `/api/v1/ping`, then route-specific `/social-monitoring` checks and source-health smoke.
324. Never mark the roadmap slice complete if code tests pass but UI verification was skipped for a visible UI change; record the blocker instead.

## Atomic Tasks

### Phase 0: Baseline, Safety, and Roadmap

1. Create a clean worktree from current `origin/main`.
2. Confirm the new worktree has no local changes.
3. Read `AGENTS.md` in the clean worktree.
4. Record this roadmap in `docs/social-monitoring-roadmap.md`.
5. Run `git diff --check` for the roadmap-only slice.
6. Commit the roadmap with explicit path staging.
7. Re-open production `/social-monitoring` before UI work and record the current visible state.
8. Confirm no live WhatsApp/TikTok/AI send will be triggered by local tests.
9. Identify required environment variables for social, WhatsApp, AI, and Chatwoot dry-run testing.
10. Add a short implementation note to each future commit message describing whether external sends remain dry-run.

### Phase 1: Current Page Stability

11. Inspect `src/app/(dashboard)/social-monitoring/page.tsx` for dialog state handling.
12. Reproduce whether the Reply action opens the reply UI in a local/prod-like browser.
13. If Reply is broken, identify whether the issue is state, hidden dialog rendering, z-index, or disabled provider support.
14. Fix Reply UI opening without changing send semantics.
15. Confirm Reply remains provider-gated for unsupported platforms.
16. Reproduce whether Add Account opens the add account UI.
17. If Add Account is broken, identify whether the issue is state, hidden dialog rendering, z-index, or action collision.
18. Fix Add Account UI opening without changing OAuth behavior.
19. Confirm the add account UI clearly separates OAuth platforms from manual handle platforms.
20. Add a regression test or targeted component/API smoke for dialog state where practical.
21. Browser-verify Reply and Add Account on `/social-monitoring`.
22. Commit the page stability slice.

### Phase 2: Module and Permission Alignment

23. Inspect the Social Monitoring nav module gate.
24. Inspect all Social Monitoring API permission gates.
25. Decide the canonical module for Social Monitoring: `omnichannel`.
26. Update API permission gates that incorrectly use marketing/campaign scope.
27. Confirm users without omnichannel cannot access Social Monitoring APIs.
28. Confirm users with omnichannel can access Social Monitoring APIs.
29. Add or update tests for permission behavior.
30. Browser-verify the route is accessible for an omnichannel-enabled tenant.
31. Commit the permission alignment slice.

### Phase 3: Mention Ingestion Spine

32. List every current code path that creates `SocialMention`.
33. Inspect `src/lib/social/ingest-mention.ts`.
34. Define a single ingestion contract for comments, native poller events, Business Lead Ads, and any future public TikTok webhook events; keep private DMs in the Inbox contract.
35. Ensure duplicate guard uses platform plus external id where available.
36. Add source metadata support for `comment`, `dm`, `poller`, `chatwoot`, and `manual_ingest`.
37. Route `/api/v1/social/ingest` through the shared ingestion helper.
38. Preserve existing workflow execution on new mention creation.
39. Ensure existing mention updates do not re-trigger new-lead processing accidentally.
40. Add unit/API tests for shared mention ingestion.
41. Commit the ingestion spine slice.

### Phase 4: TikTok Source Integration

42. Inspect native TikTok OAuth scopes and poller behavior.
43. Inspect Chatwoot webhook TikTok handling.
44. Decide source priority: Chatwoot/provider events first, native TikTok poller as fallback.
45. Mirror TikTok public comments into `SocialMention` only through the Organic API/webhook boundary.
46. Keep TikTok Chatwoot DMs in Inbox/SocialConversation unless a future product decision adds a separate DM tab in Social Monitoring.
47. Mark any future DM monitoring records distinctly from public comments.
48. Do not import TikTok messages older than the connection time.
49. Use `connectedAt` or `lastPolledAt` to enforce post-connection-only ingestion.
50. Add duplicate guard for repeated Chatwoot webhooks.
51. Fix or separate the current TikTok poller behavior that records video titles as mentions.
52. If native TikTok comment API is available, add a poller path for own-video comments.
53. If native TikTok comment API is unavailable, expose an operator-visible limitation state.
54. Add TikTok platform smoke payloads for comment and DM ingestion.
55. Confirm TikTok filtered feed shows newly ingested test mentions.
56. Commit the TikTok ingestion slice.

### Phase 5: Phone Detection and Normalization

57. Add a phone extraction utility for social text.
58. Support Azerbaijani local numbers such as `050`, `051`, `055`, `070`, `077`, `099`.
59. Support international Azerbaijani formats such as `+99450` and `99450`.
60. Avoid false positives from dates, prices, short IDs, and video metrics.
61. Normalize valid phone numbers to E.164.
62. Return extraction confidence and original matched text.
63. Add tests for valid AZ numbers.
64. Add tests for invalid/ambiguous strings.
65. Add tests for text containing multiple numbers.
66. Connect phone extraction to TikTok mention ingestion.
67. Store detected phone processing state without creating duplicate leads.
68. Commit the phone detection slice.

### Phase 6: Lead Dedupe and Linking

69. Inspect current lead creation and duplicate lookup conventions.
70. Add lookup by normalized `phone` and `phoneWhatsApp`.
71. If no lead exists, create a lead from the mention.
72. If a lead exists, link the mention to the existing lead.
73. If the same number appears again, do not create a new lead.
74. If the same number appears again, do not enqueue WhatsApp group delivery again.
75. Record duplicate activity or status for operator visibility.
76. Preserve source fields: author name, username, phone, message text, video URL, campaign, platform, and date.
77. Ensure missing video/campaign fields are allowed and displayed as absent.
78. Add API tests for new lead creation.
79. Add API tests for duplicate lead linking.
80. Add API tests for repeated-number WhatsApp skip.
81. Commit the lead dedupe slice.

### Phase 7: WhatsApp Group Delivery

82. Inspect current WhatsApp provider code and settings model.
83. Verify whether the current provider supports group delivery or needs a separate adapter.
84. Add tenant setting for one WhatsApp group destination.
85. Add a server-side delivery adapter that defaults to dry-run.
86. Format group payload with name, username, phone, message text, video link, date, and campaign.
87. Enqueue delivery only for new phone leads.
88. Store delivery status `pending`.
89. Store delivery status `sent` for dry-run success or future live success.
90. Store delivery status `failed` with error detail.
91. Store delivery status `duplicate_skipped`.
92. Add manual retry endpoint for failed delivery.
93. Add delivery audit rows or structured metadata.
94. Add tests for dry-run delivery payload.
95. Add tests for failed delivery status.
96. Add tests for duplicate skip behavior.
97. Keep live group delivery disabled without explicit confirmation.
98. Commit the WhatsApp delivery slice.

### Phase 8: AI Classification and Drafting

99. Inspect current `src/lib/ai/social-reply.ts`.
100. Inspect current social/inbox AI auto-reply flow.
101. Add TikTok mentions to eligible AI social reply candidates.
102. Detect the comment language from the comment text.
103. Generate AI replies in the comment language.
104. Use official tone by default.
105. Add classifier output for positive, negative, neutral, and forbidden topic.
106. Add forbidden topic guard for price disputes.
107. Add forbidden topic guard for complaints.
108. Add forbidden topic guard for legal or medical topics.
109. Add forbidden topic guard for personal data.
110. Add forbidden topic guard for aggressive conflict.
111. Positive comments create an AI draft.
112. Positive comments auto-send only when the guard allows it and dry-run/live mode permits it.
113. Negative comments create an AI draft with `needs_approval`.
114. Negative comments never send without approval.
115. Add tests for classification and forbidden topic guard.
116. Commit the AI classification slice.

### Phase 9: AI Approval, Regeneration, and History

117. Add an AI draft/history model or extend existing shadow-action model with mention-level history.
118. Store draft text.
119. Store classification.
120. Store language and tone.
121. Store generation metadata.
122. Store regenerate reason.
123. Store approver user id.
124. Store approved timestamp.
125. Store sent timestamp.
126. Store send result and error detail.
127. Add API to generate a draft for one mention.
128. Add API to regenerate a draft with reason.
129. Add API to approve a draft.
130. Add API to reject a draft.
131. Add API to send an approved draft.
132. Add API to fetch AI history for one mention.
133. Ensure send remains dry-run without live confirmation.
134. Add API tests for draft generation.
135. Add API tests for regeneration reasons.
136. Add API tests for approval and rejection.
137. Add API tests for send status.
138. Commit the AI approval slice.

### Phase 10: Reply Provider Handling

139. Inspect current Facebook and Instagram reply API support.
140. Inspect whether TikTok reply is possible through the current provider.
141. If TikTok reply is supported, add provider-specific send path.
142. If TikTok reply is not supported, show a clear provider limitation state.
143. Do not mark a mention `replied` when provider send fails.
144. Mark a mention `replied` after successful dry-run or live send according to mode.
145. Store provider response metadata for audit.
146. Add tests for unsupported provider state.
147. Add tests for failed send preserving status.
148. Commit the reply provider slice.

### Phase 11: Social Monitoring UI States

149. Add filter or tab for TikTok.
150. Add filter or tab for Phone leads.
151. Add filter or tab for Needs approval.
152. Add filter or tab for Auto-replied.
153. Add filter or tab for WhatsApp failed.
154. Show detected phone in the mention card.
155. Show linked lead in the mention card.
156. Show duplicate status in the mention card.
157. Show WhatsApp delivery status in the mention card.
158. Show retry action for failed WhatsApp delivery.
159. Show AI draft block in the mention card.
160. Show approve action for pending negative drafts.
161. Show regenerate action for AI drafts.
162. Show regenerate reason selector.
163. Show reject action for AI drafts.
164. Show send status for AI replies.
165. Show AI and operator action history.
166. Add badges for `Auto-replied`, `Needs approval`, `Lead created`, `WhatsApp sent`, and `WhatsApp failed`.
167. Keep cards compact and scannable for production operator use.
168. Avoid nested cards and decorative AI UI patterns.
169. Browser-verify desktop layout.
170. Browser-verify mobile or narrow viewport layout.
171. Commit the UI states slice.

### Phase 12: Settings and Operator Workflow

172. Add settings surface for one WhatsApp group destination.
173. Add setting for AI positive auto-reply enabled/disabled.
174. Add setting for negative approval assignee or role.
175. Add setting for dry-run/live mode display.
176. Add empty states explaining TikTok setup requirements.
177. Add operator copy for unsupported TikTok reply provider.
178. Add audit copy for dry-run delivery.
179. Add permission checks for settings updates.
180. Add tests for settings API.
181. Browser-verify settings workflow.
182. Commit the settings slice.

### Phase 13: Verification and Release

183. Run phone extractor unit tests.
184. Run duplicate lead logic tests.
185. Run forbidden topic guard tests.
186. Run AI regeneration reason tests.
187. Run TikTok ingest API tests.
188. Run phone lead API tests.
189. Run WhatsApp delivery status API tests.
190. Run AI approval flow API tests.
191. Run targeted lint/typecheck for touched files.
192. Run `npm run i18n:check` if messages change.
193. Run Prisma validate/generate if schema changes.
194. Run `npx tsc --noEmit` where practical before deploy.
195. Browser-smoke `/social-monitoring`.
196. Browser-smoke TikTok filter.
197. Browser-smoke phone lead state.
198. Browser-smoke AI approval state.
199. Browser-smoke WhatsApp failed/retry state.
200. Read `clients/registry.json` before deployment.
201. Push only after successful checks.
202. Deploy through the standard `git push origin main` path when the slice is production-ready.
203. Smoke production `/api/v1/ping` after deploy.
204. Smoke production `/social-monitoring` after deploy.
205. Confirm live external sends remain disabled until separate confirmation.

### Phase 14: Generic Source and Reply Identity Model

206. Keep monitoring sources separate from reply identities.
207. Let operators add external pages, profiles, hashtags, keywords, and search URLs without code changes.
208. Route external page/profile/competitor/influencer/campaign sources through `search_index` by default.
209. Persist `settings.socialAccountId` only for owned sources that should collect/reply through a connected account.
210. Backfill legacy external manual sources through an RLS-safe migration.
211. Keep live replies fail-closed unless an official/provider reply path and connected identity are present.
212. Browser-verify owned-source creation shows the connected account/page selector.

### Phase 34: Scenario Pipeline Routing

213. Convert active scenario search targets into managed `MonitoringSource` records so collector scheduling can pick them up without code changes per page/tag/keyword.
214. Link existing duplicate sources through `settings.scenarioLinks` instead of overwriting operator-created source configuration.
215. Enrich every ingested `SocialMention` with `sourceMetadata.socialScenario` when its text, matched term, author handle, hashtag, or URL matches an active scenario.
216. Feed scenario matches into AI triage so configured scenario actions affect relevance, hidden-noise handling, approval requirement, alerts, and recommended action.
217. Keep scenario replies fail-closed: no live public reply send from scenario creation, source sync, ingest, or triage.
218. Code tests: scenario source sync, matching, ingest enrichment, triage alert/action routing.
219. UI tests: not required for this backend-only slice; browser smoke `/social-monitoring` after deploy to ensure the Scenario tab still loads.
220. Remaining follow-up: add immediate scenario-aware AI draft creation and production search-index/provider configuration checks.
