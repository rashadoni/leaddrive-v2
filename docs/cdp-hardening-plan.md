# CDP UnifiedProfile — Hardening Plan

Post-ship audit roadmap (architect `aaefa4bc` + dev). The feature is live + backfilled
(714 profiles / 6 tenants). This plan closes the gaps found in the audit, in two waves.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done. Priority P0(blocker)→P3(polish).

---

## WAVE 1 — correctness + observability quick wins (one batch → one deploy)

- [x] **W1.1 [P1 correctness] Read-route LTV currency consistency.**
  Read route's `calculateLtv` sums paid invoices of ALL currencies into one LTV, while
  `totalSpent` (write path) only sums `primaryCurrency`. On mixed-currency profiles the
  two diverge + LTV mixes AZN+USD.
  **Correction to the architect's "1-line filter":** a blanket filter would break churn /
  engagement (they count ALL orders by timing/frequency, currency-agnostic). Correct fix:
  feed `calculateLtv` a `primaryCurrency`-filtered invoice list (LTV = primaryCurrency only,
  matching totalSpent) while churn/engagement/days keep the full list.
  Files: `src/app/api/v1/calculated-insights/route.ts` (carry `currency` on calcInvoices,
  filter only for the LTV call) + a mixed-currency case in `api-calculated-insights.test.ts`.

- [x] **W1.2 [P2 obs] Hook error logging.** Replace `.catch(() => {})` with
  `.catch((e) => console.error("[cdp-hook] <site> failed", e))` so a failed real-time
  profile build is visible. Files: `contacts/route.ts:93`, `leads/route.ts:109`,
  `invoices/[id]/payments/route.ts:111`.

- [x] **W1.3 [P2 correctness] metadata read-merge.** `aggregateProfiles` overwrites
  `UnifiedProfile.metadata` wholesale → will clobber G4 segmentation / ProfileInsight once
  they write there. Select `metadata` in the profiles query + write
  `{ ...(existing ?? {}), crossCurrencyTotals }`. File: `profile-builder.ts:~558,571`.

- [x] **W1.4 [P2 ux] True-count KPI.** `totalItems` reports page size (≤50), not the real
  count (568). Add `prisma.unifiedProfile.count({ where:{ organizationId } })` →
  `totalProfiles` in the response; page shows the true total. Files: read route + page +
  message key `kpiProfiles`/footer (3 locales).

- [x] **W1.5 [P1 ops] Cron failure surfacing.** Cron returns 200 even when a tenant errors
  (`perOrg[].error`) → shell sees success. Return `ok:false` (+ HTTP 207/500) when any
  per-org error; shell script flags it. Files: `cron/cdp-profile-refresh/route.ts:68` +
  `scripts/cron-cdp-profile-refresh.sh`.

- [x] **W1.6 [P3 security] Email XSS defense-in-depth.** `normalizeEmail` admits
  `<script>@x.y` (safe today — JSON+React escape — but CDP ingests untrusted public
  Lead/WebChat forms). Reject `<` / `>` at normalize time. Files: `identity-keys.ts` +
  test in `lib-unified-profile.test.ts`.

Wave-1 close: `tsc` + affected tests green → Codex self-review → commit → deploy (Hetzner).

---

## WAVE 2 — slices (each its own TDD turn + architect + deploy)

- [x] **W2.A [P1 ux] Merge-queue resolution (biggest perceived-vs-actual gap).**
  Candidates are created but there's no path that MERGES (`identity-merge-queue` is GET-only;
  page has no buttons). Build `POST /api/v1/identity-merge-queue/[id]/resolve`: in a
  transaction — re-point secondary's `ProfileSource` rows → primary, merge
  `channelsActive`/`metadata`, set `status=manually_merged` + `reviewedBy/At`, delete
  secondary, re-aggregate primary. Add approve/reject buttons on
  `cdp/merge-queue/page.tsx`. Tests.

- [ ] **W2.B [P1/P2 correctness] Source lifecycle hooks (prune + update).**
  `pruneProfileForSource(orgId,type,id)` from contact/lead DELETE routes (remove
  ProfileSource; if profile sourceless → delete, else re-aggregate). `refreshProfileForSource`
  from contact/lead UPDATE routes (email/phone change). Cron reaps orphan ProfileSources
  whose `sourceId` no longer resolves. Stops monotonic KPI drift + the dead-`primaryContactId`
  issue (schema `:7276` describes this but it was never built). Tests.

- [ ] **W2.C [P1/P2 scale+ux] Materialize ProfileInsight + pagination.**
  `ProfileInsight` table is built-but-unused; read route recomputes every request and CAN'T
  sort/paginate by LTV (computed after DB orderBy). Cron upserts `ProfileInsight` per
  (profile, def); read route reads materialized values, `orderBy` LTV in-DB, real
  offset/cursor pagination. Retires W1.4 interim. Tests.

- [ ] **W2.D [P1 scale+ops] Incremental cron + lock.**
  Cron does O(N) serial UPDATEs/hour for ALL profiles + no overlap lock. Re-aggregate only
  profiles dirtied since `lastRefreshedAt` (diff source `updatedAt`), batch the UPDATEs, add
  `flock` to the shell script. Fold in W2.E. Tests.

- [ ] **W2.E [P3 perf] Drop redundant source-timestamp reload.** `loadSourceTimestamps`
  re-reads source tables that Phase A already read in the same run. Thread Phase-A
  timestamps into Phase B. (Bundle with W2.D.)

### Execution order
Wave 1 (batch) → W2.A → W2.B → W2.C → W2.D. Each Wave-2 slice: TDD, Codex self-review,
deploy, verify on prod.

### Out of scope (noted, not planned)
- Cross-currency FX conversion into totalSpent (slice-3; currently per-currency in metadata).
- `totalSpent` Float→Decimal (recompute model → no drift; not worth a migration).
- ProfileInsight cron e-mail/chart deeper features.
