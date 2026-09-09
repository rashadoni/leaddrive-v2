# Selective TikTok/YouTube discovery — observation window log

Evidence log for the observation windows that gate `TT-SD-017` (14 consecutive
successful daily runs) and `YT-SD-008` (observation window and promotion). This
is an evidence log, **not** a claim that either window has passed. Neither task
may be marked DONE until the real window has elapsed and the owner signs off.

Scope: tenant **brandprotection** only. No other tenant. No Mars/AFI. External
replies stay disabled for the entire window.

## How a day is judged

Each observed tenant-day is evaluated by the deterministic invariant evaluator
`evaluateSelectiveDiscoveryObservationDay`
(`src/lib/social/selective-discovery-observation.ts`, tests
`src/__tests__/lib-social-selective-discovery-observation.test.ts`). A day
**counts** toward the window only when it both had a successful collector run and
passed every applicable invariant:

| # | Invariant id | Requirement |
| --- | --- | --- |
| 1 | `tenant_isolation` | Every row belongs to the brandprotection org |
| 2 | `no_arbitrary_scanning` | Provider runs/envelopes bound to a scenario-managed source |
| 3 | `no_apify_external_routes` | TikTok/Facebook are Bright Data-only; Apify is allowed only for Instagram discovery/comments |
| 4 | `comments_only_for_matched` | Comment runs target ACCEPTED (MATCHED / opted-in PROBABLE) parents only |
| 5 | `no_review_rejected_dispatch` | REVIEW/REJECTED/POLICY_DENIED/PENDING parents never dispatched |
| 6 | `dedup_and_watermark` | Duplicates deduped; partial/failed runs never advance the watermark |
| 7 | `external_replies_zero` | No external reply dispatched; no live external reply route active |

`summarizeSelectiveDiscoveryObservationWindow` computes the trailing streak of
counting days. `TT-SD-017` requires a 14-day trailing streak.

## Start gate

- Observation harness landed: commit `bd5f40811`; Apify-exclusion hardening
  (`enforceBrightDataOnlyPolicy` + `bright-data-policy.ts`) landed: commit
  `327937a6a` — both on branch
  `claude/selective-tiktok-youtube-discovery-841168` (observation 18 tests PASS;
  route-plan hardening broad sweep 8 files / 115 tests PASS; targeted ESLint
  PASS; `typecheck:social` clean for the new/changed files — only the three
  pre-existing `coverage-slo.ts` implicit-any errors remain).
- Production baseline SHA at window setup: `2f566d969` (PR #424 merged, deploy
  workflow `29679365591` succeeded, `/api/v1/ping` = 200).
- Post-canary safety posture confirmed by prior block:
  `SOCIAL_BRIGHT_DATA_LIVE_ROUTING=0`, `SOCIAL_BRIGHT_DATA_LIVE_TENANT_IDS`
  empty, paid manual runs disabled, `emergencyStopped=true`, `maxPerRunUsd=0`,
  `dailyBudgetUsd=0`, `monthlyBudgetUsd=0`.

### Owner decision (2026-07-19) and execution blocker

The owner authorized a **bounded positive-path TikTok canary** for the
brandprotection tenant that must exercise the Bright Data **comments** stage
(discovery → gate → comments only for MATCHED/opted-PROBABLE → actionable/context
→ tenant-isolated persistence/dedup/watermark → UI), and directed that
`TT-SD-016` is not fully proven until that canary passes. The exact, secret-free
procedure with all safety rails is in
`docs/BRIGHTDATA-TIKTOK-CANARY-RUNBOOK.md`.

The canary was **NOT executed** in the code-hardening session: that session had
no production SSH access (blocked by policy) and no admin credentials, and the
canary requires a temporary routing flip plus real (bounded) Bright Data spend.
Executing it requires a session/operator with production access, or the owner.

Until the canary runs, the window is **NOT STARTED**; Day 0 below records the
harness + Apify-exclusion hardening readiness and the safety posture only.

## TikTok observation window (`TT-SD-017`)

Required: 14 consecutive counting days.

| UTC day | Successful run? | Failing invariants | Counts? | Reviewer | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-07-19 (Day 0) | — | — | no | Claude (autonomous) | Harness + Apify-exclusion hardening landed; live routing disabled, budgets 0. No paid daily run executes yet — window not started. Owner authorized the positive-path comments canary (see runbook); execution blocked on production access/credentials in this session. |

Trailing streak: **0 / 14**. Window satisfied: **no**.

## YouTube observation window (`YT-SD-008`)

Required: owner-agreed observation window, then a promotion decision.

| UTC day | Successful run? | Failing invariants | Counts? | Reviewer | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-07-19 (Day 0) | — | — | no | Claude (autonomous) | Historical v1 evidence: prior `YT-SD-007` was a truthful zero-fresh-result canary under the then-current 48-hour gate (`stale_publication` REJECTED, comments endpoint never called). The observation window must restart under `youtube-publication-gate-v2`, whose search and eligibility window is seven days. |

## Rollback rehearsal (`TT-SD-017` acceptance)

Rollback per plan §6 pauses the discovery source, disables the provider route,
and leaves imported observations to normal retention (no deletion of accounts,
scenarios, audit, or billing evidence).

- Rehearsal status: **NOT RUN** in this block. To be executed as a dry-run once
  the observation window starts, and recorded here with the exact steps used to
  return `SOCIAL_BRIGHT_DATA_LIVE_ROUTING=0`, clear the tenant allowlist, set
  `emergencyStopped=true`, and confirm `/api/v1/ping=200`.

## Pass criteria (do not check off early)

- 14 consecutive counting TikTok days (all seven invariants pass, real
  successful run each day).
- YouTube observation window agreed with the owner and satisfied.
- Rollback rehearsed and recorded.
- Owner sign-off recorded here.

Only after all of the above may `TT-SD-017` / `YT-SD-008` move from WAITING.
