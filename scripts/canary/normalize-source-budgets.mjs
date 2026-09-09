// Canary "normalize-source-budgets" (write step, requires confirm=brandprotection).
//
// Owner rule (2026-07-21): "убери лимит — никакого максимума". The owner raised
// the tenant-wide route budget (paid-run policy routeDefaults) to a practically
// unlimited ceiling ($100/click, $10k/day, $100k/mo). But scenario sources still
// carry a tiny per-source budget stamped at provisioning
// (dailyBudgetUsd≈$1, monthlyBudgetUsd≈$20). source-route-plan.ts routeBudget
// treats an explicit per-source budget as authoritative ("per-source wins"), so
// those stale micro-limits SHADOW the owner's ceiling: the compiled plan bakes
// $1/day, and once the shared Bright Data day-aggregate crosses $1 every
// AUTOMATIC (uncapped cron) run fails closed with paid_route_daily_budget_exhausted.
// Manual capped clicks bypass the shared budget and were unaffected — but the
// unattended path (the one that must never silently miss a client's news) was
// dead.
//
// Fix, tenant-scoped and durable:
//   1. For every source whose per-source budget names a daily/monthly ceiling
//      BELOW the tenant routeDefaults, DROP those two fields so the compiled plan
//      inherits the owner's tenant ceiling (single source of truth = routeDefaults,
//      which the owner controls). The per-click maxTotalChargeUsd / maxItems /
//      timeoutSeconds are left as-is, so automatic runs still reserve a modest
//      per-click amount — only the shared day/month ceiling follows the owner.
//   2. Force a one-time recompile by setting each route plan's policyVersion to a
//      sentinel: runSafeCollector re-bakes any plan whose policyVersion != the
//      code constant, so the next run (cron or manual) rewrites the plan budget
//      from the corrected source settings. Plans are upserted in place, not
//      deleted — a socialProviderRun FK (onDelete: NoAction) references them.
//   3. Wake the touched sources so the next */5 cron tick actually re-runs them.
// Idempotent (a second run finds nothing to strip). Counts/ids only — no secrets.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"
const REBAKE_SENTINEL = "rebake-budget-normalize-2026-07-21"
const short = (id) => (id ? id.slice(-8) : "-")

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}
function num(value) {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true, settings: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)

  const settings = asRecord(org.settings)
  const paid = asRecord(settings.socialMonitoringPaidRuns)
  const routeDefaults = asRecord(paid.routeDefaults)
  // The owner's authoritative shared ceiling. Fall back to the top-level policy
  // budgets, then to the enforced hard ceilings, so we never strip a source down
  // to nothing if routeDefaults is somehow absent.
  const tenantDaily = num(routeDefaults.dailyBudgetUsd) ?? num(paid.dailyBudgetUsd) ?? 10000
  const tenantMonthly = num(routeDefaults.monthlyBudgetUsd) ?? num(paid.monthlyBudgetUsd) ?? 100000
  console.log(`[normalize-source-budgets] tenant ceiling: daily=$${tenantDaily} monthly=$${tenantMonthly}`)

  const sources = await prisma.monitoringSource.findMany({
    where: { organizationId: org.id },
    select: { id: true, platform: true, sourceType: true, query: true, handle: true, settings: true },
  })

  const touched = []
  for (const s of sources) {
    const sSettings = asRecord(s.settings)
    const budget = asRecord(sSettings.budget)
    if (Object.keys(budget).length === 0) continue
    const perDaily = num(budget.dailyBudgetUsd)
    const perMonthly = num(budget.monthlyBudgetUsd)
    // Only strip a ceiling that is BELOW the owner's tenant ceiling (the stale
    // provisioning micro-limit). A deliberately-higher per-source budget is left
    // untouched.
    const shadowsDaily = perDaily !== null && perDaily < tenantDaily
    const shadowsMonthly = perMonthly !== null && perMonthly < tenantMonthly
    if (!shadowsDaily && !shadowsMonthly) continue

    const nextBudget = { ...budget }
    delete nextBudget.dailyBudgetUsd
    delete nextBudget.monthlyBudgetUsd
    const nextSettings = { ...sSettings, budget: nextBudget }
    await prisma.monitoringSource.update({ where: { id: s.id }, data: { settings: nextSettings } })
    touched.push({ id: s.id, platform: s.platform, type: s.sourceType, q: s.query || s.handle || "-", wasDaily: perDaily, wasMonthly: perMonthly })
  }

  console.log(`[normalize-source-budgets] sources scanned=${sources.length} stripped=${touched.length}`)
  const byPlatform = {}
  for (const t of touched) byPlatform[t.platform] = (byPlatform[t.platform] ?? 0) + 1
  for (const [p, n] of Object.entries(byPlatform).sort()) console.log(`  ${p}: ${n} source(s) freed to tenant ceiling`)
  for (const t of touched.slice(0, 20)) console.log(`  ${short(t.id)} ${t.platform}/${t.type} "${t.q}" (was daily=$${t.wasDaily} monthly=$${t.wasMonthly})`)
  if (touched.length > 20) console.log(`  … and ${touched.length - 20} more`)

  // Force a one-time re-bake of every plan (compile rewrites policyVersion back to
  // the code constant, picking up the corrected source budgets + tenant ceiling).
  const rebaked = await prisma.sourceRoutePlan.updateMany({
    where: { organizationId: org.id, status: { not: "INVALIDATED" }, policyVersion: { not: REBAKE_SENTINEL } },
    data: { policyVersion: REBAKE_SENTINEL },
  })
  console.log(`[normalize-source-budgets] route plans marked for re-bake=${rebaked.count} (policyVersion -> ${REBAKE_SENTINEL})`)

  // Put the touched sources at the front of the due queue so the next */5 cron
  // tick re-runs them (recompile-then-reserve happens inside that run).
  const wakeAt = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const woken = await prisma.monitoringSource.updateMany({
    where: { id: { in: touched.map(t => t.id) }, organizationId: org.id, status: { in: ["active", "limited"] } },
    data: { lastCheckedAt: wakeAt },
  })
  console.log(`[normalize-source-budgets] woken for next cron tick=${woken.count}`)
  console.log(`[normalize-source-budgets] DONE — automatic (uncapped) runs now inherit the owner's tenant ceiling instead of the stale $1/day micro-limit`)
}

main()
  .catch((err) => { console.error("[normalize-source-budgets] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
