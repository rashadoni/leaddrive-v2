// One-shot backfill: re-attach plan-default features to Organization.features
// for tenants that pre-date them.
//
// Why: commit 560bf202 dropped the `plan === "enterprise"` short-circuit in the
// sidebar, so the gate now flows through `hasModule` + `org.modules` for every
// non-superadmin role. Tenants whose `Organization.features` was never updated
// to include defaults like `complaints_register` lost the corresponding menu
// items overnight. This script re-injects only the *plan-tier defaults* the
// tenant is missing — admin-driven OFF toggles for module features (`mtm`,
// `voip` etc.) live in the same array, but plan-tier defaults are a fixed
// allow-list mirrored from src/lib/tenant-plans.ts, so we never re-enable
// anything the admin removed deliberately.
//
// Idempotent: running twice is a no-op. Default mode is dry-run; pass
// --execute to write.
//
// Usage (on the target server, from the project root):
//   node scripts/backfill-plan-features.mjs              # dry-run, prints diff
//   node scripts/backfill-plan-features.mjs --execute    # actually writes

import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()

// Mirror of src/lib/tenant-plans.ts — kept inline so the .mjs script doesn't
// need TS compilation. Update both files together if plan defaults change.
const PLAN_DEFAULT_FEATURES = {
  starter: [],
  professional: ["whatsapp", "ai", "complaints_register"],
  enterprise: ["whatsapp", "ai", "voip", "portal", "events", "complaints_register"],
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
  console.log(`[backfill-plan-features] mode=${mode}`)

  const orgs = await prisma.organization.findMany({
    select: { id: true, slug: true, name: true, plan: true, features: true },
    orderBy: { slug: "asc" },
  })

  console.log(`[backfill-plan-features] scanning ${orgs.length} organization(s)`)

  let wouldPatch = 0
  let alreadyOk = 0
  let unknownPlan = 0

  for (const org of orgs) {
    const planDefaults = PLAN_DEFAULT_FEATURES[org.plan]
    if (!planDefaults) {
      console.log(`  [SKIP] ${org.slug}: unknown plan="${org.plan}"`)
      unknownPlan++
      continue
    }

    const current = parseFeatures(org.features)
    const missing = planDefaults.filter((f) => !current.includes(f))

    if (missing.length === 0) {
      alreadyOk++
      continue
    }

    const merged = Array.from(new Set([...current, ...missing]))
    console.log(
      `  [PATCH] ${org.slug} (plan=${org.plan}): +[${missing.join(", ")}]  ` +
      `before=${current.length} after=${merged.length}`,
    )

    if (execute) {
      await prisma.organization.update({
        where: { id: org.id },
        data: { features: merged },
      })
    }
    wouldPatch++
  }

  const verb = execute ? "patched" : "wouldPatch"
  console.log(
    `[backfill-plan-features] done. ${verb}=${wouldPatch} alreadyOk=${alreadyOk} unknownPlan=${unknownPlan}`,
  )
  if (!execute && wouldPatch > 0) {
    console.log(`[backfill-plan-features] re-run with --execute to write ${wouldPatch} update(s)`)
  }
}

main()
  .catch((err) => {
    console.error("[backfill-plan-features] FAILED:", err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
