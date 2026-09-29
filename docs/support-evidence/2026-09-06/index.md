# Support UX evidence index — 2026-09-06 baseline, updated 2026-09-29

Status: **IN PROGRESS / RELEASE NOT ADMITTED**. This non-secret ledger restores
the original evidence index and supersedes its 2026-09-06 GitHub-startup blocker.
GitHub-hosted production builds and authenticated browser jobs now execute. The
complete pre-canary high-profile matrix is running; final-SHA canary,
data-profile and visual-comparison gates remain open.

Private artifacts contain authenticated screenshots and detailed reports and
remain in GitHub Actions with bounded retention. This index stores only run,
artifact, SHA, matrix and disposition metadata—never credentials, fixture
tokens, session cookies or private payloads.

## Canonical matrix

The inventory contains 28 static scenarios covering all 15 potentially visible
internal destinations plus Service Desk modes, ticket/complaint/knowledge
details and the customer portal/closure paths.

| Dimension | Required values |
| --- | --- |
| Roles | agent, manager, administrator, customer where applicable |
| Locales | AZ, RU, EN |
| Themes | light, dark |
| Viewports | 1440 × 900, 1024 × 900, 768 × 900, 375 × 812 |
| Input/environment | keyboard, real touch context, reduced motion, actual locale/theme |
| Data | empty/0, 5, 50, 500 and section-specific high |
| States | loading, populated, empty, no-results, error/retry, success, permission |

The all-scenario high-profile cross-product contains exactly 1296 unique cells:
agent 240, manager 384, administrator 552 and customer 120; 432 per locale,
648 per theme and 324 per viewport.

## Fail-closed evidence contract

Each cell records exact commit, application mode, tenant canary state, role,
locale, theme, viewport, profile and scenario together with:

- runtime/HTTP failures and actual environment state;
- Axe WCAG 2/2.1 A/AA findings, custom accessible-name checks, keyboard stops,
  touch target/hit-test results, alt text and duplicate IDs;
- primary-work top, immediately visible actions, horizontal overflow, rendered
  rows/cards, block and bordered-container counts;
- load p50/p75, filter p50/p75, interaction p75 and cumulative layout shift;
- screenshot hash/pixel comparison when an exact compatible baseline is named.

Unknown selections, blocked authentication, missing fixtures, an incomplete
matrix, environment mismatch, zero keyboard stops, accessibility failures,
overflow, primary work below the accepted boundary or missing comparable
baseline fail the workflow. Capture is baseline material, not a visual compare.

## Current run ledger

| Run | Exact SHA | Artifact | Matrix / result | Disposition |
| --- | --- | --- | --- | --- |
| `36517986339` | `39548ebcf` | `11013290414` | 48/54 static; all 17 operational reports green; 6 real accessibility failures | Diagnosed only; superseded by fixes |
| `36521929861` | `eba8827d1` | `11014102077` | 54/54 static and all 17 operational flow files green; all failure counters zero | Accepted aggregate source/build/flow gate |
| `36524694546` | `eba8827d1` | partial private artifact | 1134/1296 captured before exact 90-minute cancellation; 1072 passed, 32 real mobile findings plus timeout fallout | Diagnostic only; never accepted |
| `36533684517` | `7a70f8ddf` | private artifact | 66/66 affected mobile static cells green; mutating runners rejected multi-locale invocation | Static subset accepted; workflow conclusion not accepted |
| `36536483415` | `d56fd456f` | private artifact | 11/11 static; Service Desk 20/20, Templates 6/6, Routing 6/6; Entitlements 6/7 | Diagnosed stale disclosure interaction; not accepted as flow gate |
| `36539937236` | `379f6e787` | `11020852792` | 11/11 static and 39/39 selected operational results green; all failure counters zero | Accepted integrated mobile correction |
| `36542434997` | `7a0a45e5b` | pending | Full 1296 high/AZ-RU-EN/light-dark/four-viewport/read-only capture; source, fixture and production build steps green | Browser capture in progress; no pass claimed |
| `36548661987` | `38890a3b7` | none | Flag-on Macros request was replaced while a same-branch run occupied the concurrency group | Infrastructure scheduling cancellation, not product evidence; must rerun |
| `36548665133` | `38890a3b7` | pending | Flag-off, EN/dark/mobile, admin, Macros mutating evidence | Queued behind full matrix |

The workflow has a three-hour bound without reducing the matrix. The earlier
90-minute artifact is retained only to prove which product defects were found;
connection-refused/blocked cells after its runner shutdown are not reclassified
as application failures or passes.

## Accepted current evidence details

### Aggregate and corrected mobile flows

- Run `36521929861` has zero runtime, Axe, custom accessibility, touch,
  overflow, environment, primary-work, missing-alt, duplicate-ID and
  zero-keyboard-stop failures. Representative corrected Ticket Detail, Skill
  Routing and customer closure screenshots were manually inspected.
- Run `36539937236` proves the collapsed Entitlements filter is reached through
  its visible 269 × 44 px disclosure target. Its flow records
  `filtersExpanded=true`, intended no-results state and keyboard reset. Maximum
  selected primary-work top is 709 px.
- Representative RU/dark Ticket Detail, EN/light Entitlements, AZ/dark
  Entitlement Templates, RU/light Skill Routing and EN/light Service Desk
  mobile captures were manually inspected with no clipped or hidden primary
  work.

### Source evidence at canary checkpoint `38890a3b7`

- AZ/RU/EN parity: 23,741 keys each.
- Tenant rollout, API/category, Macros UI, evidence-seed/runner and browser
  contract suites: 77/77 assertions across six files.
- Scoped ESLint: zero errors/warnings.
- Macros anti-pattern scan: one visible TSX file, zero findings.
- Browser and Macros runner syntax plus `git diff --check`: green.
- Full TypeScript, production build and flag-on/flag-off browser work on this
  SHA are **NOT RUN locally** and remain mandatory in GitHub Actions.

## Visual and performance acceptance still required

1. Download and audit the complete `36542434997` artifact; require all 1296
   unique cells and zero failure counters.
2. Run Macros mutation evidence on `38890a3b7` or its final descendant with the
   canary both enabled and disabled; inspect the recorded persistence mode and
   add/rename/delete/undo results.
3. Run section-scoped profile evidence for 0, 5, 50, 500 and high.
4. Capture a final seven-sample representative baseline and compare the exact
   same matrix/canary state on the final source SHA. Any material screenshot,
   timing, density, primary-work or CLS regression is blocking.
5. Replace pending rows with immutable artifact IDs, counts and manual-review
   disposition before checking `SUPUX-EVD-*` or `SUPUX-PERF-*` complete.

## Release boundary

No row here authorizes merge or deploy. Protected PR checks, current-main
reconciliation, documented GitHub Actions deployment and post-deploy exact-SHA
smoke remain separate mandatory gates. Canary and rollback semantics live in
[`docs/support-ux-performance-and-rollout.md`](../../support-ux-performance-and-rollout.md).
