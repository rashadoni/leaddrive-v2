// One-shot backfill (v3): ensure every tenant's `Organization.features`
// contains the module set the OLD `hasModule()` granted it — for ALL plans,
// new-tier AND legacy-named — so the new AUTHORITATIVE `hasModule()`
// (src/lib/modules.ts, reads `features` only) doesn't hide pages from tenants
// who never intended to disable them.
//
// Why v3: the v2 backfill covered only new-tier plans and SKIPPED legacy-named
// plans (starter/business/professional), because the old gate still granted
// those via `LEGACY_PLANS[plan].modules`. Now that the legacy plan-name
// override is removed (the gate reads `features` for every plan), legacy
// tenants — including the provisioning default `starter` — would lose their
// base modules on restart unless `features` is first populated. This run
// writes `LEGACY_PLAN_MODULES[plan]` (mirror of LEGACY_PLANS) into their
// `features`. Add-only, so any deliberate admin OFF-toggle saved after the
// previous backfill is preserved.
//
// What this script does: union(current features, BASE_PLAN_MODULES,
// plan-tier defaults). Add-only — never removes anything — so an admin's
// pre-existing OFF intent for plan-default features (e.g. complaints_register
// removed from a specific tenant) is preserved if they were toggled off after
// the v1 backfill ran. Idempotent.
//
// Usage (typically via server-deploy.sh Step 3d, sentinel-gated):
//   node scripts/backfill-base-modules.mjs              # dry-run
//   node scripts/backfill-base-modules.mjs --execute    # actually writes

import { pathToFileURL } from "node:url"
import { makeScriptPrisma } from "./_rls.mjs"

/**
 * Versioned ledger tag (per-deploy server-deploy.sh skip-check).
 * BUMP THIS when BASE_PLAN_MODULES changes — server-deploy.sh writes
 * the version to `.backfill-base-modules.log` after a successful run,
 * and skips on next deploy if the tag already appears. Replaces the
 * prior `-vN-done` boolean sentinel file rename dance.
 *
 * NOTE server-deploy.sh reads this constant by GREPPING the file — never by
 * `import()`ing it. An import used to execute main() as a side effect (top-
 * level call below), which polluted the captured "version" with a full dry-run
 * log; the multi-line garbage never matched the ledger, so the EXECUTE ran on
 * EVERY deploy and kept re-adding plan modules an admin had toggled OFF.
 * The isDirectRun guard below closes the same hole for any future importer.
 */
export const BACKFILL_VERSION = "v3"

// Mirror of src/lib/modules.ts BASE_PLAN_MODULES + USER_TIERS keys.
// Update both files together if either changes.
// `campaigns` removed (2026-06-03): Marketing is now a paid add-on, NOT base.
// This backfill is add-only and ALREADY ran as v3 with campaigns included, so
// existing tenants keep campaigns in their `features`; dropping it here only
// prevents a future re-run from re-granting Marketing to base tenants. Version
// is NOT bumped — a removal needs no backfill (add-only can't un-grant).
const BASE_PLAN_MODULES = [
  "core", "deals", "leads", "tasks", "contracts", "quotes",
  "events", "reports", "workflows",
  "knowledge-base", "tickets", "custom-fields", "currencies",
  "projects",
]

const NEW_TIER_PLANS = new Set(["tier-5", "tier-10", "tier-25", "tier-50", "enterprise"])

// Mirror of src/lib/tenant-plans.ts plan-default features. Only the
// `features` arrays here — `addons` are managed separately on the
// `Organization.addons` column.
//
// NOTE: these overlap with what scripts/backfill-plan-features.mjs (Step 3c
// in server-deploy.sh) writes. Set-merge below makes the overlap harmless —
// any tenant that already passed Step 3c will see them in `current` and the
// missing-set will be empty for those entries.
const PLAN_DEFAULT_FEATURES = {
  starter: [],
  professional: ["whatsapp", "ai", "complaints_register"],
  enterprise: ["whatsapp", "ai", "voip", "portal", "events", "complaints_register"],
}

// Mirror of src/lib/modules.ts LEGACY_PLANS[*].modules for the LEGACY-NAMED
// plans (NOT in USER_TIERS): starter / business / professional. The OLD
// hasModule() granted these by plan NAME, ignoring `features`. The new
// authoritative gate reads `features` only, so we must write these modules into
// `features` first or these tenants lose access on restart. ("enterprise" is in
// USER_TIERS → handled by the new-tier branch below, like the old code did.)
// Keep in sync with modules.ts LEGACY_PLANS.
const LEGACY_PLAN_MODULES = {
  starter: ["core", "deals", "leads", "tasks"],
  business: ["core", "deals", "leads", "tasks", "contracts", "tickets", "knowledge-base"],
  professional: [
    "core", "deals", "leads", "tasks", "contracts", "invoices", "tickets",
    "knowledge-base", "campaigns", "omnichannel", "reports", "workflows",
    "currencies", "events", "projects", "budgeting", "profitability",
  ],
}

// Inline mirror of GROUP_MODULE_IDS in src/lib/modules.ts (the admin-editor
// toggles). An explicit boolean `false` for one of these keys in the
// `Organization.modules` JSON column is written ONLY by
// reconcileModulesWithFeatures (editor save / repair script) — it is proof the
// admin exercised OFF-intent in the authoritative editor. Such tenants are
// SKIPPED below: re-adding plan modules to their `features` would resurrect
// exactly what the admin turned off (bit brandprotection 2026-07-09).
const GROUP_MODULE_IDS = [
  "crm", "sales", "contracts", "marketing", "loyalty", "omnichannel", "voip", "support",
  "finance", "analytics", "mtm", "health", "insurance", "public-sector", "media",
  "energy", "settings",
]

function isEditorAuthoritative(rawModules) {
  const rec = rawModules && typeof rawModules === "object" && !Array.isArray(rawModules) ? rawModules : null
  if (!rec) return false
  return GROUP_MODULE_IDS.some((g) => rec[g] === false)
}

function parseFeatures(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === "string") {
    try { return JSON.parse(raw || "[]") } catch { return [] }
  }
  return []
}

async function main() {
  const execute = process.argv.includes("--execute")
  const mode = execute ? "EXECUTE" : "DRY-RUN"
  console.log(`[backfill-base-modules] mode=${mode}`)

  const orgs = await prisma.organization.findMany({
    select: { id: true, slug: true, name: true, plan: true, features: true, modules: true },
    orderBy: { slug: "asc" },
  })

  console.log(`[backfill-base-modules] scanning ${orgs.length} organization(s)`)

  let touched = 0
  let alreadyOk = 0
  let skippedAuthoritative = 0

  for (const org of orgs) {
    // An admin who saved this tenant in the new module editor (explicit false
    // group markers in the `modules` column) has chosen the module set —
    // `features` is authoritative there, and this add-only union must not
    // resurrect plan modules they toggled OFF.
    if (isEditorAuthoritative(org.modules)) {
      console.log(`  [SKIP]  ${org.slug}: editor-authoritative (explicit OFF markers in modules column)`)
      skippedAuthoritative++
      continue
    }

    const current = parseFeatures(org.features)
    const planDefaults = PLAN_DEFAULT_FEATURES[org.plan] || []

    // Modules the OLD hasModule() effectively granted this tenant — write them
    // into `features` so the new authoritative gate doesn't hide them on the
    // post-deploy restart. (Addon-granted modules are NOT backfilled: the
    // runtime gate grants them independently of `features`, so they can't be
    // lost.)
    let planModules
    if (NEW_TIER_PLANS.has(org.plan)) {
      // Old new-tier path granted BASE_PLAN_MODULES when `features` was sparse.
      planModules = BASE_PLAN_MODULES
    } else if (LEGACY_PLAN_MODULES[org.plan]) {
      // Old legacy path granted LEGACY_PLANS[plan].modules, ignoring `features`.
      planModules = LEGACY_PLAN_MODULES[org.plan]
    } else {
      // Unknown plan — conservative: keep base modules so nobody loses access.
      console.log(`  [WARN] ${org.slug}: unknown plan="${org.plan}" — applying BASE_PLAN_MODULES`)
      planModules = BASE_PLAN_MODULES
    }

    const target = [...new Set([...current, ...planModules, ...planDefaults])]
    const missing = target.filter((f) => !current.includes(f))

    if (missing.length === 0) {
      alreadyOk++
      continue
    }

    console.log(
      `  [PATCH] ${org.slug} (plan=${org.plan}): +[${missing.join(", ")}]  ` +
      `before=${current.length} after=${target.length}`,
    )

    if (execute) {
      await prisma.organization.update({
        where: { id: org.id },
        data: { features: target },
      })
    }
    touched++
  }

  console.log(
    `[backfill-base-modules] done. touched=${touched} alreadyOk=${alreadyOk} skippedAuthoritative=${skippedAuthoritative}`,
  )
  if (!execute && touched > 0) {
    console.log(`[backfill-base-modules] re-run with --execute to write ${touched} update(s)`)
  }
}

// Run ONLY when invoked directly (`node backfill-base-modules.mjs`). Importing
// this module (e.g. to read BACKFILL_VERSION) must stay side-effect free — see
// the note on BACKFILL_VERSION above.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
let prisma
if (isDirectRun) {
  prisma = await makeScriptPrisma()
  main()
    .catch((err) => {
      console.error("[backfill-base-modules] FAILED:", err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
