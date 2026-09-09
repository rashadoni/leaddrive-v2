// One-shot repair: reconcile every tenant's `Organization.modules` JSON column
// with its authoritative `Organization.features` array for the GROUP-module
// ids.
//
// WHY: the superadmin tenant editor (/admin/tenants/<id>/edit) edits `features`
// ONLY, but the runtime gate `hasModule` merges `features` WITH the `modules`
// column (moduleRecordFromOrgFields). Advisor Suite activation and capability
// grants write group-modules into the `modules` column, so a module the
// superadmin later toggles OFF in the editor stays granted — and visible in the
// tenant's sidebar — because the stale column keeps re-granting it. The editor
// PUT now reconciles on every save (src/lib/modules.ts reconcileModulesWithFeatures);
// this script repairs tenants that were saved BEFORE that fix shipped.
//
// Non-group keys in the `modules` column (capability-entitlement module ids that
// have no editor toggle) are PRESERVED — same rule as the runtime helper.
//
// Usage (per server — each client box has its own DB, see clients/registry.json):
//   node scripts/repair-tenant-module-visibility.mjs                 # dry-run, all tenants
//   node scripts/repair-tenant-module-visibility.mjs --slug=brandprotection   # dry-run, one tenant
//   node scripts/repair-tenant-module-visibility.mjs --slug=brandprotection --execute
//   node scripts/repair-tenant-module-visibility.mjs --execute       # write ALL tenants
//
// Idempotent: a second run is a no-op.

import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()

// Inline mirror of GROUP_MODULE_IDS in src/lib/modules.ts — the toggleable
// group-modules the admin editor controls. Update together with modules.ts.
const GROUP_MODULE_IDS = [
  "crm", "sales", "contracts", "marketing", "loyalty", "omnichannel", "voip", "support",
  "finance", "analytics", "mtm", "health", "insurance", "public-sector", "media",
  "energy", "settings",
]

// Inline mirror of ADDON_MODULES group-granting entries in src/lib/modules.ts —
// addons are a PARALLEL grant path (hasModule step 3) this repair does NOT
// touch (they have their own editor toggles). Reported so the operator sees
// which sidebar groups an addon keeps visible regardless of the repair.
const ADDON_GROUP_GRANTS = {
  channels: "omnichannel", voip: "voip", finance: "finance", mtm: "mtm",
  marketing: "marketing", loyalty: "loyalty",
}

// Inline mirror of the LEGACY_MODULE_MAP KEYS in src/lib/modules.ts (legacy →
// group expansion inputs). Preserved column keys from this set are reported —
// with the boolean-marker fix in hasModule step 3b they can no longer re-grant
// a group post-reconcile, but the operator should still know they exist.
const LEGACY_MODULE_IDS = new Set([
  "core", "deals", "leads", "tasks", "quotes", "offers", "projects", "companies",
  "contacts", "campaigns", "events", "journeys", "segments", "account-engagement", "voip",
  "inbox", "tickets", "knowledge-base", "kb", "portal", "invoices", "budgeting",
  "profitability", "pricing", "payments", "subscriptions", "reports", "workflows",
  "custom-fields", "currencies", "audit", "users", "inventory", "energy-utilities",
])

function parseFeatures(raw) {
  if (Array.isArray(raw)) return raw.filter((f) => typeof f === "string")
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "[]")
      return Array.isArray(parsed) ? parsed.filter((f) => typeof f === "string") : []
    } catch {
      return []
    }
  }
  return []
}

// Keep only boolean-valued keys, mirroring booleanModuleRecord() in modules.ts.
function booleanModuleRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const result = {}
  for (const [key, enabled] of Object.entries(value)) {
    if (typeof enabled === "boolean") result[key] = enabled
  }
  return result
}

// Same logic as reconcileModulesWithFeatures() in src/lib/modules.ts.
function reconcile(features, existingModules) {
  const featureSet = new Set(parseFeatures(features))
  const result = booleanModuleRecord(existingModules)
  for (const groupId of GROUP_MODULE_IDS) {
    result[groupId] = featureSet.has(groupId)
  }
  return result
}

// Stable JSON for change detection (keys sorted so ordering never causes a
// spurious diff / write).
function stable(record) {
  return JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))))
}

async function main() {
  const execute = process.argv.includes("--execute")
  const slugArg = process.argv.find((a) => a.startsWith("--slug="))
  const slug = slugArg ? slugArg.slice("--slug=".length) : null
  const mode = execute ? "EXECUTE" : "DRY-RUN"
  console.log(`[repair-module-visibility] mode=${mode}${slug ? ` slug=${slug}` : " (all tenants)"}`)

  const orgs = await prisma.organization.findMany({
    where: slug ? { slug } : undefined,
    select: { id: true, slug: true, name: true, features: true, modules: true, addons: true },
    orderBy: { slug: "asc" },
  })

  if (slug && orgs.length === 0) {
    console.error(`[repair-module-visibility] no tenant with slug="${slug}"`)
    process.exit(1)
  }
  console.log(`[repair-module-visibility] scanning ${orgs.length} organization(s)`)

  let touched = 0
  let alreadyOk = 0

  for (const org of orgs) {
    const before = booleanModuleRecord(org.modules)
    const after = reconcile(org.features, org.modules)

    // Parallel grant paths this repair does NOT touch — surfaced so a group
    // still visible after the repair is explainable from this log alone.
    const addons = Array.isArray(org.addons) ? org.addons.filter((a) => typeof a === "string") : []
    const addonGroups = [...new Set(
      addons.map((a) => ADDON_GROUP_GRANTS[a] ?? (GROUP_MODULE_IDS.includes(a) ? a : null)).filter(Boolean),
    )]
    if (addonGroups.length) {
      console.log(
        `  [NOTE]  ${org.slug}: addons=[${addons.join(", ")}] independently keep ` +
        `group(s) [${addonGroups.join(", ")}] visible — toggle addons in the editor if unwanted`,
      )
    }
    const legacyKeys = Object.keys(after).filter((k) => LEGACY_MODULE_IDS.has(k) && after[k] === true)
    if (legacyKeys.length) {
      console.log(
        `  [NOTE]  ${org.slug}: preserved legacy column key(s) [${legacyKeys.join(", ")}] ` +
        `(inert post-reconcile — hasModule's boolean-marker check pins the record group-shaped)`,
      )
    }

    if (stable(before) === stable(after)) {
      alreadyOk++
      continue
    }

    // Report which group-modules the reconcile turns off vs on.
    const disabled = GROUP_MODULE_IDS.filter((m) => before[m] === true && after[m] !== true)
    const enabled = GROUP_MODULE_IDS.filter((m) => before[m] !== true && after[m] === true)
    const parts = []
    if (disabled.length) parts.push(`-[${disabled.join(", ")}]`)
    if (enabled.length) parts.push(`+[${enabled.join(", ")}]`)
    console.log(`  [PATCH] ${org.slug}: ${parts.join(" ") || "(key normalisation)"}`)

    if (execute) {
      await prisma.organization.update({
        where: { id: org.id },
        data: { modules: after },
      })
    }
    touched++
  }

  console.log(`[repair-module-visibility] done. touched=${touched} alreadyOk=${alreadyOk}`)
  if (!execute && touched > 0) {
    console.log(`[repair-module-visibility] re-run with --execute to write ${touched} update(s)`)
  }
}

main()
  .catch((err) => {
    console.error("[repair-module-visibility] FAILED:", err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
