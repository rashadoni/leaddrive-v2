// READ-ONLY proof that the KPI Arena demo data is REAL rows in the prod DB
// (actual Users/Tickets/Tasks/Projects/MtmAgents/Deals/SalesQuotas), not a UI mock.
// For each demo agent it prints the work actually ASSIGNED to them in the database.
//
//   CONFIRM_PROD=1 node --env-file=/etc/leaddrive/app.env scripts/seeds/arena-demo-verify.mjs --slug=leaddrive
//
// Writes nothing. Pure counts + samples straight from the same DB the app reads.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
function getArg(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : null
}
const slug = getArg("slug") || "leaddrive"
const MARKER = "@arena-demo.local"

const org = await prisma.organization.findUnique({ where: { slug } })
if (!org) {
  console.error(`Organization not found (slug "${slug}")`)
  process.exit(1)
}
const orgId = org.id
console.log(`Tenant: ${org.name} (${slug}) — ${orgId}\n`)

// ── CRM demo users (support) → tickets / tasks / projects ──
const crmUsers = await prisma.user.findMany({
  where: { organizationId: orgId, email: { startsWith: "agent", endsWith: MARKER } },
  select: { id: true, name: true, role: true, email: true },
  orderBy: { email: "asc" },
})
console.log(`=== CRM demo USERS (role=support) in DB: ${crmUsers.length} ===`)
for (const u of crmUsers) {
  const [tickets, tasks, projects] = await Promise.all([
    prisma.ticket.count({ where: { organizationId: orgId, assignedTo: u.id } }),
    prisma.task.count({ where: { organizationId: orgId, assignedTo: u.id } }),
    prisma.project.count({ where: { organizationId: orgId, managerId: u.id } }),
  ])
  console.log(`  ${u.name.padEnd(22)} ${u.email.padEnd(26)} role=${u.role}  → tickets=${tickets} tasks=${tasks} projects=${projects}`)
}

// ── Sales demo reps → quota + WON deals ──
const salesUsers = await prisma.user.findMany({
  where: { organizationId: orgId, email: { startsWith: "salesrep", endsWith: MARKER } },
  select: { id: true, name: true, email: true, role: true },
  orderBy: { email: "asc" },
})
console.log(`\n=== Sales demo REPS (role=sales) in DB: ${salesUsers.length} ===`)
for (const u of salesUsers) {
  const quota = await prisma.salesQuota.findFirst({
    where: { organizationId: orgId, userId: u.id },
    select: { amount: true, year: true, quarter: true },
  })
  const deals = await prisma.deal.aggregate({
    where: { organizationId: orgId, assignedTo: u.id, stage: "WON" },
    _count: true,
    _sum: { valueAmount: true },
  })
  console.log(`  ${u.name.padEnd(22)} role=${u.role}  → quota=${quota?.amount} (Q${quota?.quarter}/${quota?.year}) wonDeals=${deals._count} wonSum=${deals._sum.valueAmount}`)
}

// ── MTM demo agents → tasks / photos / routes ──
const mtmAgents = await prisma.mtmAgent.findMany({
  where: { organizationId: orgId, email: { endsWith: MARKER } },
  select: { id: true, name: true, email: true },
  orderBy: { email: "asc" },
})
console.log(`\n=== MTM demo AGENTS in DB: ${mtmAgents.length} ===`)
for (const a of mtmAgents) {
  const [tasks, photos, routes] = await Promise.all([
    prisma.mtmTask.count({ where: { organizationId: orgId, agentId: a.id } }),
    prisma.mtmPhoto.count({ where: { organizationId: orgId, agentId: a.id } }),
    prisma.mtmRoute.count({ where: { organizationId: orgId, agentId: a.id } }),
  ])
  console.log(`  ${a.name.padEnd(22)} → mtmTasks=${tasks} photos=${photos} routes=${routes}`)
}

// ── Grand totals ──
const [ademoTickets, sdemoDeals, demoQuotas] = await Promise.all([
  prisma.ticket.count({ where: { organizationId: orgId, ticketNumber: { startsWith: "ADEMO-" } } }),
  prisma.deal.count({ where: { organizationId: orgId, name: { startsWith: "SDEMO-" } } }),
  prisma.salesQuota.count({ where: { organizationId: orgId, userId: { in: salesUsers.map((u) => u.id) } } }),
])
console.log(`\n=== GRAND TOTALS (real rows in prod DB) ===`)
console.log(`  demo Users: ${crmUsers.length + salesUsers.length} (support ${crmUsers.length} + sales ${salesUsers.length})`)
console.log(`  demo MtmAgents: ${mtmAgents.length}`)
console.log(`  ADEMO- Tickets: ${ademoTickets}   SDEMO- Deals: ${sdemoDeals}   SalesQuotas: ${demoQuotas}`)

await prisma.$disconnect()
