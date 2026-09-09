// Canary "wake-stale-sources" (write step, requires confirm=brandprotection).
//
// The collector's exponential backoff (2^failures, cap x8) treats config-class
// failures (budget unconfigured, route plans missing, live-routing flag off)
// like provider failures. During the week the tenant's FB/IG page sources kept
// failing on missing budget/routes, so by the time the budget rollout landed
// (policy v11 + tenant routeDefaults) they had earned cadence*8 = 2-3 DAY
// sleeps — the fixes can't take effect because the fix path IS the next run.
//
// This step puts those sources back at the front of the due queue by setting
// lastCheckedAt 30 days into the past (survives any backoff multiplier, and
// sorts first in the scheduler's lastCheckedAt-asc candidate scan). The next
// cron ticks then run them: the #468 self-heal recompiles route plans and the
// budget gates decide spend as usual. Only active/limited sources with a
// config-class lastError or zero non-invalidated route plans are touched;
// paused/disabled sources stay untouched. Idempotent; counts/ids only.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"

const INFRA_ERRORS = [
  "paid_route_budget_unconfigured",
  "paid_route_daily_budget_exhausted",
  "paid_route_monthly_budget_exhausted",
  "paid_route_run_quota_exhausted",
  "paid_route_budget_cap_too_low",
  "source_routes_partial_or_pending",
  "source_route_plan_blocked",
  "bright_data_live_routing_disabled",
  "bright_data_token_missing",
  "bright_data_price_unconfigured",
  "bright_data_discovery_input_missing",
  "manual_collection_required",
  "collector_not_configured",
  // 2026-07-20 evening (owner: "мне нужны результаты"): include the classes
  // that were previously starved by the daily cap — Meta-primary failures fall
  // back to Bright Data (now affordable, routeDefaults raised to $100/day),
  // and single-row schema failures deserve one retry on the v5 recompile.
  "official_fetch_failed",
  "bright_data_schema_failed",
  "bright_data_schema_degraded",
  "bright_data_enrichment_reuse_missing",
]

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)

  const sources = await prisma.monitoringSource.findMany({
    where: { organizationId: org.id, status: { in: ["active", "limited"] } },
    select: { id: true, platform: true, sourceType: true, lastError: true, lastCheckedAt: true },
  })
  const plans = await prisma.sourceRoutePlan.groupBy({
    by: ["sourceId"],
    where: { organizationId: org.id, status: { not: "INVALIDATED" } },
    _count: { _all: true },
  })
  const planned = new Set(plans.map(p => p.sourceId))

  const wakeIds = sources
    .filter(s => !planned.has(s.id) || INFRA_ERRORS.some(e => (s.lastError ?? "").startsWith(e)))
    .map(s => s.id)

  const wakeAt = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const updated = await prisma.monitoringSource.updateMany({
    where: { id: { in: wakeIds }, organizationId: org.id, status: { in: ["active", "limited"] } },
    data: { lastCheckedAt: wakeAt },
  })

  const byPlatform = {}
  for (const s of sources) {
    if (!wakeIds.includes(s.id)) continue
    byPlatform[s.platform] = (byPlatform[s.platform] ?? 0) + 1
  }
  console.log(`[wake-stale-sources] candidates=${sources.length} woken=${updated.count}`)
  for (const [platform, n] of Object.entries(byPlatform).sort()) console.log(`  ${platform}: ${n}`)
  console.log(`  (lastCheckedAt -> ${wakeAt.toISOString()}; next */5 cron ticks will pick them up, 25/tick)`)
}

main()
  .catch((err) => { console.error("[wake-stale-sources] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
