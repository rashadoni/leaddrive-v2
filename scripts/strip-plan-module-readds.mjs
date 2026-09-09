// One-shot cleanup: remove the plan-module ids that the broken
// backfill-base-modules deploy loop re-added into `Organization.features` of
// EDITOR-AUTHORITATIVE tenants.
//
// BACKGROUND (2026-07-09, brandprotection): server-deploy.sh read the
// backfill's version via `node -e "import(...)"`, which executed the script's
// top-level main() and polluted the captured version string — the ledger check
// never matched, so `backfill-base-modules --execute` ran on EVERY deploy. Its
// add-only union kept re-inserting plan modules (core/deals/leads/tasks/
// contracts/...) into `features`, resurrecting sidebar groups the superadmin
// had explicitly toggled OFF in /admin/tenants/<id>/edit. Both bugs are fixed
// (grep-based version probe + editor-authoritative skip in the backfill); this
// script repairs the data damage.
//
// WHAT IT REMOVES, per org: exactly the set the backfill would have added for
// that org's plan (BASE_PLAN_MODULES / LEGACY_PLAN_MODULES[plan] — mirrors of
// backfill-base-modules.mjs), MINUS any group id whose `modules`-column toggle
// is `true` (an admin-chosen group stays). Plan-default FLAGS (whatsapp / ai /
// portal / complaints_register) are NOT touched — they are outside the broken
// backfill's plan-module set and may be in active use.
//
// SAFETY: only tenants with explicit `false` group markers in the `modules`
// JSON column are eligible (that marker is written ONLY by
// reconcileModulesWithFeatures — i.e. an editor save or the repair script).
// Legacy tenants that never used the new editor are SKIPPED: for them the
// backfill's grants are legitimate.
//
// Usage:
//   node scripts/strip-plan-module-readds.mjs --slug=brandprotection            # dry-run
//   node scripts/strip-plan-module-readds.mjs --slug=brandprotection --execute  # write
//   node scripts/strip-plan-module-readds.mjs                                   # dry-run, ALL eligible tenants
//
// Idempotent: a second run is a no-op.

import { pathToFileURL } from "node:url"
import { makeScriptPrisma } from "./_rls.mjs"

// ── Inline mirrors of backfill-base-modules.mjs (keep in sync) ──────────────
const BASE_PLAN_MODULES = [
  "core", "deals", "leads", "tasks", "contracts", "quotes",
  "events", "reports", "workflows",
  "knowledge-base", "tickets", "custom-fields", "currencies",
  "projects",
]
const NEW_TIER_PLANS = new Set(["tier-5", "tier-10", "tier-25", "tier-50", "enterprise"])
const LEGACY_PLAN_MODULES = {
  starter: ["core", "deals", "leads", "tasks"],
  business: ["core", "deals", "leads", "tasks", "contracts", "tickets", "knowledge-base"],
  professional: [
    "core", "deals", "leads", "tasks", "contracts", "invoices", "tickets",
    "knowledge-base", "campaigns", "omnichannel", "reports", "workflows",
    "currencies", "events", "projects", "budgeting", "profitability",
  ],
}

// Inline mirror of GROUP_MODULE_IDS in src/lib/modules.ts (the editor toggles).
const GROUP_MODULE_IDS = [
  "crm", "sales", "contracts", "marketing", "loyalty", "omnichannel", "voip", "support",
  "finance", "analytics", "mtm", "health", "insurance", "public-sector", "media",
  "energy", "settings",
]

function parseFeatures(raw) {
  if (Array.isArray(raw)) return raw.filter((f) => typeof f === "string")
  if (typeof raw === "string") {
    try { return JSON.parse(raw || "[]") } catch { return [] }
  }
  return []
}

function moduleRecord(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null
}

function backfillSetForPlan(plan) {
  if (NEW_TIER_PLANS.has(plan)) return BASE_PLAN_MODULES
  if (LEGACY_PLAN_MODULES[plan]) return LEGACY_PLAN_MODULES[plan]
  return BASE_PLAN_MODULES // unknown plan → backfill applied BASE_PLAN_MODULES
}

async function main() {
  const execute = process.argv.includes("--execute")
  const slugArg = process.argv.find((a) => a.startsWith("--slug="))
  const slug = slugArg ? slugArg.slice("--slug=".length) : ""
  console.log(`[strip-plan-readds] mode=${execute ? "EXECUTE" : "DRY-RUN"}${slug ? ` slug=${slug}` : " (all tenants)"}`)

  const orgs = await prisma.organization.findMany({
    where: slug ? { slug } : undefined,
    select: { id: true, slug: true, plan: true, features: true, modules: true },
    orderBy: { slug: "asc" },
  })
  if (slug && orgs.length === 0) {
    console.error(`[strip-plan-readds] FATAL: no organization with slug="${slug}"`)
    process.exit(1)
  }
  console.log(`[strip-plan-readds] scanning ${orgs.length} organization(s)`)

  let touched = 0
  let skipped = 0
  for (const org of orgs) {
    const rec = moduleRecord(org.modules)
    const hasOffMarker = rec && GROUP_MODULE_IDS.some((g) => rec[g] === false)
    if (!hasOffMarker) {
      console.log(`  [SKIP]  ${org.slug}: not editor-authoritative (no explicit OFF markers) — backfill grants are legitimate here`)
      skipped++
      continue
    }

    const current = parseFeatures(org.features)
    const stripSet = new Set(backfillSetForPlan(org.plan))
    const keepTrueGroups = new Set(GROUP_MODULE_IDS.filter((g) => rec[g] === true))
    const removed = current.filter((f) => stripSet.has(f) && !keepTrueGroups.has(f))

    if (removed.length === 0) {
      console.log(`  [OK]    ${org.slug} (plan=${org.plan}): nothing to strip`)
      continue
    }

    const next = current.filter((f) => !(stripSet.has(f) && !keepTrueGroups.has(f)))
    console.log(
      `  [STRIP] ${org.slug} (plan=${org.plan}): -[${removed.join(", ")}]  ` +
      `before=${current.length} after=${next.length}` +
      (keepTrueGroups.size ? `  kept-ON-groups=[${[...keepTrueGroups].join(", ")}]` : ""),
    )

    if (execute) {
      await prisma.organization.update({ where: { id: org.id }, data: { features: next } })
    }
    touched++
  }

  console.log(`[strip-plan-readds] done. touched=${touched} skipped=${skipped}`)
  if (!execute && touched > 0) {
    console.log(`[strip-plan-readds] re-run with --execute to write ${touched} update(s)`)
  }
}

// Import-safe: run only when invoked directly (same guard as backfill-base-modules).
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
let prisma
if (isDirectRun) {
  prisma = await makeScriptPrisma()
  main()
    .catch((err) => {
      console.error("[strip-plan-readds] FAILED:", err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
