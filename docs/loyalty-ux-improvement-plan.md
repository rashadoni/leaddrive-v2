# Loyalty UX Improvement Plan

Date: 2026-06-29
Scope: Loyalty Program module, user-facing admin/operator experience
Audience assumption: non-technical tenant admins, marketing/ops managers, cashiers, and support agents.

## Why This Exists

The Loyalty module is functional and already split into its own tenant module, but the UX still feels like an admin configuration surface. A non-technical user can run it, but they need too much product knowledge: earn-rule math, tier multipliers, promo-code limits, POS manual points, and dashboard interpretation.

Target outcome: a tenant admin can launch a simple loyalty program without training, a cashier can award points without understanding rule configuration, and a manager can understand program health without reading documentation.

## Current UX Score

Overall usability for a non-technical user: **6.2/10**.

Main strengths:

- `Loyalty Builder` now acts as the module entry point.
- Launch checklist gives the first setup direction.
- Quick Start templates reduce empty-state fear.
- POS has a simple scan/manual lookup path.
- Dashboard widgets and module gating make Loyalty visible where it matters.
- Help articles and tours already exist for several Loyalty pages.

Main weakness:

- The module still exposes too much implementation language in primary workflows: trigger, priority, multiplier, rate, fixed points, ISO currency, usage limit, per-customer limit.

## Product Principles

1. **Business language first.** Primary UI should say what happens to the customer, not what database/rule concept is being configured.
2. **Guided setup by default.** Advanced forms can remain, but the normal path should be wizard/preset driven.
3. **Preview before save.** Every rule, tier, reward, and promo should show the expected customer outcome.
4. **Safe operations.** Cashier/support flows should prevent accidental point mistakes.
5. **Dashboard should recommend action.** It should not only show numbers; it should say what to do next.

## 7 Implementation Epics

### 1. Launch Readiness

Goal: make the Builder tell a non-technical admin whether the program is actually ready.

Atomic tasks:

- Extend the `Loyalty Builder` checklist beyond the current basic steps.
- Add derived statuses for:
  - tiers created;
  - at least one earn rule created;
  - at least one reward created;
  - customer portal enabled;
  - auto-earn enabled or explicitly skipped;
  - POS test completed;
  - at least one member exists.
- Add program status labels:
  - `Needs setup`;
  - `Ready to test`;
  - `Live`;
  - `Needs attention`.
- Add a single primary CTA: `Continue setup`.
- Make `Continue setup` jump to the next incomplete step.
- Add `Run POS test` CTA when minimum setup exists.
- Persist or infer POS test completion if practical; otherwise infer from first POS award transaction.
- Add i18n keys in `messages/en.json`, `messages/ru.json`, `messages/az.json`.
- Add unit test for derived launch status logic.

Acceptance criteria:

- Empty tenant sees one obvious next step.
- Admin can tell why the program is not ready.
- Checklist cannot say the program is ready while rewards/portal/POS are missing.

### 2. Earn Rules Wizard

Goal: make point earning understandable without knowing rule-engine terms.

Atomic tasks:

- Keep the existing earn-rules CRUD as advanced mode.
- Add a default wizard for creating a rule.
- Step 1: choose business scenario:
  - purchase;
  - signup;
  - referral;
  - birthday;
  - review/survey;
  - custom.
- Step 2: choose award type:
  - points per purchase amount;
  - fixed bonus.
- Step 3: show only fields relevant to that scenario.
- Move advanced fields behind `Advanced options`:
  - priority;
  - product category;
  - validity dates;
  - tier multiplier behavior.
- Add live preview:
  - example: `For a 100 AZN purchase, customer gets 100 points`.
- Add friendly validation messages.
- Add a warning when both `pointsRate` and `pointsFlat` are filled.
- Make rule list summaries read like sentences:
  - `Purchase: 1 point per 1 AZN, tier bonus applies`.
- Add tests for wizard payload generation.
- Update help article for earn rules.

Acceptance criteria:

- A business admin can create `1 point per 1 AZN spent` without seeing `pointsRate`.
- A signup bonus can be created with no irrelevant purchase fields.
- Advanced users still have access to the old power controls.

### 3. POS Flow

Goal: make cashier use safe and obvious.

Atomic tasks:

- Add purchase amount mode to POS.
- After member lookup, show:
  - current points;
  - tier;
  - purchase amount input;
  - suggested points.
- Calculate suggested points from active purchase earn rule.
- Show formula:
  - `100 AZN x 1 point = 100 points`.
- Allow manual override only behind a secondary control.
- Add reason default:
  - `POS purchase`.
- Warn when no matching earn rule exists.
- Show success state with:
  - awarded points;
  - new balance;
  - tier change if any;
  - `Next member` as primary action.
- Keep manual member code entry as fallback.
- Add tests for amount-to-points calculation and award payload.

Acceptance criteria:

- Cashier can award points by entering purchase amount, not by calculating points manually.
- User sees why the suggested points are correct.
- Manual override exists but is not the main path.

### 4. Tiers, Rewards, and Promo Codes Simplification

Goal: reduce configuration anxiety in the three most complex setup tabs.

Atomic tasks for tiers:

- Add tier preview card.
- Show example earning per tier.
- Replace or clarify `threshold` as `Points needed to reach this level`.
- Replace or clarify `multiplier` as `Bonus on earned points`.
- Add recommendation text near default seed button.
- Warn before changing thresholds in a live program.

Atomic tasks for rewards:

- Add rewards to launch readiness.
- Improve empty state:
  - `Without rewards, customers can earn points but have nothing to spend them on`.
- Add reward examples:
  - free coffee;
  - 10% discount;
  - gift item;
  - free delivery.
- Add preview:
  - `Customer sees this in the portal`.
- Warn if customer portal is enabled but no active rewards exist.

Atomic tasks for promo codes:

- Split form into sections:
  - code and discount;
  - restrictions;
  - validity period;
  - status.
- Replace raw ISO currency input with friendly currency select where possible.
- Add presets:
  - 10% discount;
  - welcome discount;
  - fixed amount discount.
- Add preview:
  - `Customer enters SUMMER25 and receives 10% off`.
- Explain usage limit vs per-customer limit inline.
- Improve delete confirmation to recommend deactivation first.

Acceptance criteria:

- Basic setup does not expose every advanced field at once.
- User sees customer-facing preview before saving.
- Dangerous edits have clear warnings.

### 5. Members and Account Detail UX

Goal: make member management feel like an operational workflow, not just a table.

Atomic tasks:

- Make member rows clearly clickable.
- Link member rows to loyalty account detail.
- Add quick actions where appropriate:
  - award points;
  - redeem points;
  - view history.
- Add filters:
  - tier;
  - active balance;
  - recent activity.
- Add sorting:
  - current balance;
  - lifetime points;
  - recently active.
- Add tier distribution chips above the table.
- Improve empty state to explain two paths:
  - award points at POS;
  - import/create contacts.
- On account detail, translate transaction type labels instead of showing raw `adjustment_credit`.
- Add stronger confirmation for large manual point operations.

Acceptance criteria:

- Support/admin can move from member list to action in one obvious click.
- Raw transaction labels do not leak into user-facing UI.
- Large manual changes feel intentionally guarded.

### 6. Dashboard Insights

Goal: make Loyalty Dashboard answer “what should I do next?”

Atomic tasks:

- Add `What to do next` insight block.
- Add insights for:
  - no members;
  - no earn rules;
  - no rewards;
  - portal disabled;
  - high earned points but low redemptions;
  - inactive program;
  - no recent transactions.
- Add health score:
  - Setup;
  - Activity;
  - Redemption;
  - Member growth.
- Add CTA per insight.
- Add plain explanation of:
  - available points;
  - lifetime points;
  - earned/redeemed/expired.
- Keep dashboard read-only.
- Add tests for insight generation logic.

Acceptance criteria:

- Dashboard does not only show metrics; it explains the next operational action.
- Empty/low-activity programs produce useful recommendations.

### 7. Copy, Navigation, and Verification

Goal: finish the UX pass without regressions.

Atomic copy tasks:

- Audit all Loyalty copy in `en`, `ru`, `az`.
- Move technical terms into advanced/help text:
  - trigger;
  - priority;
  - ISO 4217;
  - multiplier;
  - rate;
  - fixed.
- Build a consistent glossary:
  - Points;
  - Levels/Tiers;
  - Rewards;
  - Earn;
  - Redeem;
  - Customer portal;
  - POS/counter.
- Keep labels consistent between nav, builder tabs, help, and Cmd+K.
- Expand Cmd+K aliases only where users would naturally search.

Atomic verification tasks:

- Run `npm run i18n:check`.
- Run targeted ESLint for changed Loyalty files.
- Run targeted Vitest:
  - nav items;
  - dashboard widgets;
  - loyalty rules;
  - POS award/calculation;
  - templates;
  - launch readiness status.
- Run `git diff --check`.
- Run local production build when practical.
- Browser smoke:
  - `/loyalty/builder`;
  - `/loyalty/pos`;
  - `/loyalty/dashboard`;
  - `/settings/roles`;
  - `/settings/dashboard`.
- Check desktop and mobile viewport for Builder and POS.
- Commit path-scoped.
- Push/deploy only if checks are green or failures are clearly unrelated existing debt.
- Post-deploy smoke starts with `/api/v1/ping`.

Acceptance criteria:

- No missing translation keys.
- No new type/lint/test failures in touched areas.
- Browser smoke proves the primary flows render.
- Production deploy and smoke are reported if deploy is requested/authorized.

## Recommended Work Order

1. Launch Readiness.
2. Earn Rules Wizard.
3. POS Flow.
4. Tiers/Rewards/Promo simplification.
5. Members and Account Detail UX.
6. Dashboard Insights.
7. Copy, navigation, verification, commit, push/deploy.

## Autonomous Goal Prompt

Use this after `goal` when you want Codex to work autonomously until all 7 epics are done:

```text
Improve the Loyalty Program UX for non-technical users end to end.

Use docs/loyalty-ux-improvement-plan.md as the source of truth and complete all 7 implementation epics:
1. Launch Readiness.
2. Earn Rules Wizard.
3. POS Flow.
4. Tiers, Rewards, and Promo Codes Simplification.
5. Members and Account Detail UX.
6. Dashboard Insights.
7. Copy, Navigation, and Verification.

Work autonomously until the task is genuinely complete.

Rules:
- Work from a clean main worktree. If the main checkout is dirty, create/use a separate clean worktree.
- Do not touch unrelated dirty changes.
- Do not ask clarifying questions unless there is a P0 blocker, data-loss risk, unclear DB migration procedure, or conflict with someone else's changes.
- Prefer reasonable product/UX decisions from the existing code and the plan.
- Keep changes path-scoped.
- Do not use git add . or git add -A.
- Make checkpoint commits for logical slices.
- Preserve existing module gating and tenant/RLS safety.
- Do not remove existing Loyalty functionality unless the plan explicitly replaces it.
- For visible UI changes, verify real routes in browser when practical.
- Run npm run i18n:check for message changes.
- Run targeted ESLint and targeted Vitest for touched Loyalty files.
- Run git diff --check.
- Run build/typecheck where practical; if broad checks fail due to unrelated existing debt, document the exact unrelated files and continue targeted verification.
- After all 7 epics are complete and verification is green enough, commit path-scoped.
- If deploy is authorized in this task, push main, wait for GitHub Actions Deploy to Production, then smoke /api/v1/ping and Loyalty routes.

Final report must include:
- completed epics;
- files changed;
- checks run and results;
- known unrelated blockers, if any;
- commit SHA;
- push/deploy/smoke result if performed.
```

## Stop Conditions

Stop and report instead of guessing if:

- a database migration is required and no safe migration procedure is clear;
- a change could lose or corrupt loyalty points, transactions, rewards, or promo redemptions;
- another user's changes conflict with the Loyalty files being edited;
- production deploy fails or rollback is triggered;
- auth/tenant/RLS behavior becomes ambiguous.
