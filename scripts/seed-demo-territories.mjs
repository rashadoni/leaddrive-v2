// Demo seed: a few realistic Sales Territories (rules + member reps) so the
// /settings/territories screen looks alive for client demos instead of
// "Hələ ərazi yoxdur". Same spirit as the Arena demo seed.
//
// Org-scoped, dry-run by default, idempotent (skips a territory whose name
// already exists for the org). Run per server (each box has its own DB):
//   node scripts/seed-demo-territories.mjs --org=<slug-or-id>            # dry-run
//   node scripts/seed-demo-territories.mjs --org=<slug-or-id> --execute  # write
//
// Rollback (precise): delete the three named territories (memberships cascade):
//   DELETE FROM territories WHERE "organizationId"='<org-id>'
//     AND name IN ('Azərbaycan — Pərakəndə','Türkiyə — Korporativ','Azərbaycan — Texnologiya');
//
// NOTE: auto-routing (lib/territory-routing.ts) fires on COMPANY CREATE — to
// see it in a demo, create a company with country=AZ + industry=Retail and the
// "Azərbaycan — Pərakəndə" reps get a notification.

import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()

const args = process.argv.slice(2)
const execute = args.includes("--execute")
const orgArg = (args.find((a) => a.startsWith("--org=")) || "").split("=")[1]

if (!orgArg) {
  console.error("✗ --org=<slug-or-id> is required.")
  process.exit(1)
}

// Each territory: name + human description + rules (matched by territory-rules.ts)
// + how many member reps to assign from the org's active-user pool.
const TERRITORIES = [
  {
    name: "Azərbaycan — Pərakəndə",
    description: "Azərbaycanda pərakəndə (≤500 işçi) müştərilər",
    rules: { countries: ["AZ"], industries: ["Retail"], companySizeMin: 1, companySizeMax: 500 },
    memberCount: 2,
  },
  {
    name: "Türkiyə — Korporativ",
    description: "Türkiyədə korporativ (≥500 işçi) müştərilər",
    rules: { countries: ["TR"], companySizeMin: 500 },
    memberCount: 2,
  },
  {
    name: "Azərbaycan — Texnologiya",
    description: "Azərbaycanda texnologiya / IT şirkətləri",
    rules: { countries: ["AZ"], industries: ["Technology"] },
    memberCount: 1,
  },
]

async function main() {
  const org = await prisma.organization.findFirst({
    where: { OR: [{ slug: orgArg }, { id: orgArg }] },
    select: { id: true, slug: true, name: true },
  })
  if (!org) {
    console.error(`✗ Organization not found for --org="${orgArg}"`)
    process.exit(1)
  }
  console.log(`Org: ${org.name} (${org.slug} / ${org.id})`)

  const users = await prisma.user.findMany({
    where: { organizationId: org.id, isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
    take: 12,
  })
  if (users.length === 0) {
    console.error("✗ No active users in this org — cannot assign territory members.")
    process.exit(1)
  }
  console.log(`Active users available for membership: ${users.length}`)

  const existing = await prisma.territory.findMany({
    where: { organizationId: org.id },
    select: { name: true },
  })
  const existingNames = new Set(existing.map((t) => t.name))

  let pool = 0 // round-robin index into users
  const plan = []
  for (const def of TERRITORIES) {
    if (existingNames.has(def.name)) {
      console.log(`  • "${def.name}" — already exists, skipping`)
      continue
    }
    const members = []
    for (let i = 0; i < def.memberCount && users.length > 0; i++) {
      members.push(users[pool % users.length])
      pool++
    }
    plan.push({ def, members })
    console.log(
      `  + "${def.name}"  rules=${JSON.stringify(def.rules)}  members=[${members.map((m) => m.name).join(", ")}]`,
    )
  }

  if (plan.length === 0) {
    console.log("\nNothing to create (all already exist).")
    return
  }
  if (!execute) {
    console.log(`\nDRY-RUN — would create ${plan.length} territory(ies). Re-run with --execute.`)
    return
  }

  let created = 0
  for (const { def, members } of plan) {
    await prisma.territory.create({
      data: {
        organizationId: org.id,
        name: def.name,
        description: def.description,
        isActive: true,
        rules: def.rules,
        members: {
          create: members.map((m) => ({ userId: m.id })),
        },
      },
    })
    created++
  }
  console.log(`\n✓ Created ${created} territory(ies) for ${org.slug}.`)
}

main()
  .catch((e) => {
    console.error("✗ Seed failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
