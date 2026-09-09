// One-shot backfill (MC-T8): ensure every tenant's `Organization.features`
// contains the GROUP-module ids implied by its current legacy-id features —
// plus the universal `crm` + `settings` groups every tenant gets — so the
// group-tagged nav/gates (feat/module-catalog branch) keep sections visible
// once a record is later saved in NEW vocabulary (which flips hasModule's 3b
// legacy expansion OFF for that record).
//
// Run AFTER deploying the feat/module-catalog branch, per server (each
// client box has its own DB — see clients/registry.json):
//   node scripts/backfill-group-modules.mjs              # dry-run
//   node scripts/backfill-group-modules.mjs --execute    # actually writes
//
// Add-only union: legacy ids are RETAINED (rollback-safe; the runtime gate
// ignores stale ids it no longer knows). Idempotent — second run is a no-op.
// scripts/backfill-base-modules.mjs is intentionally frozen on the OLD legacy
// vocabulary (see BASE_PLAN_MODULES note in src/lib/modules.ts); the group-id
// backfill lives HERE.

import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()

/**
 * Versioned ledger tag (per-deploy server-deploy.sh skip-check, same
 * convention as backfill-base-modules.mjs). BUMP when MAP/universal set
 * changes and a re-run is required.
 */
export const BACKFILL_VERSION = "v2"

// Inline mirror of src/lib/modules.ts LEGACY_MODULE_MAP PLUS the
// explicit identity keys (contracts/mtm/health/insurance/public-sector/
// media/energy) so industry/identity tenants visibly map to their group.
// Update together with modules.ts if the map changes.
const MAP = {
  // crm (shared relationship core) + sales (deals/leads/quotes/offers carved out)
  core: "crm", deals: "sales", leads: "sales", tasks: "crm", quotes: "sales",
  offers: "sales", projects: "crm", companies: "crm", contacts: "crm",
  // marketing + loyalty
  campaigns: "marketing", events: "marketing", journeys: "marketing",
  segments: "marketing", loyalty: "loyalty", "account-engagement": "marketing",
  // omnichannel
  omnichannel: "omnichannel", inbox: "omnichannel",
  // social monitoring — own group-module since the 2026-08-01 split. Identity
  // entry only (no legacy id ever meant "social monitoring"), so it changes
  // nothing for existing records: prod tenants got `social` from migration
  // 20260801090000_social_module_split, hence NO version bump / re-run needed.
  social: "social",
  // permission-scope юридического контура (admin-only) — тот же тенантный
  // модуль; зеркалим LEGACY_MODULE_MAP, чтобы drift-гард не падал. Как и
  // `social`, фича-идентификатором никогда не бывает → на бэкфилл не влияет.
  "social-legal": "social",
  // VoIP is both a paid add-on id and the identity id of its standalone
  // post-call analytics group.
  voip: "voip",
  // support
  tickets: "support", "knowledge-base": "support", kb: "support", portal: "support",
  // finance
  invoices: "finance", budgeting: "finance", profitability: "finance",
  pricing: "finance", payments: "finance", subscriptions: "finance", finance: "finance",
  // analytics
  reports: "analytics",
  // settings
  workflows: "settings", "custom-fields": "settings", currencies: "settings",
  audit: "settings", users: "settings", settings: "settings",
  // identity / industry groups
  contracts: "contracts",
  inventory: "mtm", mtm: "mtm",
  health: "health", insurance: "insurance", "public-sector": "public-sector",
  media: "media",
  "energy-utilities": "energy", energy: "energy",
}

// Every tenant gets these groups unconditionally (CRM + Settings are the
// universal core groups; superadmin can still toggle them off later in
// /admin/tenants/<id>/edit — this backfill is a one-shot floor, not a cron).
const UNIVERSAL_GROUPS = ["crm", "settings"]
const LOYALTY_CONTINUITY_KEYS = [
  "marketing", "campaigns", "events", "journeys", "segments", "account-engagement",
]

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
  console.log(`[backfill-group-modules] mode=${mode}`)

  const orgs = await prisma.organization.findMany({
    select: { id: true, slug: true, name: true, plan: true, features: true },
    orderBy: { slug: "asc" },
  })

  console.log(`[backfill-group-modules] scanning ${orgs.length} organization(s)`)

  let touched = 0
  let alreadyOk = 0

  for (const org of orgs) {
    const current = parseFeatures(org.features)

    // Groups implied by the tenant's existing feature ids + the universal pair.
    const groups = [
      ...UNIVERSAL_GROUPS,
      ...current.map((f) => MAP[f]).filter(Boolean),
    ]
    if (current.some((f) => LOYALTY_CONTINUITY_KEYS.includes(f))) {
      groups.push("loyalty")
    }
    const target = [...new Set([...current, ...groups])]
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
    `[backfill-group-modules] done. touched=${touched} alreadyOk=${alreadyOk}`,
  )
  if (!execute && touched > 0) {
    console.log(`[backfill-group-modules] re-run with --execute to write ${touched} update(s)`)
  }
}

main()
  .catch((err) => {
    console.error("[backfill-group-modules] FAILED:", err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
