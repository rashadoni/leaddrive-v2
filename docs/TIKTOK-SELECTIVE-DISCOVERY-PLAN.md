# TikTok selective discovery and comment collection

Status: implementation plan. No live provider routing is authorized by this document.

Implementation ownership: `codex/tiktok-selective-discovery-20260718`, contiguous slice `TT-SD-001` → `TT-SD-017`.

## Implementation status and evidence

| ID | Status | Evidence |
| --- | --- | --- |
| `TT-SD-001` | DONE | Coverage contract v2 includes a machine-readable false comment-only-discovery flag; downloadable Markdown and AZ/RU/EN operator copy state the blind spot. PASS: 2 targeted files / 22 tests; targeted ESLint; i18n parity; `typecheck:social` (4GB heap); `git diff --check`. |
| `TT-SD-002` | DONE | `build/loadTikTokTenantQueryPack`: active tenant TikTok scenarios + subject aliases/exclusions/negative aliases; disjoint tenant payload and no-dispatch fixtures. |
| `TT-SD-003` | DONE | SHA-256 query-pack version and tenant/version/UTC-window dispatch key bind to the existing unique provider-run idempotency ledger. Retry fixture proves stability. |
| `TT-SD-004` | DONE | Scenario-managed external TikTok sources are stamped `cadenceMinutes=1440`; due-time is exactly 24h and dispatch carries a truthful 24h provider window for existing successful-watermark handling. |
| `TT-SD-005` | DONE | Existing `ProviderCandidateBoundaryDraft`/Bright Data persistence remains candidate-only; provider contract rejects candidates at mention ingest. Source policy explicitly forbids arbitrary scans and live routing. |
| `TT-SD-002`–`TT-SD-005` evidence | PASS | 5 targeted files / 42 tests; targeted ESLint; `typecheck:social` (4GB heap); `git diff --check`. |
| `TT-SD-006` | DONE | `decideTikTokPublication` produces terminal MATCHED/PROBABLE/REVIEW/REJECTED decisions with reason codes, terms, scenario IDs, query, provider, observed time and frozen policy. Positive, negative, homonym/ambiguous, stale, missing-date and insufficient-evidence fixtures pass. |
| `TT-SD-007` | DONE | Only MATCHED and opted-in PROBABLE envelopes qualify. Existing tenant-scoped provider-run unique key is P2002 race-safe; concurrent workers reuse one queued run. |
| `TT-SD-008` | DONE | Bright Data comment dispatch reads TikTok parents only from accepted candidate envelopes, canonicalizes URLs, carries video ID/decision/scenario/policy snapshots, and fails closed without approved evidence. REJECTED/REVIEW candidates cannot dispatch. |
| `TT-SD-006`–`TT-SD-008` evidence | PASS | 4 targeted files / 70 tests; targeted ESLint; `typecheck:social` (4GB heap); `git diff --check`. |
| `TT-SD-009` | DONE | Offline paginator proves multi-page traversal, repeated/missing cursor and max-page guards, partial failure/resume from start, tenant/external-ID dedupe, and watermark ineligibility for partial coverage. Live Bright Data proof on 2026-07-18 used tenant keyword `Araz Supermarket` with discovery hard cap 10: all 10 candidates passed the tenant-term gate; candidate hash `3f0435c9e31f` declared 695 comments. Comments snapshot hash `72056e6e968d` used `collect_replies=true` and hard cap 100, returning 100/100 unique top-level IDs plus 114/114 unique nested reply IDs and 114 canonical parent links, with zero provider errors. Provider declared 118 replies, so the four unavailable rows remain a truthful coverage gap and cannot advance the watermark. Nested reply identity is normalized from the containing comment; raw text/authors remain uncommitted in production `/tmp`. PASS: 2 targeted files / 20 tests; targeted ESLint; `typecheck:social` (4GB heap); `git diff --check`. |
| `TT-SD-010` | DONE | Deterministic batch classifier accepts own tenant terms, enabled-scenario matches, contextual subject matches and replies to actionable comments; parent-publication relevance alone never promotes a generic comment. Bright Data stamps ACTIONABLE/CONTEXT/REJECTED reason codes. Context-only ancestors persist as durable REVIEW envelopes for thread interpretation, do not create `SocialMention`, execute workflows or inflate analytics; unrelated neighbours are rejected. PASS: 4 targeted files / 73 tests; targeted ESLint; `typecheck:social` (4GB heap); `git diff --check`. |
| `TT-SD-011` | DONE | Deterministic state machine enforces daily cadence for the first 7 days, 3-day cadence afterward, inactivity after 30 quiet days and generation-counted webhook/manual reactivation. Tenant-scoped Prisma state is bound to an approved envelope with composite organization identity; migration enables/FORCEs RLS and has no backfill. Only persisted MATCHED/opted-PROBABLE envelopes register. Bright Data comment dispatch consumes only bounded tenant+source due rows; provider completion reschedules by real newly-created deduped comments, not saturated hard-cap counts. PASS: 4 targeted files / 32 tests; targeted ESLint; Prisma validate/generate; `typecheck:social` (4GB heap); `git diff --check`. |
| `TT-SD-012` | DONE | Provider edits increment `contentVersion` and append immutable `SocialMentionVersion`; source-deletion observations mark the existing tenant/platform/external-ID mention ignored without recreating analytics. Deleted/purged content is excluded from report export and denied by outbound gates. Existing retention purge scrubs payloads, versions and drafts while completing tenant-scoped deletion-ledger tombstones. PASS: 4 targeted files / 43 tests; targeted ESLint; `typecheck:social` (4GB heap); `git diff --check`. |
| `TT-SD-013` | DONE | Review API returns a normalized, tenant-scoped audit trail: query, scenario IDs, matched terms, provider, coverage class, last complete page and rejection reason; raw policy/provider payloads are not exposed. The existing review queue renders the fields as a compact responsive definition list without changing resolution behavior. PASS: 1 targeted file / 7 tests; translation parity (16,834 keys, zero missing/extra); targeted ESLint; `typecheck:social` (4GB heap); `git diff --check`. Browser smoke NOT RUN: authenticated tenant browser context is unavailable in this worktree. |
| `TT-SD-014` | DONE | Application-level regression matrix rejects cross-tenant access at all paid boundaries: tenant query packs are disjoint; review candidates are filtered by authenticated organization; publication revisits require the same tenant-approved envelope; comment dispatch selects only tenant+source due parents; source/token carriers return 404 outside the tenant and encrypted tokens remain redacted; usage and Bright Data invoice reconciliation use composite organization identity. PASS: 7 targeted files / 54 tests; targeted ESLint; `typecheck:social` (4GB heap); `git diff --check`. |
| `TT-SD-015` | DONE — policy narrowed 2026-07-21 | Bright Data remains the sole external provider for Facebook and selective TikTok. Instagram now has a capability-scoped Apify exception for discovery and known-URL comments/replies after Bright Data proxy failures and a successful bounded Apify replies proof. TikTok keeps zero Apify primary/fallback routes. |
| `TT-SD-016` | PARTIAL — comments stage unproven | Product owner narrowed the production canary to the real `brandprotection` tenant; temporary Mars/AFI fixtures were removed and are not part of evidence. Production SHA `2168b0c9915ac0ac2ebc1ebd42b2286e36933655` (workflow `29678063610`) passed build, security gates, deploy, public ping and authenticated smoke. A single bounded manual run of existing tenant keyword `araz supermarket` used Bright Data only with a hard authorization ceiling of `$0.50`: discovery imported 10/10 schema-valid candidates, enrichment imported 2/2, and the collector completed `success` with 12 found, 4 new and 8 deduplicated. The relevance ledger contains two accepted VIDEO envelopes (`subject_alias_match`) and two pending candidate-boundary envelopes; no comments provider run was created because `READ_EXTERNAL_COMMENTS` compiled fail-closed to `MANUAL_TASK/BLOCKED` without a valid Bright Data comment proof. All TikTok v3 routes contain no Apify primary or fallback. Authenticated browser evidence shows the Araz card with the 07:41 run and 07:43:51 successful completion. External replies stayed disabled. After evidence capture, paid manual runs were disabled, emergency stop and zero budgets restored, Bright Data live routing returned to `0`, the tenant allowlist was cleared, and ping remained 200. **Owner decision 2026-07-19:** TT-SD-016 is not fully proven until the Bright Data **comments** stage passes a positive-path production canary (discovery → gate → comments only for MATCHED/opted-PROBABLE → actionable/context → tenant-isolated persistence/dedup/watermark → UI). That canary was **not** executed in the code-hardening session (no production access/admin credentials there); the exact, secret-free procedure and safety rails are in `docs/BRIGHTDATA-TIKTOK-CANARY-RUNBOOK.md`. |
| `TT-SD-017` | WAITING (observing) | Requires TT-SD-016 and 14 consecutive successful daily runs. Live routing and external replies remain disabled. Daily-run verification is automated by `evaluateSelectiveDiscoveryObservationDay` / `summarizeSelectiveDiscoveryObservationWindow`, including tenant isolation, no arbitrary scanning, no Apify on TikTok/Facebook or unapproved Instagram capabilities, comments only for ACCEPTED publications, dedup/watermark integrity and zero external replies. The window is **NOT STARTED**; trailing streak is 0/14. |

## 1. Product decision

TikTok monitoring must not enumerate arbitrary videos or scrape every available
comment. Once per day, each tenant searches only with its configured monitoring
terms. A second paid collection stage runs only for publications that pass the
relevance gate. Comments and replies are then filtered into actionable mentions
and bounded conversation context.

The pipeline is tenant-scoped end to end:

```text
tenant scenarios and keywords
  -> daily query expansion
  -> publication discovery
  -> candidate validation and relevance gate
  -> approved publication queue
  -> comments and replies pagination
  -> comment relevance plus thread context
  -> canonical SocialMention ingestion
```

This design cannot discover a brand name that appears only inside a comment on
an otherwise unrelated, undiscovered video. Supporting that case would require
broad comment surveillance and is explicitly out of scope.

## 2. Collection contract

### Publication discovery

- Build queries only from the tenant's active monitoring scenarios, aliases,
  handles, products, hashtags, domains, and approved query expansions.
- Apply negative terms before provider dispatch where supported and again after
  normalization.
- Search caption/description, hashtags, mentioned accounts, creator identity,
  and provider-supplied transcript or voice-to-text fields.
- Run once per 24 hours (`cadenceMinutes = 1440`).
- Resume from a successful provider watermark; do not infer coverage from the
  newest accepted mention.
- Store discovery output as candidate envelopes, not final mentions.

### Publication relevance gate

Each candidate receives one terminal decision:

- `MATCHED`: deterministic subject/alias evidence; eligible for comment collection.
- `PROBABLE`: AI/context evidence above the configured threshold; eligible only
  when the scenario explicitly opts into probable matches.
- `REVIEW`: ambiguous; no paid comment collection until approved.
- `REJECTED`: negative term, wrong entity, stale/out-of-window, or insufficient
  evidence; never sent to comment collection.

Every decision must retain reason codes, matched terms, scenario IDs, query,
provider, observed time, and policy snapshot.

### Selective comment collection

- Dispatch the TikTok comments provider only for `MATCHED` publications and
  explicitly opted-in `PROBABLE` publications.
- Use canonical video URL/video ID as the parent identity.
- Traverse comment and reply pages with repeated-cursor and maximum-page guards.
- Persist the provider watermark only after complete traversal or a truthful
  partial-coverage result.
- Dedupe by tenant, platform, and external comment ID; preserve parent comment,
  reply, thread, and video identities.
- Revisit active publications daily while new comments appear. After 7 active
  days, reduce to every 3 days; after 30 days without activity, stop revisiting.
  A webhook or manually supplied URL can reactivate the publication.

### Comment relevance and context

- Promote a comment to an actionable mention when it contains a tenant term,
  refers contextually to the matched subject, replies to an actionable comment,
  or matches an enabled risk/complaint/question scenario.
- Retain the parent comment and the minimum neighbouring reply chain needed for
  interpretation as context; context rows must not inflate mention analytics.
- Record why a comment was accepted, rejected, or retained as context.
- AI classification may assist relevance but cannot bypass deterministic tenant,
  freshness, acquisition-policy, or deletion gates.

## 3. Provider routing

Preferred execution order:

1. Approved official capability, when available.
2. Instagram only: pinned Apify discovery/comments actor for approved read capabilities.
3. Verified Bright Data discovery/comments capability.
4. Manual URL review task.

Apify is explicitly out of scope for Facebook and selective TikTok discovery/comment collection. Instagram is capability-scoped: `DISCOVER_POSTS` and `READ_EXTERNAL_COMMENTS` may use pinned Apify actors, while all other Instagram capabilities still fail closed if an Apify route leaks in. `enforceBrightDataOnlyPolicy` (`src/lib/social/source-route-plan.ts`, backed by `src/lib/social/bright-data-policy.ts`) enforces this at compile time and `dispatchRouteAdapter` repeats the check for legacy persisted plans.

Provider marketing claims do not enable a route. Every phase requires a versioned
capability proof, schema fixture, pagination evidence, and live-routing gate.

Daily scheduling does not itself bound cost. The application therefore enforces
one shared tenant ceiling across Bright Data and Apify: `$4` per run, `$4` per
UTC day and `$120` per month. Manual clicks and fallback consume the same
ceiling. Idempotency, maximum pages/items, timeout, rate-limit backoff, circuit
breaker and emergency stop remain independent safety controls.

## 4. Implementation backlog

| ID | Task | Dependency | Acceptance |
| --- | --- | --- | --- |
| `TT-SD-001` | Freeze the selective-collection contract and explicit blind spot | — | Product copy and API coverage state say that comment-only mentions on unrelated videos are not discoverable |
| `TT-SD-002` | Produce tenant query packs from active scenarios, aliases, negative terms and expansions | `001` | Two tenants generate disjoint provider payloads; empty/disabled scenarios dispatch nothing |
| `TT-SD-003` | Add stable query-pack version and dispatch idempotency key | `002` | Retrying the daily tick cannot start a duplicate paid discovery run |
| `TT-SD-004` | Configure TikTok discovery sources for a 1440-minute cadence | `002` | Due-time tests prove one scheduled discovery window per day and watermark catch-up without gaps |
| `TT-SD-005` | Enforce candidate-only TikTok discovery ingestion | `003` | Search snippets cannot create final `SocialMention` rows before enrichment/relevance proof |
| `TT-SD-006` | Implement publication relevance decision and reason codes | `005` | Positive, negative, homonym, stale, missing-date and ambiguous fixtures produce expected terminal decisions |
| `TT-SD-007` | Add atomic approved-publication comment queue | `006` | Only `MATCHED` and opted-in `PROBABLE` candidates enqueue; concurrent workers create one job |
| `TT-SD-008` | Bind Bright Data comment dispatch to the approved parent | `007` | Provider call always contains the canonical approved video ID/URL and tenant-scoped policy snapshot |
| `TT-SD-009` | Prove TikTok comments/replies pagination on a known-positive public video | `008` | Multiple pages, replies, parent IDs, repeated cursor, partial failure and resume are evidenced without duplicate rows |
| `TT-SD-010` | Add comment relevance versus context classification | `009` | Actionable mentions affect analytics; context-only rows preserve thread meaning but do not affect counts |
| `TT-SD-011` | Implement active-publication revisit lifecycle | `009` | Daily for first 7 days, every 3 days afterward, inactive after 30 quiet days, deterministic reactivation |
| `TT-SD-012` | Add deletion/edit reconciliation and retention behavior | `010` | Deleted source content is blocked from reply/export; edits version correctly; purge ledger remains complete |
| `TT-SD-013` | Expose coverage and collection reasons in UI/API | `006`,`010` | Operator sees query, scenario, matched term, provider, coverage class, last complete page and rejection reason |
| `TT-SD-014` | Add tenant isolation and paid-dispatch regression suite | `007`,`008` | Cross-tenant query, candidate, parent, comment, token and usage access is rejected |
| `TT-SD-015` | Confirm capability-specific provider policy | `009` | TikTok/Facebook cannot route to Apify; Instagram permits only discovery and known-URL comments/replies; shared cost controls remain authoritative |
| `TT-SD-016` | Production canary with live replies disabled | `011`–`015` | Daily discovery -> selective comments -> UI works for two tenants; no external reply is sent |
| `TT-SD-017` | Observation window and production promotion | `016` | 14 consecutive daily runs meet agreed coverage/error thresholds and rollback is rehearsed |

## 5. Verification matrix

Required automated checks:

- query generation and negative-term fixtures in AZ/RU/EN;
- no-dispatch tests for empty, disabled, rejected, review-only and wrong-tenant inputs;
- daily due-time, watermark, retry and idempotency tests;
- candidate-to-parent state-transition tests;
- multi-page comments/replies, cursor-loop, timeout and partial-resume tests;
- comment/actionable/context analytics tests;
- RLS and application-level cross-tenant tests;
- provider schema-drift and canonical cross-provider dedupe tests;
- purge, deleted-content and outbound fail-closed regressions.

Required live evidence before production promotion:

- one known-positive TikTok discovery query;
- one comment-rich video with more than one comments page and at least one reply;
- one true-zero query;
- one negative/homonym query;
- provider cost record and deletion proof;
- two-tenant browser smoke with live replies disabled.

## 6. Rollout and rollback

Roll out for one internal tenant, then one design-partner tenant, then the wider
cohort. Keep provider live-routing and each tenant source independently
switchable.

Rollback pauses the TikTok discovery source, disables the provider route, and
lets already imported observations remain subject to normal retention. It must
not delete connected accounts, scenario definitions, audit records, or provider
billing evidence.

## 7. Session ownership

Implement this backlog in a dedicated clean worktree/branch. The parallel Social
Monitoring readiness session may cherry-pick this planning commit, but should
not implement the same `TT-SD-*` IDs concurrently. Before coding, rebase on the
latest `origin/main`, claim a contiguous task slice, and record completed IDs and
verification evidence in this file.
