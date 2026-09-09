export {}

/**
 * Cleanup stale cross-tenant MtmAgent rows in the local dev DB.
 *
 * The mobile-auth `findFirst({email})` legacy path (F-35) picks one row
 * non-deterministically when the same email exists in multiple orgs. On
 * machines where multiple seed scripts have run over time, agents like
 * `farid@leaddrivecrm.org` end up in 3+ orgs and login becomes a
 * coin-flip even after F-35's slug path lands.
 *
 * This script does NOT auto-delete — it prints the duplicates it would
 * remove and exits unless you pass `--apply`. Even with --apply, it only
 * touches local DBs (refuses to run against URLs that look like prod).
 *
 * Usage:
 *   npx tsx scripts/cleanup-stale-mtm-agents.ts          # dry-run
 *   npx tsx scripts/cleanup-stale-mtm-agents.ts --apply  # actually delete
 *
 * The org slug `leaddrive` is treated as the "keep" tenant. Adjust the
 * KEEP_SLUGS constant below if your demo lives elsewhere.
 */

import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

// Orgs whose rows we never touch. Anything outside this list is fair game
// when its email collides with rows that DO live inside.
const KEEP_SLUGS = ["leaddrive", "leaddrive-inc"]
const APPLY = process.argv.includes("--apply")

async function main() {
  prisma = await makeScriptPrisma()
  const url = process.env.DATABASE_URL || ""
  // Be paranoid about prod URLs. Local Postgres typically reads as
  // `postgresql://user@localhost:...` — anything with a remote host
  // refuses to run.
  if (url && !/@(localhost|127\.0\.0\.1)/.test(url)) {
    console.error("❌ DATABASE_URL does not point at localhost — refusing to run.")
    console.error(`   url=${url}`)
    process.exit(1)
  }

  const keepOrgs = await prisma.organization.findMany({
    where: { slug: { in: KEEP_SLUGS } },
    select: { id: true, slug: true },
  })
  const keepOrgIds = new Set(keepOrgs.map((o) => o.id))
  if (keepOrgIds.size === 0) {
    console.error("❌ None of KEEP_SLUGS found locally — aborting so we don't delete blindly.")
    process.exit(1)
  }
  console.log(`✅ keep orgs: ${keepOrgs.map((o) => o.slug).join(", ")}`)

  // Find emails that exist BOTH inside and outside the keep set.
  const emailsInKeep = await prisma.mtmAgent.findMany({
    where: { organizationId: { in: [...keepOrgIds] } },
    select: { email: true },
  })
  const emails = [...new Set(emailsInKeep.map((a) => a.email).filter((e): e is string => !!e))]
  if (emails.length === 0) {
    console.log("No agents in keep orgs — nothing to compare against.")
    return
  }

  const dups = await prisma.mtmAgent.findMany({
    where: {
      email: { in: emails },
      organizationId: { notIn: [...keepOrgIds] },
    },
    include: { organization: { select: { slug: true, name: true } } },
  })

  if (dups.length === 0) {
    console.log("✅ No stale cross-tenant duplicates. Nothing to do.")
    return
  }

  console.log(`\nFound ${dups.length} stale row(s):`)
  for (const d of dups) {
    console.log(`  - ${d.email} in ${d.organization?.slug || "?"} (${d.organization?.name || "?"}) — agentId=${d.id}`)
  }

  if (!APPLY) {
    console.log("\nDry-run. Pass --apply to actually delete these rows.")
    return
  }

  // Delete dependent rows first (Prisma onDelete: SetNull for audit, but
  // visits/orders/etc are required). Skip agents that have any traffic to
  // avoid silent data loss — operator can decide manually.
  let deleted = 0
  for (const d of dups) {
    const used =
      (await prisma.mtmVisit.count({ where: { agentId: d.id } })) +
      (await prisma.mtmPhoto.count({ where: { agentId: d.id } }))
    if (used > 0) {
      console.log(`  ⚠️  ${d.email} in ${d.organization?.slug} has ${used} dependent row(s) — skipped.`)
      continue
    }
    await prisma.mtmAgent.delete({ where: { id: d.id } })
    deleted++
    console.log(`  ✓ deleted ${d.email} in ${d.organization?.slug}`)
  }
  console.log(`\nDone. Deleted ${deleted}/${dups.length}.`)
}

main()
  .catch((err) => {
    console.error("❌ Cleanup failed:", err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
