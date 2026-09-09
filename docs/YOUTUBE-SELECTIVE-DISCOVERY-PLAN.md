# YouTube Selective Discovery Plan

Status: implementation and production-proof plan. External replies remain disabled.

Target flow: tenant scenarios/keywords!� daily YouTube search � publication relevance gate!� comments only for MATCHED videos!� actionable mention filtering!� tenant-isolated deduplication and watermark.

Current runtime policy is `youtube-publication-gate-v2`: selective discovery and
comment eligibility both use the same seven-day window. Search is limited to one
page by default (two maximum), while comment and reply calls share a conservative
per-run request cap. Rechecking known videos on later daily runs is intentional
so new comments can be found; storage idempotency deduplicates unchanged rows.

| ID | Status | Evidence |
| --- | --- | --- |
| YT-SD-001 | DONE | Existing YouTube Data API search, channel/direct-video targeting, comments/replies pagination, tenant-scoped ingestion and watermark were audited; production currently has zero YouTube sources/runs/mentions. |
| YT-SD-002 | DONE | Versioned publication gate v2 accepts only deterministic tenant-term matches published inside the seven-day window; REVIEW covers missing publication time; stale, negative and insufficient evidence are rejected. |
| YT-SD-003 | DONE | YouTube collector persists every search candidate decision but adds only MATCHED video IDs to comment targets. Regression proves commentThreads is never called for REVIEW/REJECTED. |
| YT-SD-004 | DONE | Scenario-managed external YouTube sources are stamped with 1440-minute cadence and matched-only/candidate-only policy; arbitrary video scanning and live replies are disabled. |
| YT-SD-005 | DONE | Query/gate/comment integration is covered by 3 targeted files / 26 tests; CI static checks (TypeScript + unit tests) passed in PR #410. Existing adapter fixtures prove search/comment/reply pagination, canonical parent identity, deduplication and watermark behavior. |
| YT-SD-006 | DONE | Historical v1 evidence: after the YouTube quota reset, a bounded credentialed search used only the existing `brandprotection` query `Bravo supermarket Azerbaijan`. Page 1 returned 5 IDs and `nextPageToken=CAUQAA`; page 2 consumed that cursor and returned 5 additional unique IDs with `prevPageToken=CAUQAQ` and `nextPageToken=CAoQAA`. Pagination therefore proved 10/10 unique candidate IDs across two pages. A second bounded Araz query returned 5 candidates. Every result in both searches was older than the then-current 48-hour v1 publication gate, so all were correctly ineligible for comment collection and no comments endpoint was called. |
| YT-SD-007 | DONE | Product owner narrowed production evidence to the real `brandprotection` tenant and removed Mars/AFI fixtures. Existing tenant YouTube keyword sources ran against the production YouTube Data API after quota reset. The `bravo supermarket` source recorded a deterministic `stale_publication` REJECTED decision and then failed closed before comments with `youtube_video_channel_or_query_required`; no comment-provider call and no external reply occurred. Authenticated Social Monitoring UI smoke passed on production SHA `2168b0c9915ac0ac2ebc1ebd42b2286e36933655`; external sends remain visibly disabled. This is a truthful zero-fresh-result canary, not a claim of fresh coverage. |
| YT-SD-008 | WAITING (observing) | Observation window and promotion after runtime evidence. The shared deterministic invariant evaluator `evaluateSelectiveDiscoveryObservationDay` (`src/lib/social/selective-discovery-observation.ts`, 18 targeted tests PASS) judges each brandprotection tenant-day against the same seven safety invariants (tenant isolation; no arbitrary scanning; comments only for ACCEPTED; zero REVIEW/REJECTED dispatch; dedup + watermark; zero external replies; Apify check not applicable to YouTube's official-API route). Prior `YT-SD-007` evidence used the historical 48-hour v1 gate, so the production observation window must restart under the seven-day v2 contract. Window/promotion tracking lives in `docs/SELECTIVE-DISCOVERY-OBSERVATION-LOG.md`. Do not mark DONE before the real window elapses and the owner signs off. |
| YT-SD-009 | DONE | Reliability bounds: exactly one selective run per day; one search page by default/two maximum; truncated search reports `SAMPLED`; repeated search, thread and reply page tokens terminate; all comment/reply calls share a configurable per-run cap; hard quota exhaustion is not retried. Focused regression: 3 files / 76 tests PASS; targeted ESLint and `git diff --check` PASS. |

## Safety invariants

- Never scan arbitrary YouTube videos.
- Never call the comments provider for REVIEW or REJECTED candidates.
- Keep all external replies disabled.
- Do not enable production sources before pagination proof and two-tenant smoke.
- Use the existing YouTube Data API adapter; do not add a duplicate provider path.

## Current verification

- 3 targeted files / 26 tests: PASS.
- Targeted ESLint: PASS.
- git diff --check: PASS.
- social typecheck: BLOCKED by three pre-existing implicit-any errors in src/lib/social/coverage-slo.ts introduced on main; no YouTube-path type error was reported.
