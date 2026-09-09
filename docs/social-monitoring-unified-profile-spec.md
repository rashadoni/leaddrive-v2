# Social Monitoring — Unified Monitoring Profile Spec

Date: 2026-07-14
Status: ACCEPTED (implementation in progress)
Branch: `claude/social-monitoring-unified-setup`
Related: `docs/social-monitoring-ux-audit-2026-07-05.md`,
`docs/social-monitoring-provider-routing-roadmap.md`,
`docs/social-monitoring-unified-profile-implementation-plan.md`

## 1. Problem

Setting up monitoring today requires the operator to understand and populate two
separate internal concepts:

1. **Monitoring Object** (`MonitoringSubject`) — brand/person card with
   `aliases`, `sources`, `replyIdentities`, languages, geographies,
   `requiredContext`, `exclusions`.
2. **Monitoring Scenario** (`MonitoringScenario`) — collection + action config
   with `platforms` and `search.{topics,keywords,hashtags,handles,urls}`.

Consequences observed in the current product:

- The operator types the same brand name and the same search words **twice** —
  once as the subject name/aliases, once as the scenario topics/keywords.
- The two term sets can drift. Today `syncScenarioSubjectAliases()`
  (`src/lib/social/monitoring-scenarios.ts`) papers over the drift by mirroring
  scenario words **into** subject aliases on every save. That makes the
  *scenario* the de-facto owner of the vocabulary, while the *subject* is the
  thing every acceptance matcher (feed gate, media OCR, comment inheritance)
  actually reads.
- A subject whose scenario was deleted stays "active" in the subject list but
  collects nothing. It is indistinguishable from a working monitor.
- The UI exposes the internal split as two user-facing tabs
  ("Objects" / "Scenarios"), so the mental model leaks to the user.
- The 2026-07-05 UX audit independently scored information architecture 1/4 and
  called for a workflow redesign rather than a visual polish pass.

## 2. Target user

**SMM/PR manager.** Not a data engineer. They think in terms of *"I want to know
what people say about Araz Supermarket"*. They do not have, and should not need,
a model of subjects, scenarios, collection plans, or provider routing.

Design tone: clear, businesslike, calm. No technical vocabulary. No jargon such
as "subject", "scenario", "collection plan", "provider", "backfill".
Advanced controls exist but are collapsed by default.

## 3. The unified entity: Monitoring Profile

**Monitoring Profile** is the only monitoring entity the user sees.

It is a **facade / view model**, not a new database table:

```
Monitoring Profile (UI concept)
├── MonitoringSubject   (Prisma model)  — identity + vocabulary + archive anchor
└── MonitoringScenario  (JSON in ChannelConfig.settings.scenarios) — collection + actions
```

Rationale for facade over a new table: `MonitoringScenario` is **not** a Prisma
model. It is a JSON array inside
`ChannelConfig{channelType:"social_monitoring", configName:"Monitoring scenarios"}.settings.scenarios`.
Introducing a third persisted model would add migration and three-way-sync risk
without removing the underlying split. The facade keeps one storage change of
record and is reversible.

**Vocabulary mapping (internal → user-facing):**

| Internal | User-facing (az primary) | Never shown |
| --- | --- | --- |
| MonitoringSubject | — (folded into profile) | ✅ hidden |
| MonitoringScenario | — (folded into profile) | ✅ hidden |
| subject.aliases | "Yazılış variantları" (spelling variants) | |
| scenario.platforms | "Platformalar" | |
| MonitoringSource | "Mənbələr" (sources) | |
| scenario.ai.directions | "İzləmə istiqamətləri" (directions) | |
| archive backfill | "Arxiv" | "backfill" hidden |

## 4. Three-step wizard

Rendered as a dedicated full-width work area (route/panel), **not** a tall
truncated modal. Progress indicator 1–2–3 always visible. Each step is
independently valid; the user may move back without data loss.

### Step 1 — "Kimi izləyirik?" (Who are we tracking?)

- One text field. The name is typed **exactly once** and is never re-asked.
- On input (debounced, local only):
  - normalize via `normalizeSubjectTerm()`;
  - look for an existing `MonitoringSubject` (active / paused / archived);
  - if found → offer **Continue existing** or **Resume archived**, never create
    a duplicate;
  - propose name candidates from existing subjects, existing
    `MonitoringSource` rows (handles/urls), and archived subjects;
  - propose spelling variants, handles and hashtags.
- Every proposed variant is a chip the user can **confirm or remove**.

**Suggestions are LOCAL ONLY.** No paid AI or provider call participates in
generating variants. Sources of truth: the typed string, deterministic
normalization/transliteration rules, and rows already stored in this org
(subjects, aliases, sources, archive). This is a hard constraint — see §12.

### Step 2 — "Harada axtaraq?" (Where do we look?)

- Platforms: Instagram, Facebook, TikTok, YouTube, Web, X (optional).
- Content: publications, comments.
- Matching existing sources and official profiles are surfaced inline. The user
  must **not** have to leave for a separate "Sources" section — a source can be
  picked or created here.

Three concepts are kept explicitly distinct:

| Concept | Meaning | Example |
| --- | --- | --- |
| **Platform** | *where* collection runs | Instagram |
| **Source** | *a concrete* page / profile / site | `instagram.com/araz_supermarket` |
| **Reply identity** | *on whose behalf* a reply may be drafted | our connected `@araz_care` account |

Required copy (localized):
> "LeadDrive əvvəlcə saxlanmış arxivi yoxlayacaq. Xarici toplama yalnız çatışmayan
> məlumatlar üçün başlayacaq."
> (LeadDrive checks the saved archive first. External collection starts only for
> missing data.)

### Step 3 — "Nə vacibdir?" (What matters?)

Directions (both may be on simultaneously):

- **Ümumi reputasiya** — general reputation
- **Müştəri şikayətləri** — customer complaints

Summary shown before launch: name, spelling variants, platforms, sources,
comments on/off, directions, archive window, live-send disabled, and what
happens on start.

Primary button: **"Monitorinqi başlat"** (Start monitoring).

## 5. Single source of search terms

The **profile/subject is the only place base search terms live**:

- primary name
- aliases
- transliterations
- handles
- hashtags
- domains
- negative aliases
- required context
- exclusions

`MonitoringSubject → collection query` is the ownership direction.
The collection scenario **derives** its `search.*` from subject aliases via
`deriveScenarioSearchFromSubject()`. The user never types the name a second time.

Direction-specific extra words may exist **only** as an advanced setting and are
never required to start.

Alias-kind → scenario-search mapping:

| Alias kind | Scenario field |
| --- | --- |
| `NAME`, `TRANSLITERATION`, `INFLECTION`, `TYPO` | `search.keywords` |
| `HASHTAG` | `search.hashtags` |
| `HANDLE` | `search.handles` (legacy round-trip only — see below) |
| `DOMAIN` | **not a query term**; stays a match filter |
| `NEGATIVE` | excluded from query; stays a match filter |
| `CONTEXT` | not a query term; stays a match filter |

**The explicit-target rule (important).** `scenarioSourceTargets()` treats any
handle or url as an *explicit* collection target and then stops building
keyword/hashtag sources entirely (`hasExplicitSourceTargets`,
`monitoring-scenarios.ts:675`). Two consequences, both deliberate:

- `DOMAIN` aliases are **not** mapped into `search.urls`. Otherwise adding
  `araz.az` to the vocabulary would silently switch keyword monitoring off on
  every platform. Watching one concrete page is what source selection in step 2
  is for; a domain remains matching vocabulary.
- The wizard **never suggests a guessed handle**. An inferred handle may not
  exist, and a single wrong guess would reduce the profile to one made-up
  profile source. Real handles come from sources discovered in step 2. Handles
  that a legacy scenario already stored still round-trip unchanged, because
  there the handle was the operator's own explicit choice.

## 6. One collection for many directions

**Hard invariant:** analysis directions never create a provider request.

```
Monitoring profile
  → ONE data collection
      → general reputation   (classification)
      → customer complaints  (classification)
```

Structural proof (verified against current code, not aspirational):

- `scenarioSourceTargets()` (`monitoring-scenarios.ts:658`) builds managed
  `MonitoringSource` rows **only** from `scenario.platforms` and
  `scenario.search.*`. It never reads `scenario.ai.*`.
- `archiveMatchSignature()` (`monitoring-scenarios.ts:312`) hashes **only**
  `platforms` + `search.*`. It never reads `scenario.ai.*`.

Therefore placing `directions` under **`scenario.ai.directions[]`** makes it
*structurally impossible* for a direction toggle to add a source or to
invalidate the archive. This is enforced by test, not by convention.

Collection-plan identity key (directions deliberately absent):

```
planKey = { organizationId, subjectId, platform, sourceType,
            normalizedQuery|handle|url,
            includeOwnedComments, includeExternalComments }
```

Adding a direction later therefore:
1. re-classifies already-stored data (archive first);
2. issues **no** new provider run for data already collected.

## 7. Archive-first

Existing behavior is preserved and made visible:

- `backfillMonitoringScenarioFromArchive()` is local-only and never invokes a
  collector or external provider.
- A new direction runs classification over stored mentions before any live
  collection.
- Archive backfill is capped (`ARCHIVE_BACKFILL_MAX_ROWS = 5000`); a `partial`
  result must not block profile activation.

## 8. Existing objects and scenarios (compatibility)

Non-negotiable: **no destructive migration**.

- Existing scenario words are never deleted.
- Legacy scenarios keep working unchanged; the old endpoints stay.
- Legacy scenario terms are copied into subject aliases **once**, additively
  (`skipDuplicates`), preserving the existing `syncScenarioSubjectAliases()`
  guarantee that operator-added aliases, negatives and exclusions are untouched.
- Scenarios without `subjectId` remain readable/editable through the old path.
- `legacyScenarioId` continues to attach orphaned scenarios to subjects.
- `includeExternalComments` stays **three-state** (`true|false|null`). A profile
  save must never coerce `null` → `true`; that would silently start paid comment
  scraping on a legacy scenario.

## 9. Archived / paused profiles

A `MonitoringSubject` with **no active scenario** (e.g. *Bahruz Şiraliyev* after
scenario deletion):

- MUST NOT appear as a confusing active option during new-monitoring creation;
- MUST appear under "Paused / Archive";
- MUST offer **"Monitorinqi bərpa et"** (Resume monitoring);
- on resume MUST reuse existing aliases, sources and archive;
- MUST NOT trigger a repeat paid collection of already-stored data.

Profile status is derived, not stored:

| subject.status | active scenario? | profile status |
| --- | --- | --- |
| active | yes, `active` | `active` |
| active | yes, `paused` | `paused` |
| active/paused | **no** | `needs_resume` (shown in Archive) |
| archived | any | `archived` |

## 10. API contracts

New: `/api/v1/social/monitoring-profiles`

- `GET` → `MonitoringProfileView[]` (joined subjects + scenarios).
- `POST` → create/reuse a profile. Accepts the wizard payload. Never leaves
  partial entities (§11). Duplicate safety is server-side: when no `subjectId`
  is supplied the orchestrator reuses an existing subject whose **normalized
  name matches exactly**. This is stricter than the step-1 candidate search
  (which fuzzy-matches to *offer* a profile to a human) and needs no client
  cooperation, so it also covers a double submit and a second operator typing
  the same brand.
- `PATCH /api/v1/social/monitoring-profiles/[id]` → update aliases / platforms /
  directions, pause, resume, stop.

Existing `monitoring-subjects` and `monitoring-scenarios` endpoints remain for
compatibility and advanced use.

`MonitoringProfileView` (facade):

```ts
{
  id, name, status, subjectId, scenarioId,
  aliases: { value, kind, confirmed }[],
  platforms, sources, commentsEnabled,
  directions: ("general_reputation"|"customer_complaints")[],
  archive: { startAt, matchedCount, scannedCount, status },
  lastUpdatedAt, providerState, liveSendAllowed: false
}
```

## 11. Orchestration and transaction boundary

The subject row, scenario JSON, managed sources and subject-source links all
live in the same PostgreSQL database. The scenario JSON being stored in a
different row does not prevent a Prisma transaction. Writes therefore use an
organization-scoped advisory lock and this boundary:

1. snapshot subject state (if updating) and the uncached scenario list;
2. claim the normalized subject identity under a database lock (new rows begin paused);
3. derive scenario from resulting subject aliases;
4. persist scenario JSON, sync managed sources and scenario links in one transaction;
5. release the lock only after the collection plan is coherent;
6. archive backfill when active + pending;
7. return profile view.

Failure handling:

| Failure point | Compensation |
| --- | --- |
| subject ok, scenario persist fails | leave subject `paused` + provisioning flag → resumable, never an orphan claiming to be active |
| scenario/source/link write fails | database rollback restores the complete pre-write state |
| archive backfill fails | keep profile; `archive.status="failed"`; surface reason; do not roll back |
| retry / double submit | normalized-name + org advisory locks → reuse, no duplicate subject/scenario |

## 12. Security and live-send

- `reply.liveSendAllowed` stays hardcoded `false`. A profile save must never set it.
- Automatic public replies stay disabled.
- No paid provider call during profile creation or suggestion generation.
- Brand-protection tenants keep forced `includeOwnedComments: false`
  (own pages belong in the Inbox — owner rule, 13.07.2026).
- Merely linking a reply identity must never grant external sending
  (`allowExternalReply` defaults `false`).

## 13. UI states

first-run · loading · saving · launch success · existing profile found ·
archived profile found · official sources found · no sources found · some
platforms unavailable · provider error without config loss · paused · archived ·
empty results · restoring.

## 14. Localization

All new/changed strings live in `messages/az.json`, `messages/ru.json`,
`messages/en.json`. **Azerbaijani is the primary production language.**
No hardcoded user-facing text. `npm run i18n:check` must pass.

## 15. Accessibility and responsiveness

Desktop + mobile usable; no truncated wizard; every field labelled; keyboard
navigation and correct focus order; errors explain the fix; the disabled launch
button explains **why** it is disabled; no critical function hidden on mobile.

---

## 16. What exactly triggers an external search

This section is normative and deliberately unambiguous.

1. **The Monitoring Profile holds the names and spelling variants.** It is the
   only source of base search vocabulary.
2. **Platform selection determines where data is collected.** Selecting
   Instagram means Instagram collection may run; it is not itself a source.
3. **A source means one concrete page, profile or site.** A source is the
   addressable target a collector visits.
4. **Analysis directions do NOT create provider requests.** "General reputation"
   and "customer complaints" are classifications applied to one collected
   dataset. Directions are excluded from the collection-plan key by
   construction (§6).
5. **A new monitoring profile automatically creates the internal collection
   configuration.** The user never authors a scenario.
6. **The user does not retype the name in a scenario.** Scenario search terms are
   derived from the profile.
7. **An object with no active collection plan does not start an external search
   by itself.** It is inert until explicitly resumed.

---

## 17. Acceptance criteria

### Araz Supermarket (new profile)

1. Press "New monitoring".
2. Type `Araz Supermarket` **once**.
3. Confirm suggested spelling variants.
4. Select Instagram, Facebook, TikTok, Web.
5. Enable both "General reputation" and "Customer complaints".
6. Press "Start monitoring".

Expected:
- exactly one subject/profile created or reused;
- exactly one collection scenario/plan;
- search words never entered twice;
- two directions do **not** create two identical collections;
- archive consulted first;
- one card in the list;
- live-send remains off.

### Bahruz Şiraliyev (subject without active scenario)

- appears in archived/paused monitors;
- not shown as a confusing active object;
- resumable;
- aliases + archive preserved;
- resume does not re-collect already-stored data.

## 18. Rollout and rollback

**Rollout.** Additive. New endpoint + new UI layer; legacy endpoints and stored
JSON untouched. Legacy alias adoption is additive and idempotent
(`skipDuplicates`), so a re-run is safe.

**Rollback.** Revert the UI to the previous tabs; the legacy Objects/Scenarios
surfaces still operate on the same rows. No schema migration is required by this
change, so rollback is code-only. Data written by the new flow (subject aliases,
one scenario, managed sources) is valid input for the old surfaces — the old UI
reads it without modification.

**Requirement changes.** If code and this spec disagree, the code is fixed. Any
deliberate product-requirement change must be explained in the PR description.
