// Seed demo SALES reps for the KPI Arena's Sales (Satış) board. The sales
// aggregator ranks reps on won-deal value ÷ quarterly quota, so we create a
// SalesQuota for the CURRENT quarter + WON deals summing to a known attainment %.
//
//   attainment = Σ(WON deal valueAmount this quarter) ÷ quota × 100
//
// Companion to arena-demo.mjs (MTM) + arena-demo-crm.mjs (tickets/projects/tasks).
//
// Usage (ON THE PROD SERVER):
//   CONFIRM_PROD=1 node --env-file=/etc/leaddrive/app.env scripts/seeds/arena-demo-sales.mjs --slug=leaddrive
//   CONFIRM_PROD=1 node --env-file=/etc/leaddrive/app.env scripts/seeds/arena-demo-sales.mjs --slug=leaddrive --clean
//
// Footprint: demo USERS (role=sales) in the Users list + their WON deals in the
// Deals/pipeline/revenue views (demo tenant only). Tagged email
// "salesrep{N}@arena-demo.local" + deal name prefix "SDEMO-" → --clean removes
// exactly those (real reps + real deals untouched). Idempotent re-run.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
if (!process.env.CONFIRM_PROD) {
  console.error("Refusing to run without CONFIRM_PROD=1 (writes data).")
  process.exit(1)
}
function getArg(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : null
}
const MARKER = "@arena-demo.local"
const DEAL_PREFIX = "SDEMO-"
const CLEAN = process.argv.includes("--clean")
const slug = getArg("slug") || "leaddrive"

// [name, quotaAmount(AZN), attainmentPct] — won total = quota × pct/100, split over 3 deals.
const REPS = [
  ["Orxan Səfərov", 60000, 100], // huge green
  ["Aysel Quliyeva", 50000, 88], // green
  ["Günay Hüseynova", 55000, 92], // green
  ["Elvin Cəfərov", 50000, 84], // green
  ["Rauf Məmmədov", 50000, 70], // amber
  ["Nigar Hacıyeva", 45000, 63], // amber
  ["Tural Əliyev", 45000, 52], // orange
  ["Sevinc Abbasova", 40000, 41], // orange
  ["Kamran İsmayılov", 40000, 27], // red
  ["Leyla Vəliyeva", 35000, 14], // deep red
]

async function main() {
  let org = await prisma.organization.findUnique({ where: { slug } })
  if (!org) {
    const known = await prisma.mtmAgent.findFirst({ where: { name: "Farid Aliyev" }, select: { organizationId: true } })
    if (known) org = await prisma.organization.findUnique({ where: { id: known.organizationId } })
  }
  if (!org) {
    console.error(`Organization not found (slug "${slug}"). Pass --slug=<tenant>.`)
    process.exit(1)
  }
  const orgId = org.id
  console.log(`Tenant: ${org.name} (${slug}) — ${orgId}`)

  const now = new Date()
  const year = now.getFullYear()
  const quarter = Math.floor(now.getMonth() / 3) + 1

  if (CLEAN) {
    const demo = await prisma.user.findMany({
      where: { organizationId: orgId, email: { startsWith: "salesrep", endsWith: MARKER } },
      select: { id: true },
    })
    const ids = demo.map((u) => u.id)
    await prisma.deal.deleteMany({ where: { organizationId: orgId, name: { startsWith: DEAL_PREFIX } } })
    if (ids.length) {
      await prisma.salesQuota.deleteMany({ where: { organizationId: orgId, userId: { in: ids } } })
      await prisma.user.deleteMany({ where: { id: { in: ids } } })
    }
    console.log(`Removed ${ids.length} demo sales reps + their quotas/deals.`)
    return
  }

  let i = 0
  for (const [name, quota, pct] of REPS) {
    i++
    const email = "salesrep" + i + MARKER
    let user = await prisma.user.findFirst({ where: { organizationId: orgId, email } })
    if (!user) {
      user = await prisma.user.create({
        data: {
          organizationId: orgId,
          email,
          name,
          role: "sales",
          isActive: true,
          passwordHash: "DEMO-DISABLED-NO-LOGIN",
          avatar: `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
        },
      })
    }
    const uid = user.id

    // idempotent re-run: clear this rep's prior quota (this quarter) + demo deals
    await prisma.salesQuota.deleteMany({ where: { organizationId: orgId, userId: uid, year, quarter } })
    await prisma.deal.deleteMany({ where: { organizationId: orgId, assignedTo: uid, name: { startsWith: DEAL_PREFIX } } })

    await prisma.salesQuota.create({
      data: { organizationId: orgId, userId: uid, year, quarter, amount: quota, currency: "AZN" },
    })

    // Won-deal value summing exactly to quota×pct/100, split over 3 deals (50/30/rest).
    const wonTotal = Math.round((quota * pct) / 100)
    const a = Math.round(wonTotal * 0.5)
    const b = Math.round(wonTotal * 0.3)
    const parts = [a, b, wonTotal - a - b].filter((v) => v > 0)
    await prisma.deal.createMany({
      data: parts.map((v, k) => ({
        organizationId: orgId,
        name: `${DEAL_PREFIX}${name.split(" ")[0]} ${k + 1}`,
        stage: "WON",
        valueAmount: v,
        currency: "AZN",
        assignedTo: uid,
        probability: 100,
      })),
    })
    console.log(`✓ ${name}  quota ${quota}  won ${wonTotal} (${pct}%)`)
  }
  console.log(`Done: ${i} demo sales reps seeded for "${slug}".`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
