// One-shot backfill: ensure every tenant's `Organization.features` contains the
// new `sales` group-module. `sales` was carved out of `crm` — deals/leads/quotes
// (and the sequences/forecast/territories/quotas pages) now gate on `sales`
// instead of `crm`. `sales` is a BASE module for any CRM tenant: this backfill
// grants it to every tenant that ALREADY had CRM / deals-leads-quotes access
// (see CRM_OR_SALES_FAMILY below) so no one loses their pipeline once the gate
// flips. Tenants with no crm/sales-family feature (e.g. marketing-only) are
// SKIPPED — granting them Sales would be a NEW entitlement they never had.
//
// A runtime TRANSITION SHIM in src/lib/modules.ts (hasModule step 3c) grants
// `sales` to anyone with `crm` so the deploy→backfill window is already safe;
// this backfill makes the grant EXPLICIT in `features` so the shim can later be
// removed and `sales` becomes independently toggleable in /admin/tenants/<id>/edit.
//
// Run per server (each client box has its own DB — see clients/registry.json):
//   node scripts/backfill-sales-module.mjs              # dry-run
//   node scripts/backfill-sales-module.mjs --execute    # actually writes
//
// Add-only union: existing ids are RETAINED (rollback-safe). Idempotent — a
// second run is a no-op.

import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()

/** Versioned ledger tag — BUMP if the grant set changes and a re-run is needed. */
export const BACKFILL_VERSION = "v1"

// `sales` is granted ONLY to tenants that already had CRM/sales-data access —
// i.e. that faithfully mirrors the hasModule step-3c shim (`crm ⇒ sales`) so the
// backfill never grants Sales to a tenant that legitimately shouldn't have it
// (e.g. a marketing-only org). A tenant qualifies if its `features` contain the
// `crm`/`sales` group ids OR any legacy id that mapped to crm/sales under the OLD
// vocabulary (deals/leads/quotes/offers were crm-gated before the carve-out, so
// those tenants had deals/leads access and must keep it).
const GRANT_GROUPS = ["sales"]
const CRM_OR_SALES_FAMILY = new Set([
  "crm", "sales",
  "core", "companies", "contacts", "tasks", "projects", // legacy → crm
  "deals", "leads", "quotes", "offers",                  // legacy → (was crm) now sales
])

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
  console.log(`[backfill-sales-module] mode=${mode}`)

  const orgs = await prisma.organization.findMany({
    select: { id: true, slug: true, name: true, plan: true, features: true },
    orderBy: { slug: "asc" },
  })

  console.log(`[backfill-sales-module] scanning ${orgs.length} organization(s)`)

  let touched = 0
  let alreadyOk = 0

  let skippedNonCrm = 0
  for (const org of orgs) {
    const current = parseFeatures(org.features)

    // Only grant `sales` to tenants that had CRM/sales-data access (mirror the
    // shim). A tenant with no crm/sales-family id never had deals/leads/quotes —
    // granting sales would be a NEW entitlement, so skip it.
    const qualifies = current.some((f) => CRM_OR_SALES_FAMILY.has(f))
    if (!qualifies) {
      skippedNonCrm++
      console.log(`  [SKIP] ${org.slug} (plan=${org.plan}): no crm/sales-family feature → not a Sales tenant`)
      continue
    }

    const target = [...new Set([...current, ...GRANT_GROUPS])]
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
    `[backfill-sales-module] done. touched=${touched} alreadyOk=${alreadyOk} skippedNonCrm=${skippedNonCrm}`,
  )
  if (!execute && touched > 0) {
    console.log(`[backfill-sales-module] re-run with --execute to write ${touched} update(s)`)
  }
}

main()
  .catch((err) => {
    console.error("[backfill-sales-module] FAILED:", err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
