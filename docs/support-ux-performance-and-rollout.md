# Support UX performance and rollout contract

Status: **IN PROGRESS**. This contract is the release authority for the Support
UX branch. A source checkpoint, capture-only artifact, or successful deployment
does not by itself satisfy the comparison, canary, observation, or rollback
gates below.

## Performance measurement

The SHA-bound GitHub Actions browser evidence runner is the canonical harness.
Contabo is limited to small sequential source checks; production builds and
browser matrices run in the isolated GitHub fixture environment.

Every evidence result records the exact commit, application mode, tenant canary
state, data profile, scenario, role, locale, theme and viewport together with:

- three or seven load samples and their p50/p75;
- filter feedback p50/p75, Event Timing p75 and cumulative layout shift;
- primary-work top, immediately visible actions, rendered rows/cards, top-level
  and bordered-container counts, document size and horizontal overflow;
- runtime/HTTP failures, keyboard stops, touch capability, actual locale/theme/
  reduced-motion state and WCAG 2/2.1 A/AA Axe results;
- a dimension-sensitive pixel comparison when an exact compatible baseline is
  supplied.

Seven samples after the runner warm-up are mandatory for a comparable p75. A
comparison is invalid unless commit-independent dimensions match: production
application mode, fixture profile/revision, canary state, scenario, role,
locale, theme, viewport and sample count.

### Relative release gates

- Load p75 may not regress by more than 10% or 100 ms, whichever allowance is
  larger.
- Filter p50 and interaction p75 may not regress by more than 10% or 50 ms,
  whichever allowance is larger.
- CLS may not regress by more than 10% or 0.001, whichever allowance is larger.
- Primary work may not move below its accepted baseline.
- Horizontal overflow remains zero at 375 px.
- Rendered rows/containers may not grow for an identical fixture unless an
  approved data-contract exception records the additional useful content.
- Runtime, accessibility, environment and missing-baseline failure counts remain
  zero. Capture mode is never called a comparison pass.

### Measured Service Desk repeatability budgets

Runs `34241690941` and `34247698584` measured the same production build at SHA
`52045c9e793744d7f89c883487b8616d8d71bd55` with seven samples across 96
AZ/RU/EN, light/dark and four-viewport cells. Identical visual/structural output
still produced timing spread, so a result fails only when it exceeds both the
relative allowance and the measured ceiling below.

| Scenario | Load p75 ceiling | Filter p50 ceiling | Interaction p75 ceiling |
| --- | ---: | ---: | ---: |
| Service Desk list | 650 ms | 200 ms | 250 ms |
| Service Desk Kanban | 600 ms | n/a | n/a |
| Service Desk reports | 700 ms | 200 ms | 150 ms |
| Ticket Detail | 600 ms | n/a | n/a |

Evidence owner: repository owner `rashadoni`. Review/expiry: 2026-10-08 or any
earlier fixture, builder-topology or application data-contract change. A slower
feature build must never redefine its own ceiling.

A data-contract exception requires exact before/after metrics, additional
records/controls, user benefit, accountable owner, approval and expiry date.

## Profile coverage

The final branch must exercise `0`, `5`, `50`, `500` and section-specific
`high` fixtures. Full cross-product visual coverage is required for `high`;
smaller profile runs may be section-scoped but must retain exact role, viewport,
locale, theme and commit metadata. Pagination or virtualization is introduced
only when measured DOM/rendering behavior requires it.

The final measured profile set uses Service Desk and VoIP for agent, manager
and administrator at desktop/mobile, EN/light, canary enabled and seven samples
per cell. Every run passes 12/12 production cells.

| Profile | Run / artifact | Service Desk load p75 max | VoIP load p75 max | Rendered Service Desk | Rendered VoIP | Disposition |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 0 | `36554107100` / `11027089469` | 401 ms | 462 ms | 1 empty row | 0 | Accepted |
| 5 | `36555323681` / `11029402390` | 314 ms | 375 ms | 4–5 | 5 | Accepted |
| 50 | `36557478393` / `11030325874` | 480 ms | 547 ms | 20 | 25 | Accepted |
| 500 | `36559389503` / `11030487883` | 332 ms | 341 ms | 20 | 25 | Accepted; VoIP `500 total / 20 pages / 25 rendered` matched in all six cells |

Worst filter p75 is 42 ms for Service Desk and 400 ms for the intentionally
debounced VoIP filter. Worst interaction p75 is 40 ms; maximum CLS is
`0.011741124511635809`; maximum primary-work top is 615 px for Service Desk and
704 px for VoIP. All profile runs have zero failed result, runtime, Axe, custom
accessibility, touch, overflow, environment or primary-work gate. The
500-record fixture stays bounded by existing server/client pagination, so the
measurement does not support adding virtualization. Empty, small, medium and
large desktop/mobile captures were manually accepted.

## Independent rollback boundaries

The implementation history is intentionally checkpointed by slice. Recovery is
a new reviewed branch that reverts only the affected checkpoints; never reset
`main`, delete persisted tenant state, copy a worktree to production, or deploy
outside GitHub Actions.

| Boundary | Representative implementation checkpoints | Recovery property |
| --- | --- | --- |
| Shared shell/foundation | `b8a9f0c08` through `7a70f8ddf` | Presentation-only commits are independently revertible |
| Service Desk / Ticket Detail | `4da1a5fc4`, `4b61b375d`, `4cc705d9a`, `a959654ef` | Additive API fields may remain during UI rollback |
| Complaints / customer portal | `645919ac2`, `6f80377ac`, `737dc6427`, `bcc5ea52c` | Drafts remain namespaced; security projections are never widened |
| Agent Desktop / VoIP | `fa85acf70`, `889143660`, `fe44dee68` | Same-scope aggregates remain compatible |
| Knowledge / routing / policy pages | `a0a68b220`, `3946aa28b`, `61d4087eb`, `27c571df4`, `d002818b8`, `b0fbbac1f`, `4e0600bf7`, `8f8ca41d8` | Each surface can be reverted without schema deletion |
| Macros presentation/API | `f53e88a8b`, `13eaf2bb1` | Existing macro records remain readable |
| Macros category state migration | `38890a3b7` | Tenant flag selects DB or browser-storage contract without deleting either |
| Portal users / Support AI / navigation | `7d80d25e4`, `b280e6c83`, `5f46b72d5` | Access gates remain strict in every state |
| Evidence/performance harness | `1624cd66f` through `38890a3b7` | Harness may be repaired without changing product thresholds |

## Tenant canary boundary

Flag: `support_ux_v2_canary` in the authenticated organization's existing
feature array. The flag is intentionally not exposed through the ordinary
tenant AI-feature toggle allowlist.

Current-main reconciliation established:

- Work/Team/Rules Support navigation already exists on `main`; this release
  does not pretend to canary a previously shipped information architecture.
- Shared-shell/density work is presentation-only and independently revertible.
- Entitlement, API and access changes are additive compatibility or
  authorization hardening. Tenant/RBAC/direct-route/security checks remain
  enforced and cannot be disabled by a rollout switch.
- The actual persisted-state migration is Macros custom categories: the prior
  UI stored them per organization in browser storage; v2 stores them in tenant
  organization settings and atomically updates matching macros.

### Flag off / unreadable / malformed

- `/api/v1/support/ux-rollout` returns `enabled: false`, or the client treats a
  failed response as false.
- Macros reads remain available under the same role and tenant permissions.
- Category add/rename/delete uses structurally validated
  `macro-categories-{organizationId}` browser storage and authorized legacy
  macro updates.
- Direct requests to the shared category mutation API fail closed with
  `SUPPORT_UX_CANARY_DISABLED`; no organization settings are written.
- Tenant DB categories are retained for a future re-enable and never copied to
  another tenant.

### Flag on

- The no-store rollout endpoint must explicitly return `enabled: true`.
- Category mutations re-read the authenticated tenant's feature state inside
  their serializable transaction.
- Shared custom categories live in organization settings; rename/delete update
  only matching macros in the same tenant.
- Removing the flag during a session rejects the next v2 write; a reload or the
  rejection recovery path returns the client to browser mode.

The isolated fixture and artifact both record `enabled` or `disabled`.
Visual/performance comparison rejects a baseline from the other state.

### Admitted source proof

Both modes are proven on the same source SHA
`0498d3a857e2230be2db20e85525a728587d5032`:

- flag off: run `36551225927`, artifact `11025885144`, one production static
  cell and 6/6 Macros flows green; the category journey records browser mode,
  browser rollback surface, rename, undo and completed delete;
- flag on: run `36552953697`, artifact `11027281153`, one production static
  cell and 6/6 Macros flows green; the same journey records tenant mode,
  organization category surface, retained input/retry, rename, undo, completed
  delete and restored keyboard focus.

Both modes have zero runtime, Axe, custom accessibility, touch, overflow,
environment and primary-work failures. The rollback captures were manually
reviewed. This admits the source boundary for release; it does not enable a
production tenant or start the observation window.

## Canary admission order

1. Scoped lint, tests, runner syntax, translation parity and anti-pattern scan.
2. CI strict TypeScript graphs, isolated fixtures and production build.
3. Role, permission, add-on, direct-route and tenant-isolation regressions.
4. Flag-on and flag-off Macros mutation evidence, including add, rename,
   delayed-delete undo and completed delete.
5. Complete high-volume responsive/theme/locale coverage.
6. Seven-sample compatible capture and compare with no unresolved regression.
7. Merge only after all protected PR checks are green.
8. Deploy only from reviewed `main` through `.github/workflows/deploy.yml`.
9. Verify `/api/v1/ping`, exact build-info artifact SHA and read-only Support
   routes before any production tenant flag is enabled.

## Observation and flag removal

Shipping code with every production tenant flag off is reversible deployment,
not completed canary observation. Enabling a representative tenant is a
separate audited configuration action. Flag removal is a later release and is
intentionally deferred until all conditions hold:

- at least seven complete calendar days on a representative authorized tenant;
- zero unresolved P0/P1 Support regression;
- stable error and latency evidence against the admitted baseline;
- repeat permission/isolation checks;
- approved release-ledger entry and separately green PR/deploy.

## Release ledger

| Field | Value |
| --- | --- |
| Slice / PR / merge SHA | Pending final PR and protected merge |
| Production artifact SHA | Pending GitHub Actions deploy |
| Canary tenant and flag | No production tenant enabled; `support_ux_v2_canary` defaults off |
| Evidence artifacts | Full 1296/1296 run `36542434997`, artifact `11024298303`; canary off `36551225927`/`11025885144`; canary on `36552953697`/`11027281153`; profiles 0/5/50/500 runs `36554107100`, `36555323681`, `36557478393`, `36559389503` |
| Roles / profiles | Agent, manager, admin, customer; high and measured 0/5/50/500 accepted |
| Baseline / compare | Final seven-sample pair pending |
| Production smoke | Pending deploy |
| Observation | Not started; removal gate deferred by policy above |
| P0/P1 incidents | None recorded before release |
| Owner | Repository owner `rashadoni` |
| Rollback | Remove tenant flag first; revert affected checkpoint through reviewed `main`; preserve DB state |

This ledger is updated with immutable run, PR, merge, deploy and smoke IDs as
each gate actually completes. Pending entries are never interpreted as passes.
