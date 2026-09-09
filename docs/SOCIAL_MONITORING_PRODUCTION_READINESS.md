# Social Monitoring production readiness

Last updated: 2026-07-22

This document is the durable source of truth for taking Brand Protection Social
Monitoring from the current verified production state to the agreed definition
of production-ready. Update the status, evidence, pull requests, deployments,
and blockers as work progresses.

## Current status

- Production authentication and the Bravo `other authors` feed are verified.
- PR #380 and PR #384 are merged and deployed.
- Seven monitoring subjects are active: Araz, Bəhruz Şiraliyev, Bravo,
  Brend qorunması, PharmaStore, PharmOnline, and Zeytun. The two restored
  subjects are linked only to their preserved tenant sources; source health
  remains part of the release gate.
- TikTok provider access is proven with bounded one-shot runs, but recurring
  paid collection remains disabled and is not authorized.
- Paid manual source runs now require a provider-forwarded one-shot USD cap in
  production. Aggregate tenant authorization is deployed and remains fail-closed
  by default until an admin explicitly enables a bounded tenant policy.
- YouTube posts are present; YouTube comment collection is not proven end to
  end in production.
- Four monitoring scenarios exist; the full risk-scenario matrix is incomplete.

## Production-ready definition of done

- [ ] Seven agreed monitoring subjects are active and have a healthy source.
- [ ] Every enabled source has a recent successful run and actionable failure
      telemetry.
- [ ] Tenant login and the core Brand Protection journey run automatically
      after every production deployment.
- [ ] YouTube posts and comments are proven from provider to database to UI.
- [ ] TikTok has an explicit product decision: safely enabled with owner-set
      budgets, or documented as excluded from recurring scope.
- [ ] Relevance precision is at least 95% and recall is at least 90% on a
      reviewed multilingual gold set.
- [ ] Tenant-isolation negative tests pass for UI and APIs.
- [ ] Alerts, rollback instructions, and the operator runbook are complete.
- [ ] A 48-72 hour soak completes without a critical collector or auth error.

## Roadmap

### P0 — inventory and safe operator controls

- [x] Identify and configure the two missing monitoring subjects.
  - The owner confirmed that the previously deleted `Bəhruz Şiraliyev` and
    `Brend qorunması` subjects belong to the seven-subject scope.
  - A tenant-scoped production restore reactivated both records, recreated 17
    aliases, and relinked 24 preserved sources. No source status changed and no
    provider call was made.
  - Pre-change backup:
    `/opt/leaddrive-v2/backups/social-subject-restore-before-20260718T233107Z.json`.
- [ ] Add a CI-managed authenticated browser smoke using a secret-managed test
      account; do not recover credentials from local chat or shell history.
- [x] Fix paid manual runs so an explicit USD cap is mandatory and forwarded to
      the provider. Missing or exhausted authorization fails closed before
      provider I/O; paid sources are excluded from bulk Run all.
  - Completed in PR #388, merge `665ea1e377d586ffb063ca260f400cb6230841cb`;
    production deploy and post-deploy smoke passed on 2026-07-18.
- [x] Add aggregate per-tenant paid-run authorization and audit reporting.
  - Implementation status (2026-07-18): fail-closed tenant policy, aggregate
    reservations, actor audit, admin controls and regression tests are deployed.
    PR #389 passed CI; the latest production workflow for the descendant main
    commit `eb2d4cffa5dfb1d553bdda0cd56d552021a440df` completed deploy and smoke.
- [x] Add tenant-isolation negative tests around subject/source URL filters.
  - Source detail rejects a foreign source as 404; subject-filtered mentions keep
    both subject and match rows scoped to the authenticated organization.

### P1 — collection completeness

- [ ] Prove YouTube comment collection, including parent video URL, top-level
      comments, replies, deduplication, quota handling, and UI presentation.
- [ ] Review all eight Bravo TikTok query sources. Remove or contextualize
      ambiguous broad queries before recurring collection.
- [ ] Decide whether official TikTok posts belong in the official archive and
      ensure they cannot enter the `other authors` feed.
- [ ] Add collector tests for provider timeout, budget exhaustion, 429, partial
      datasets, schema drift, and duplicate items.

### P1 — relevance quality

- [ ] Build a multilingual gold set of 50-100 reviewed observations per
      subject, including ambiguous names and negative examples.
- [ ] Measure precision and recall separately for official and external authors.
- [ ] Add manual relevant/not-relevant feedback and reprocessing support.
- [ ] Expand from four scenarios to cover normal mention, complaint, crisis,
      impersonation, fraud, counterfeit, official content, and ambiguity.

### P2 — operations and release gate

- [x] Alert on no successful run for 24 hours, three consecutive failures,
      unexpected zero results, rejection-rate spikes, quota/budget exhaustion,
      and repeated 401/403/429/5xx responses.
  - SLO evaluation is wired into the source cron; alerts are tenant-scoped,
    deduplicated for 24 hours, and covered by targeted Vitest.
- [x] Document source creation, provider diagnostics, reruns, rollback, test
      account recovery, and post-deploy smoke procedures in
      `docs/SOCIAL_MONITORING_OPERATOR_RUNBOOK.md`.
- [ ] Complete a 48-72 hour soak and record source health, duplicates, latency,
      provider cost, process restarts, and error counts.

## Implementation evidence — SLO wiring and deterministic YouTube path

- SLO rules now run after each source-collection cron wave and persist
  tenant-scoped, deduplicated aiAlert rows for stale sources, three
  consecutive failures/partials, three successful zero-result runs, repeated
  provider status failures, quota/budget errors, and high rejection rates.
- Targeted tests cover the evaluator, cron response, and tenant-scoped writes.
- The YouTube adapter already has a deterministic provider-fixture E2E path:
  keyword/video discovery, commentThreads pagination, reply pagination, parent
  video/comment URLs, database ingest arguments, and duplicate-safe counts are
  asserted in lib-social-official-comment-adapters.test.ts. A real
  credentialed production canary and UI evidence are still required for the
  release gate.

## Verified production evidence

### Authentication and Bravo feed

- Deployment commit: `6d751420313a14a23e35336cf364c87631473334`.
- Deployment workflow: GitHub Actions run `29643150273` — success.
- Tenant credentials callback returned a session cookie.
- Bravo `other authors` feed showed 11 observations and no Social API error.
- Expected external authors were present; official Bravo and Central Islip were
  absent from the checked state.

### TikTok bounded dry-run — 2026-07-18

Authorization: maximum aggregate spend USD 4; no recurring paid collection.

Provider: Apify `clockworks/tiktok-scraper`, pinned build `0.0.561`.
Pricing preflight reported PAY_PER_EVENT and a minimum provider cap of USD 0.50.

Run 1:

- Audit run: `cmrqd5ypl00015038jb55h803`.
- Provider run: `BkRRaEfa7tR9ilkxQ`.
- Query: `bravo supermarket`.
- Provider cap: USD 0.50.
- Results: 10.
- Actual provider charge: USD 0.001.
- Finding: 10/10 were unrelated non-Azerbaijan Bravo businesses or ambiguous
  uses. The broad query is unsuitable for recurring ingestion by itself.

Run 2:

- Audit run: `cmrqd81bz0001501g8ksieu2t`.
- Provider run: `oicS1RAExJo1PddHt`.
- Seven remaining configured Bravo query/hashtag variants in one run.
- Provider cap: USD 0.50.
- Results: 70.
- Actual provider charge: USD 0.181.
- Context candidates: 21; manual review found 18 clearly relevant Azerbaijan
  observations, two false positives, and one ambiguous observation.
- No Central Islip result was returned.

Aggregate dry-run result:

- Provider-enforced caps: USD 1.00 of the authorized USD 4.00.
- Actual provider charge: USD 0.182.
- Regular collection enabled by this dry-run: no.
- Raw provider results were reviewed but were not bulk-ingested into production.

## Implementation evidence

### Manual paid-run hard cap — implementation checkpoint

- Manual provider execution now requires an explicit positive one-shot USD cap;
  missing or exhausted authorization fails closed before provider I/O.
- The cap is allocated across monetary routes in a single collector run.
- Apify always receives `maxTotalChargeUsd`; the audit snapshot records the
  operator-authorized cap and no longer records `ownerAuthorizedUncapped`.
- Bright Data manual execution uses the same price-snapshot-backed capped
  dispatch as scheduled execution; the uncapped trigger path is removed.
- The watchlist requires individual cap confirmation for paid sources and
  excludes them from bulk Run all.
- Local verification: 5 focused Vitest files / 91 tests passed; targeted ESLint
  passed; `npm run i18n:check` passed.
- Full local `npx tsc --noEmit`: NOT COMPLETED because the repository-wide
  process entered sustained swap thrashing after 14 minutes with no
  diagnostics.
- PR #388: https://github.com/rashadrahimov/leaddrive-v2/pull/388
- CI static checks (including full TypeScript compile-check and unit tests):
  https://github.com/rashadrahimov/leaddrive-v2/actions/runs/29647434019 — passed
  in 6m20s.
- CI scan: https://github.com/rashadrahimov/leaddrive-v2/actions/runs/29647434005
  — passed in 18s.
- Production deployment: https://github.com/rashadrahimov/leaddrive-v2/actions/runs/29647883037
  — success; build, exact-artifact deploy and post-deploy smoke all passed.
- Production merge/live commit: `665ea1e377d586ffb063ca260f400cb6230841cb`.
- Independent production ping on 2026-07-18: HTTP 200, database `ok`, six
  organizations, 2 ms reported latency.
- Authenticated Social API smoke: HTTP 200 with 193 tenant-scoped sources.
- Exact paid-source browser smoke: the confirmation dialog opened for
  `https://www.facebook.com/reportnewsagency`; the input enforced max 100;
  confirm was not clicked; zero `/run` requests occurred before confirmation;
  no Social API 4xx/5xx response was observed.
- Smoke incident: an earlier broad text selector clicked bulk Run all instead of
  the intended source button. Read-only production verification found zero
  recent provider runs and therefore zero paid exposure. Only fail-closed/free
  collector audit rows were created. Future paid-source smoke uses an exact
  source-card ancestor selector plus a Playwright network abort for every
  `/monitoring-sources/*/run` request until the confirmation state is proven.

### Aggregate tenant paid-run authorization — local checkpoint

- Tenant policy lives under organization settings and defaults to manual runs
  disabled, emergency stop active, and zero budgets. No migration or production
  data mutation is required.
- Enabling manual paid runs, increasing any limit, or clearing an active
  emergency stop requires an explicit admin confirmation. Policy changes are
  versioned and actor-audited.
- A tenant-scoped PostgreSQL advisory transaction lock serializes policy changes
  and authorization reservations. Per-run, UTC-day and UTC-month limits are
  enforced across all paid providers and sources before collector execution.
- Reservations are released only when provider non-dispatch is proven. An
  unexpected exception keeps the full reservation conservatively.
- Reporting is tenant-filtered; non-admin readers receive authorization history
  with actor identifiers redacted.
- The paid-source dialog loads tenant policy and remaining aggregate budget,
  clamps the input to the effective per-run/day/month remainder, and disables
  confirmation while policy is absent, stopped, exhausted or globally
  unenforced.
- Admin-only settings expose bounded manual authorization and an immediate
  emergency stop. They do not enable scheduled or recurring paid collection.
- Local verification: 4 focused Vitest files / 53 tests passed; targeted ESLint
  passed; translation parity passed with 16,825 keys and no missing/extra keys.
- Scoped TypeScript compile-check with a 6 GB heap reports no changed-file
  diagnostics. It still reports the pre-existing `src/lib/auth.ts:88` implicit
  `any`; that file is unchanged from `origin/main`. Full PR CI remains the
  authoritative repository-wide typecheck.
- PR #389: https://github.com/rashadrahimov/leaddrive-v2/pull/389
- PR static checks: https://github.com/rashadrahimov/leaddrive-v2/actions/runs/29650864840 — passed in 6m39s, including full TypeScript compile-check and unit tests.
- PR secret scan: https://github.com/rashadrahimov/leaddrive-v2/actions/runs/29650864844 — passed in 15s.
- Production deploy: covered by workflow `29658543797` for the descendant main
  commit `eb2d4cffa5dfb1d553bdda0cd56d552021a440df`; artifact verification, deploy,
  public ping, and login/assets smoke passed.

## Continuation checkpoint - 2026-07-18

- [x] Production deploy workflow 29657852139 passed quality, exact artifact verification, server deploy, public API ping HTTP 200, and login plus hashed CSS/JS smoke for commit 56dc0dcbdcc48e9d732e571409d18c87c31d8d04.
- [x] CI baseline fixes in PRs 392, 393, 394, and 396 are merged; scoped gate passed 41 files and 474 tests.
- [x] Build reliability fixes in PRs 398 and 399 raised webpack heap to 12 GiB and build/deploy timeout to 45 minutes.
- [ ] Authenticated Social Monitoring browser smoke still needs a CI-managed secret session; approved local production smoke remains latest feature evidence.
- [ ] Remaining DoD blockers: restored-subject source health, CI smoke secret
  provisioning, YouTube comments provider-to-database-to-UI canary,
  multilingual gold set, and the 48-72 hour soak.

## Production subject restoration - 2026-07-18

- The Brand Protection tenant now has exactly seven active monitoring subjects.
- `Bəhruz Şiraliyev`: 16 aliases and 16 preserved web sources; all sources
  remain disabled pending an explicit collection decision.
- `Brend qorunması`: one canonical alias and eight preserved Facebook/Instagram
  sources; four are disabled and four remain limited.
- The restore was recorded in tenant audit logs. Production ping returned HTTP
  200 with database status `ok` after the transaction.
- One pre-existing `Brend qorunması` match remains for analyst review; the
  restore did not reclassify or delete mention data.

## Runtime release-gate audit - 2026-07-19

- Production workflow `29666154630` succeeded for exact artifact SHA
  `7ff9e03b66324093d0ebc8d2c08b14507a011527`. The live standalone
  `.deploy-sha` marker matches that SHA; the repository checkout under
  `/opt/leaddrive-v2` is intentionally not the runtime revision source of
  truth. PM2 is online with zero restarts, and the public ping returned HTTP
  200 with database status `ok`, six organizations, and 2 ms latency.
- A tenant-scoped application-role audit ran inside the normal
  `app.org_id=brandprotection` RLS context. It confirmed seven active subjects,
  193 sources, and 453 mentions. A no-context control query saw zero tenant
  rows, confirming that FORCE RLS remained fail-closed; no bypass role was
  used.
- `Bəhruz Şiraliyev` still has no healthy collector route. All 16 linked web
  sources are disabled, have never run, and compile only to blocked
  `MANUAL_TASK` route plans. Tenant search-index configuration is disabled and
  has no endpoint, allowlist, or token record. Enabling these rows alone would
  not collect data; a separately approved provider or a new free adapter is
  required.
- `Brend qorunması` has four disabled and four limited Facebook/Instagram
  sources. The limited sources have successful timestamps from 2026-07-18,
  but their latest runs are partial: two are classified as fetch failures and
  one as budget/paid-route blocked. The single pre-existing MATCHED observation
  remains unchanged.
- Tenant source inventory is 2 active, 90 limited, 97 disabled, and 4
  `needs_setup`. All 92 active/limited sources have a successful timestamp in
  the latest 24-hour window, but this does not make the partial failures
  healthy. The last 72 hours contain 247 successful, 694 partial, and 781
  skipped collector runs.
- Runtime SLO wiring is proven. The source cron persisted 78 critical,
  tenant-scoped, deduplicated coverage alerts: 31 budget exhaustion, 41 three
  consecutive failures, and 6 repeated provider status failures. This evidence
  blocks the soak start rather than being treated as a passing state.
- The YouTube Data API comment route is live for two active channel sources.
  Each of the latest runs completed one `commentThreads` page and received
  three comments with `COMPLETE_FOR_INPUT` coverage, but all three were
  relevance-ignored because none matched a configured subject term. Production
  still contains 57 YouTube POST mentions and zero COMMENT/REPLY mentions, so
  provider-to-database-to-UI proof remains open. Bravo discovery sources are
  degraded by quota/rate-limit failures; no paid provider was invoked.
- Repository secrets `SOCIAL_SMOKE_EMAIL`, `SOCIAL_SMOKE_PASSWORD`, and
  `SOCIAL_SMOKE_ORG_SLUG` remain absent. The authenticated deploy smoke is
  therefore still skipped. Credentials were not recovered from local history,
  and the 48-72 hour soak was not started without this gate.

## Current blockers requiring owner input
- Separate authorization is required before enabling any recurring paid TikTok
  collection or raising provider budgets.
- A verified secret-managed Brand Protection smoke account is required before
  configuring the CI secrets and starting the formal soak.
- `Bəhruz Şiraliyev` requires either an approved paid search provider with an
  explicit cap or implementation and approval of a compatible free source.
- The multilingual gold-set gate requires owner-reviewed labels; synthetic
  fixtures and automatic labels cannot substitute for this evidence.

## Production objective checkpoint - 2026-07-22

This checkpoint supersedes the operational counts and open-gate status in the
older snapshots above; those sections remain as historical evidence.

### Delivered behavior and production data proof

- The mention list defaults to `Other authors`. The subject author filter
  separates official posts from third-party posts while preserving a
  third-party comment, repost, duet, or stitch attached to official content as
  `Other authors`.
- The counters are deliberately additive: `All = Posts + Comments + Media`.
  A production RLS-scoped audit for Bravo returned 65 posts, 0 comments, and
  53 media items, so the expected `All` value is 118. Media is an overlapping
  facet and is intentionally counted in addition to the content-type totals.
- PR #518 changed the focused `Official` subject query to include both the
  current `official_author` reason and provenance-suffixed historical reasons.
  This restores 15 Bravo rows marked
  `official_author_excluded_backfill` to the Official view without allowing
  them back into Other authors.
- Araz's Facebook and Instagram profile links were changed from `MONITORS` to
  `OFFICIAL` only at the Araz subject-link level. The two shared source records
  remain externally owned for other subjects. The pre-change backup is
  `/opt/leaddrive-v2/backups/araz-official-source-links-before-20260722T002002Z.json`;
  the change is also represented in the tenant audit log. No mention was
  deleted or reclassified.
- The production tenant currently has five non-deleted subjects: Araz
  Supermarket, Bravo Supermarket, PharmaStore, paused PharmOnline, and Zeytun
  Pharmaceuticals. The older seven-subject snapshot is no longer current;
  previously deleted test subjects were not recreated.

### Comment collection status

- Instagram already contains 34 active comment observations. Apify is the
  configured comment route, but the first controlled production canary remains
  gated by an explicit paid-run cap. PR #517 fixes the persisted target
  dependency that otherwise blocks a valid Instagram comment candidate after
  transient envelopes are purged. Keep it unmerged until one Apify Instagram
  comment smoke is authorized with a maximum total spend of USD 1.
- TikTok contains 9 matched comments. Recent Bright Data comment runs completed
  without accepting new rows, and two active paid discovery sources are
  currently limited by the tenant daily budget.
- Facebook's recent extract path received 124 comment candidates and accepted
  5; no active Facebook comment observations remain in the current filtered
  production set. This needs a relevance/lifecycle follow-up rather than a
  balance increase by itself.
- YouTube has five active grouped official-API sources and no persisted comment
  observation yet. The latest attempts failed with YouTube
  `rateLimitExceeded`. Provider balance cannot resolve that gate; the next
  video-to-keyword-comment canary must run after quota reset or quota increase.

### Runtime, coverage, and remaining gates

- Production merge commit
  `7226f79e24bd45d34d64ded2d7762f81f499e591` from PR #518 was deployed by
  successful workflow `29880070818`. The standalone `.deploy-sha` marker
  matched that commit; PM2 was online with zero restarts from the standalone
  directory; local and public pings returned HTTP 200 with database status
  `ok`; and the authenticated Social Monitoring browser smoke passed.
- Current source health is 25 OK, 32 failing, 5 stale, and 175 inactive out of
  237 sources. The 37 active problem sources include provider failures, manual
  budget exhaustion, official-profile fetch failures, and YouTube rate limits.
  Recent deduplicated coverage alerts prove that the SLO wiring is active.
- Local production login with the recovered test admin reached the tenant but
  the Social Monitoring API correctly required 2FA; no bypass or password
  reset was attempted. The CI-managed read-only smoke account is now active and
  provides the authenticated browser deploy gate. A fresh human-browser exact
  counter screenshot still requires completing that account's normal 2FA
  flow.
- Before declaring the entire feature production-ready, complete the capped
  Apify Instagram comment canary, a successful post-quota YouTube comment
  canary, owner-reviewed multilingual gold-set labels, and a clean 48-72 hour
  soak with no unresolved critical coverage alert.

### Provider spend decision

- Do not refill Bright Data solely to unblock this checkpoint: one prior broad
  run consumed about USD 50, so its query scope and hard caps must be narrowed
  before another large run.
- If Apify has no usable balance, a small refill (for example USD 5) is enough
  to keep the account usable; the authorized smoke must still be independently
  capped at USD 1. No refill authorizes scheduled or recurring paid collection.

## Post-deploy production delta - 2026-07-22 01:25 UTC

This delta supersedes the point-in-time comment counts, source-health counts,
and YouTube scheduler state in the preceding 2026-07-22 checkpoint.

### YouTube scheduler and video-to-comment path

- PR #520 fixed starvation of never-run sources by sorting
  `lastCheckedAt = null` first in the bounded global scheduler window. Merge
  `7c74d0ce5ba37213c0d3e8bd7504747bfca90515` was deployed by successful
  workflow `29882418908`; quality, exact-artifact deploy, public database ping,
  login/assets smoke, and authenticated Social Monitoring browser smoke all
  passed.
- The first normal cron wave after deployment selected the previously-never-run
  Bravo and Zeytun grouped YouTube sources. Bravo completed at 01:20 UTC with
  `READ_EXTERNAL_COMMENTS > YOUTUBE_DATA_API`: one search page, 10 discovered
  videos, and complete input coverage. All 10 failed the publication eligibility
  gate (`approvedVideos=0`), so no `commentThreads` request was appropriate and
  no comment evidence was created. The run recorded nine duplicates and one
  ignored result; the newly evaluated rejection was `stale_publication`.
- Both Zeytun grouped sources were also attempted by the same cron wave, proving
  that scheduler starvation is removed. They stopped with
  `youtube_rate_limited:rateLimitExceeded`. The remaining YouTube production
  gate is therefore a fresh eligible keyword-matched video followed by a
  keyword-matched comment/reply reaching the database and UI; provider balance
  cannot resolve YouTube API quota.

### Current comment and provider evidence

- A tenant-scoped read-only audit at 00:59 UTC found 41 matched Instagram
  comments: 40 older `search_index` rows and one `provider_api` row. The default
  30-day UI slice currently exposes only the one recent matched provider row.
  Native rows also exist but are unmatched: 18 Facebook and 22 Instagram.
  No current matched TikTok or YouTube comment/reply row was found. This
  supersedes the earlier 34-Instagram/9-TikTok point-in-time counts.
- The latest 24-hour internal provider ledger recorded USD 0.5875 actual charge:
  approximately USD 0.5645 for Apify web discovery and USD 0.023 for Apify
  Instagram discovery. Web discovery received 634 items and accepted zero, so
  recurring scope/cost needs optimization before adding balance. No paid
  provider request was initiated while gathering this checkpoint.
- PR #517 fixes the persisted-candidate dependency for Apify Instagram comment
  extraction. Its secret scan and static checks are green. Persisted-candidate
  recovery is capability-scoped and manual-only: full-source and scheduled
  runs remain dependency-pending, so merging does not authorize recurring paid
  comment requests. The next allowed action is one separately authorized Apify
  Instagram comment smoke capped at USD 1.
  Candidate lookup is bounded to fresh 48-hour parent runs, evidence, and
  normalized mentions, and invalid profile URLs are rejected before dispatch,
  so an old provider run cannot revive a stale paid comment target.
- A 02:16 UTC read-only route-order audit found that the sole Instagram source
  with fresh normalized candidates has discovery/enrichment paid stages before
  comments. A normal full-source run could therefore consume its cap before
  reaching comments. PR #517 adds a first-class stage selector to the existing
  paid-run dialog and a validated `onlyCapability` API field. Selecting
  `READ_EXTERNAL_COMMENTS` runs only that route from persisted candidates. A
  selected paid stage always requires an explicit USD cap even when the tenant
  also has a run-count quota; the UI defaults a newly selected paid stage to at
  most USD 1, and the API blocks cap-less bypass attempts.
- A read-only Apify account preflight at 02:07 UTC called only the account
  limits/usage endpoints; it did not start an Actor or write application data.
  The configured account is STARTER/BRONZE with USD 29 of monthly included
  usage and the same USD 29 hard limit for the 2026-07-12 through 2026-08-11
  cycle. Current usage was USD 6.4065, leaving USD 22.5935 before the hard
  limit. No refill is currently required for the USD 1 comment smoke.

### Current release gates

- The 00:54 UTC source audit classified 38 sources OK, 39 failing, three stale,
  and 157 inactive out of 237; 42 active sources still require attention.
- Keep Bright Data unfunded until broad-query scope and provider-side caps are
  proven. Do not refill Apify now: the account preflight above shows USD 22.5935
  remaining before its monthly hard limit. A future refill, if the account
  actually reaches its limit, neither raises the USD 1 smoke cap nor authorizes
  recurring collection.
- Remaining production-ready gates are the capped Apify Instagram comment
  canary, a successful YouTube video-to-comment canary after quota is available,
  owner-reviewed multilingual gold labels, and a clean 48-72 hour soak without
  unresolved critical coverage alerts.

## PR #517 production activation - 2026-07-22 02:57 UTC

- PR #517 merged as `8111655eb730785b2912a0501ea279b79cbf7194` and workflow
  `29886685978` completed successfully. The workflow passed quality/security,
  the authoritative production webpack build, exact-artifact deployment,
  public DB-path ping, login/hashed-assets smoke, and the authenticated Social
  Monitoring browser smoke.
- Independent runtime checks matched `.next/standalone/.deploy-sha` to the
  merge SHA, found PM2 `leaddrive-v2` online with zero restarts, and returned
  `{ok:true,db:"ok",orgCount:6}` from both local and public `/api/v1/ping`.
  The deployed static/server bundles contain `social-paid-run-capability`, so
  the new stage selector is part of the running artifact.
- A tenant-scoped read-only audit at 02:57 UTC found zero Apify provider runs,
  zero Apify comment-extraction runs, and zero provider runs with a charge or
  reservation since the merge. This is production evidence that deployment did
  not turn the persisted-candidate recovery into a scheduled paid run.
- The local shared-worktree webpack build was not counted as passed: local
  memory pressure terminated compilation without a Next diagnostic or
  `BUILD_ID`. The authoritative server build above passed and is the deployment
  gate for the exact artifact now running in production.

### Next bounded Instagram-comments proof

This is still a paid action and was not performed during deployment. After the
owner authorizes a single Apify Instagram comments smoke with a maximum total
charge of USD 1:

1. In Social Monitoring -> Sources -> Monitoring, open the relevant Instagram
   source and press **Run now**.
2. In the existing paid-run dialog select **Candidate-post comments**
   (`READ_EXTERNAL_COMMENTS`) and set **Maximum charge (USD)** to `1`.
3. Confirm one run. Do not choose **Full source scan**: production route order
   contains paid discovery/enrichment stages before comments and they could
   consume the shared cap first.
4. Wait for the asynchronous Apify provider run to become terminal. Verify the
   provider-forwarded `maxTotalChargeUsd=1`, the parent publication URLs, raw
   received/accepted/rejected/duplicate counts, and actual charge without
   printing tokens, authors, or comment bodies.
5. Prove at least one keyword-relevant comment/reply reaches the tenant-scoped
   `SocialMention`/`MentionEvidence` rows and the filtered Comments UI. If the
   actor returns no relevant public comments, record that truthful zero-result
   outcome; do not claim end-to-end positive coverage and do not repeat a paid
   run without a new cap.

Recurring paid comment collection remains disabled by design. A successful
one-shot proof does not authorize enabling the scheduler path.

## Completion audit and non-spending browser gate - 2026-07-22

- The author-scope requirement is implemented end to end. External-search
  findings default to `others`; the selected scope is persisted in the URL and
  forwarded to the tenant-scoped API. The API supports global and focused-
  subject `official`/`others` scopes, includes suffixed official backfill
  reasons, and treats source evidence as provenance rather than author identity
  for comments. This keeps external comments under an official publication in
  the other-authors feed.
- The counter contract is intentionally additive: `All = Posts + Comments +
  Media`, even when a media item also appears under Posts. The extracted
  `mentionSurfaceCounts` helper has an explicit owner-regression case proving
  `65 + 0 + 53 = 118`, plus coverage for `mention`/`reply` aliases and missing
  aggregates. The API's `bySourceType` aggregate remains surface-agnostic so
  switching tabs does not overwrite the other segment counts.
- PR #524 merged as `54585329d91d75a3eb6682c9ee5cb1ec63047a9f` and added a
  non-mutating production browser gate for the paid comments dialog. Its first
  workflow (`29888575671`) deliberately failed after successful artifact
  deployment, DB ping, and asset smoke because the new test selector was
  attached to Configure instead of Run now. PR #525 moved that selector to the
  correct button and merged as `3d635a4d8cf39fde21ea60e677ac4d9d1d55b025`.
- Workflow `29889025850` then passed quality/security, the authoritative
  production webpack build, exact-artifact deployment, public DB-path ping,
  login/hashed-assets smoke, and the strengthened authenticated browser smoke.
  The smoke finds a configured paid comments source, opens Run now, selects
  `READ_EXTERNAL_COMMENTS`, verifies the suggested cap is positive and at most
  USD 1, clears the cap and proves confirmation is disabled, and fails if any
  provider-run POST is observed. It never clicks Confirm.
- Independent runtime checks matched `.next/standalone/.deploy-sha` to the PR
  #525 merge SHA, found PM2 `leaddrive-v2` online with zero restarts, and
  returned `{ok:true,db:"ok",orgCount:6}` from both local and public ping.
  A tenant-scoped DB audit after the deploy start found zero provider runs,
  zero comment-extraction runs, USD 0 reserved, and USD 0 actual charge.
- Current-tree verification for this completion audit passed 27 author-scope,
  mentions-API, and counter regression tests plus 115 monitoring-collector,
  Apify, official-comments, source-run API, and YouTube publication-gate tests.
  Targeted ESLint, `typecheck:social`, smoke-script syntax, and
  `git diff --check` also passed.

The only missing positive proof is still the explicitly owner-authorized,
single-run Apify Instagram comments canary capped at USD 1. The non-spending
gate above proves the production control path is ready; it does not claim that
an Actor returned a relevant public comment or that such a comment reached the
database and UI.
