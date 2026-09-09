# MTM Debug Report — Phase 1 (Diagnostic Sweep)

**Дата создания:** 2026-05-12
**Последнее обновление:** 2026-05-13 (закрыто 100% in-code findings)

**Tenant:** main LeadDrive (`app.leaddrivecrm.org`) — НЕ AFI Group
**Метод:** статический code review всех 27 API endpoints, 15 frontend страниц, 13 Prisma моделей, 6 test файлов + Chrome MCP prod smoke (с авторизацией пользователя). Local runtime не использовался (`.env.local` отсутствует в worktree).

## ⚠️ STATUS: closed in-repo

Все 30 findings + 8 follow-ups (F-31..F-38) от architect-reviews **закрыты в коде** в 2-day sprint (12–13 мая 2026). Остаются только OUT-OF-CODE items:

| Open item | Owner | Notes |
|---|---|---|
| `MTM_REQUIRE_TENANT_SLUG=1` rollout | Operator | Wait until mobile APK build with `organizationSlug` is in field |
| `REQUIRE_TENANT_SLUG=1` rollout (web) | Operator | Single redeploy |
| Mobile native APK update | Mobile team | Outside repo |
| AZ native translation pass | AZ speaker | Translations composed by non-native, need review |

Audit table below is **historical**; for the up-to-date state run
`grep -RE 'F-[0-9]+' src/ docs/` или see commit history `ed998a14..HEAD`.

> Original Phase 1 input is preserved below for posterity. Findings ниже отсортированы по severity (P0 → P1 → P2).

---

## Closeout matrix (final state — 13 May 2026)

| Range | Description | Status |
|---|---|---|
| F-01..F-30 | Original 30 Phase-1 findings | **100% closed in-code** (F-25 was an env config issue, fixed via F-24 Leaflet rewrite that removed Google Maps dependency entirely) |
| F-31..F-34 | Activity-page UI gaps (KPI, filter, agent JOIN, badge colors) | **Closed** in `mtm/activity/route.ts` + `mtm/activity/page.tsx` |
| F-35 | Mobile auth tenant-disambiguation (`findFirst({email})` non-deterministic) | **Closed** via `organizationSlug` body field + slug-scoped rate-limit key + `RATE_LIMITED` audit event + dedup |
| F-36 | Web auth same regression in `authorize()` and JWT callback | **Closed** via subdomain-derived slug in login form + helpers in `src/lib/auth-credentials.ts` |
| F-37 | seed-mtm.ts couldn't bootstrap a fresh-clone tenant | **Closed** — seed now upserts `leaddrive` org + admin + handles stale Farid email |
| F-38 | Pre-existing `AgentLocation` type duplicate (from F-24 Leaflet rewrite) | **Closed** via `src/lib/mtm-types.ts` shared type + post-filter cast |

Regression coverage: 215+ tests in `src/__tests__/api-mtm-*.test.ts`,
`lib-auth-*.test.ts`, `lib-tenant-domain.test.ts`, `lib-i18n-keys.test.ts`.
CI runs them on every deploy (deploy.yml).

97 hardcoded UI strings in 9 MTM pages were also extracted to i18n
catalogs (en/ru/az) with the `lib-i18n-keys.test.ts` drift guard
preventing missed translations going forward.

---

## Historical Phase 1 findings

Original 30 findings + Phase 2 recommendations + audit-log gap table
+ geofence corner-case matrix + frontend silent-fetch table are
preserved in [`mtm-debug-report-archive.md`](./mtm-debug-report-archive.md).

**ALL of them are now CLOSED** — see the Closeout matrix above.
Don't chase phantom bugs by reading the archive without checking
the matrix first.
