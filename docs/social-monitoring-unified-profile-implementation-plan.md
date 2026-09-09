# Social Monitoring — Unified Profile Implementation Plan

Date: 2026-07-14
Branch: `claude/social-monitoring-unified-setup`
Spec: `docs/social-monitoring-unified-profile-spec.md`

Status legend: `TODO` · `IN_PROGRESS` · `DONE` · `BLOCKED`

Rules for every slice: targeted tests → social typecheck → ESLint on changed
files → `git diff --check` → path-scoped commit. `npm run i18n:check` after any
`messages/*.json` change. No `git add -A`. No paid provider calls. No live-send.

---

## Slice 1 — Contracts and unified profile view model

**Status: DONE**

- Files: `src/lib/social/monitoring-profiles.ts` (new),
  `src/lib/social/monitoring-profile-schema.ts` (new).
- Behavior: define `MonitoringProfileView`, `MONITORING_PROFILE_DIRECTIONS`,
  and the derived profile status table (spec §9). Pure functions only — join
  subjects + scenarios into profiles, no writes.
- Tests: `src/__tests__/lib-social-monitoring-profiles.test.ts` — status
  derivation incl. subject-without-scenario → `needs_resume`.
- Risks: status derivation disagreeing with existing subject/scenario statuses.

## Slice 2 — API orchestration

**Status: DONE**

- Files: `src/app/api/v1/social/monitoring-profiles/route.ts` (new),
  `src/app/api/v1/social/monitoring-profiles/[id]/route.ts` (new).
- Behavior: `GET` list, `POST` create/reuse, `PATCH` update/pause/resume/stop.
  Locked identity claim plus atomic scenario/source/link orchestration per spec §11.
  Auth + org scoping consistent with sibling social routes.
- Duplicate safety: implemented as **reuse on exact normalized name** rather
  than a client-supplied idempotency key. The normalized-name claim and scenario
  read-modify-write both use PostgreSQL advisory locks, so this also covers a
  concurrent second operator typing the same brand, not just a retry.
- Tests: `src/__tests__/api-social-monitoring-profiles.test.ts` — auth, org
  scoping, create, reuse, compensation on scenario-persist failure.
- Risks: partial entities on failure; org-scope leaks.

## Slice 3 — Single-source search terms

**Status: DONE**

- Files: `src/lib/social/monitoring-profiles.ts`,
  `src/lib/social/monitoring-scenarios.ts`.
- Behavior: `deriveScenarioSearchFromSubject()` — subject aliases become the
  scenario query (spec §5 mapping table). Ownership inverts to
  subject → scenario. `syncScenarioSubjectAliases()` retained for legacy
  additive adoption.
- Tests: alias-kind → search-field mapping; NEGATIVE/CONTEXT excluded from
  query; no second name entry required.
- Risks: dropping legacy scenario-only terms. Mitigation: additive adoption,
  never delete.

## Slice 4 — Provider dedupe

**Status: DONE**

- Files: `src/lib/social/monitoring-profiles.ts`, tests.
- Behavior: enabling both directions yields exactly one managed source set and
  one collection plan. Directions excluded from the plan key by construction.
- Tests: **regression** — toggling directions leaves `scenarioSourceTargets()`
  output and `archiveMatchSignature()` byte-identical.
- Risks: a future edit leaking `ai.directions` into source/archive keys — the
  regression test is the guard.

## Slice 5 — Archive reuse

**Status: DONE**

- Files: `src/lib/social/monitoring-profiles.ts`.
- Behavior: adding a direction re-classifies stored data; no provider run for
  already-collected data. `partial` backfill does not block activation.
- Tests: direction added → archive signature unchanged → no re-backfill, no
  collector call.
- Risks: accidental archive invalidation on unrelated profile edits.

## Slice 6 — Legacy compatibility

**Status: DONE**

- Files: `src/lib/social/monitoring-profiles.ts`.
- Behavior: legacy scenarios keep working; scenario-only terms adopted into
  subject aliases once, additively; `includeExternalComments: null` preserved;
  `legacyScenarioId` attachment honored.
- Tests: legacy scenario without `subjectId`; `null` comment state survives a
  profile save (must not become `true`).
- Risks: silently starting paid comment scraping — explicitly tested.

## Slice 7 — New three-step wizard

**Status: DONE**

- Files: `src/components/social/monitoring-profile-wizard.tsx` (new).
- Behavior: full-width work area, 1–2–3 progress, name typed once, local
  suggestions, platform/source/direction selection, summary, launch. Advanced
  settings collapsed (spec: AI confidence, languages, geography, required
  context, exclusions, negative aliases, archive start date, AI actions, reply
  identity, reply mode).
- Tests: covered via i18n + typecheck + browser smoke.
- Risks: `"use client"` boundary → production build required.

## Slice 8 — Unified monitoring cards

**Status: DONE**

- Files: `src/components/social/monitoring-profile-list.tsx` (new),
  `src/app/(dashboard)/social-monitoring/page.tsx`.
- Behavior: one card per profile with status, platforms, directions, sources,
  archive count, last update, comment coverage, provider state, and actions
  (open/edit/pause/resume/stop/advanced). Internal terms hidden.
- Risks: AGENTS.md — do not remove existing UI sections without approval. The
  legacy Objects/Scenarios surfaces are therefore **kept**, not deleted; the
  unified section is added as the primary entry point.

## Slice 9 — Archived / paused profiles

**Status: DONE**

- Files: wizard + list components, `monitoring-profiles.ts`.
- Behavior: `needs_resume` profiles surface in Archive with a Resume action and
  are excluded from the active list; resume reuses aliases/sources/archive.
- Tests: Bahruz Şiraliyev acceptance path.

## Slice 10 — i18n and accessibility

**Status: DONE**

- Files: `messages/az.json`, `messages/ru.json`, `messages/en.json`.
- Behavior: every new string localized, az primary; labels, focus order,
  keyboard nav, disabled-reason text.
- Tests: `npm run i18n:check`.

## Slice 11 — Tests and browser smoke

**Status: DONE**

- Behavior: full targeted suite green; local browser smoke of the wizard.
- Browser smoke RUN (2026-07-15, local dev server + fresh `leaddrive_uxtest` DB,
  isolated seeded org): empty state → wizard 3 steps → Araz launched (toast,
  card, DB: 1 subject / 1 scenario / 8 sources / 0 dupes) → duplicate-name
  warning → Bahruz with ş→s transliteration → scenario deleted via SQL →
  `needs_resume` in Archive section → Resume → active again, 20 sources total,
  0 dupes, **0 provider runs for the entire session**. Mobile 375px, dark
  theme, RU locale verified.
- Bugs FOUND BY the smoke and fixed (all invisible to unit tests/i18n:check):
  1. i18n block spliced into `tour.socialMonitoring` instead of top-level
     `socialMonitoring` (substring anchor matched the nested key first);
     parity check passed because the misplacement was consistent across all
     three locales — only the browser caught it.
  2. Card date not localized (`toLocaleDateString()` without locale).
  3. Mobile blowout: grid item `min-width:auto` + non-shrinking flex `dd`
     pushed cards to 355px on a 375px viewport → `min-w-0` on the card article
     and dl values.
- Verification notes (recorded rather than assumed):
  - Final lifecycle regression (2026-07-15): an existing Araz profile restored
    its 4 platforms, 2 directions, comment setting and exactly 8 linked sources;
    Pause moved the canonical scenario and all 8 managed collectors to paused;
    Resume restored the same collection plan without duplicates or provider runs.
  - Mobile 375x812 smoke: cards and the three-step wizard remained within a
    375px document width (`scrollWidth === clientWidth`), including source cards.
  - `npx next build` was run with a build-only `NEXTAUTH_SECRET` because the
    isolated worktree intentionally has no runtime secrets. It exited 0 after
    compiling the project and generating all 786 pages. Existing Serwist,
    Sentry and broad file-tracing warnings remain outside this PR's scope.

## Slice 12 — Release readiness

**Status: DONE**

- Completed: 19 targeted files / 160 tests, social typecheck, changed-file
  ESLint, translation parity (16,299 keys), diff check, production build
  (786/786 pages), authenticated desktop/mobile browser smoke, and PR #331
  update. The browser smoke did not start provider runs or send external data.
- Not done by design: no merge, no deploy.

- Behavior: `npx tsc --noEmit`, ESLint on changed files, `npm run build` (client
  boundary touched), i18n check, push branch, open PR (no merge, no deploy).
- Verify GitHub Actions status via the GitHub API and real job logs — never via
  background-monitor messages.

---

## Acceptance criterion → implementation → test → status

| Criterion | Implementation | Test | Status |
| --- | --- | --- | --- |
| Name typed once, never restated | `deriveScenarioSearchFromSubject()` — `monitoring-profiles.ts` | `lib-social-monitoring-profiles` "derives the collection query…"; `…-orchestration` "derives the collection query from the subject…" | DONE |
| Two directions ≠ two provider collections | `ai.directions[]` excluded from `scenarioSourceTargets()` | `lib-social-monitoring-directions` "builds an identical source set…" (mutation-checked) | DONE |
| Adding a direction ≠ re-scrape | `ai.directions[]` excluded from `archiveMatchSignature()` | `lib-social-monitoring-directions` "keeps the archive signature stable…" (mutation-checked) | DONE |
| Archive consulted first | `backfillMonitoringScenarioFromArchive()` (local-only) reused unchanged | `lib-social-monitoring-scenario-archive` (existing suite still green) | DONE |
| One subject/profile reused, no duplicate | `findSubjectIdByName()` exact-normalized reuse | `…-orchestration` "reuses a same-named profile…" / "does not absorb a genuinely different name…" | DONE |
| One collection plan created | `createOrUpdateMonitoringProfile()` | `…-orchestration` "creates exactly one subject and one collection plan" | DONE |
| One card per profile | `monitoring-profile-list.tsx` | `lib-social-monitoring-profiles` `buildMonitoringProfileView` | DONE |
| Live-send stays off | `liveSendAllowed: false` structural in view + scenario | `…-orchestration` "never enables live send"; API "rejects an unknown field" | DONE |
| Bahruz: archived, not confusingly active | `deriveProfileStatus()` → `needs_resume` | `lib-social-monitoring-profiles` "reports a subject without any scenario…" | DONE |
| Bahruz: resumable, aliases + archive reused | `resumeMonitoringProfile()` | `…-orchestration` "rebuilds the collection plan from the vocabulary already stored" | DONE |
| No paid call for suggestions | `suggestProfileAliases()` pure string work | `lib-social-monitoring-profiles` "proposes local spelling variants without any provider call" | DONE |
| Legacy `null` comments not coerced to `true` | wizard omits the field unless opted in | API "omits includeExternalComments when the operator made no choice" | DONE |
