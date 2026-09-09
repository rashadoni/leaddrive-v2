# MTM Routes Phase 1 - Compatibility Inventory

> **Purpose:** authoritative migration checklist before replacing the current
> single-agent route relation with multi-agent assignments.

## Current contract

- `MtmRoute.agentId` is required and points to the primary agent.
- Web route create/update accepts one `agentId`.
- Web route list filters directly by `where.agentId`.
- Mobile sync returns routes filtered directly by authenticated `agentId`.
- Mobile location resolves the active route directly by `agentId`.
- Route completion metrics and leaderboard group by `MtmRoute.agentId`.
- `MtmVisit.agentId` is required and identifies the visit owner.
- Route points have shared execution state and no explicit visit relation.

## Direct consumers

| Surface | Current dependency | Compatibility action |
|---|---|---|
| `api/v1/mtm/routes` | filter/create by `agentId` | accept legacy `agentId`; add assignments |
| `api/v1/mtm/routes/[id]` | include/update/delete primary agent | preserve primary field during transition |
| `api/v1/mtm/mobile/sync/pull` | authenticated `agentId` route filter | query primary or assignment; keep payload field |
| `api/v1/mtm/mobile/location` | active route by `agentId` | resolve route assignment, prefer primary |
| MTM route page/form | one agent selector | replace with primary + participants |
| MTM visits page/form | manually selected agent/customer | move field execution to route-linked workspace |
| MTM overview/analytics | route and visit counts | define primary vs participant attribution |
| MTM leaderboard | group by route `agentId` | count route ownership by primary only |
| AI advisor signals | route/visit queries and links | preserve IDs and primary ownership semantics |
| Offline sync docs/tests | single-agent payload | version additively; do not remove fields |

## Indirect consumers to regression-test

- Agent profile route totals.
- Live map and agent location anomaly generation.
- Route completion and visited-point metrics.
- Activity timeline and audit links.
- Help content and AZ/RU/EN enum labels.
- Tenant export or analytics exports containing MTM route/visit data.
- Test mock factory, which derives MTM models from Prisma schema.

## Additive migration sequence

1. Add new tables/enums/nullable links and `DRAFT`; do not remove or relax the
   existing primary `agentId` foreign keys.
2. Backfill one `PRIMARY` assignment for every active and soft-deleted route.
3. Dual-write primary `agentId` and assignments for all new/updated routes.
4. Update reads to match `agentId` or assignment while preserving the legacy
   top-level `agentId` and `agent` payload.
5. Add visit participants while preserving `MtmVisit.agentId` as primary owner.
6. Update mobile/web clients to consume additive `assignments` and participant
   metadata.
7. Observe dual-read/dual-write metrics before any later cleanup migration.

Phase 1 does not remove `MtmRoute.agentId` or `MtmVisit.agentId`.

## Compatibility invariants

- A legacy route-create payload `{agentId, date, points}` remains valid.
- Every route has exactly one primary assignment after backfill.
- `route.agentId` always equals the primary assignment agent during Phase 1.
- An authenticated mobile agent receives a route when they are primary or an
  active participant.
- The legacy mobile payload still contains top-level `agentId`.
- Primary-agent leaderboard totals do not double-count participants.
- One shared route visit is not duplicated for each participant.
- Soft-deleted routes and assignments remain visible to delta-sync deletion
  logic as required.

## Baseline verification

- `src/__tests__/api-mtm-routes.test.ts`
- `src/__tests__/api-mtm-detail.test.ts`
- `src/__tests__/api-mtm-mobile-sync.test.ts`
- `src/__tests__/api-mtm-locations.test.ts`
- `src/__tests__/api-mtm-agents.test.ts`
- `src/__tests__/lib-mtm-visit-anomaly.test.ts`
- `src/__tests__/mocks/mtm-prisma.test.ts`

Every schema/API slice must run the directly affected tests plus TypeScript.
Schema slices also run Prisma validate and generate.
