// READ-ONLY: who are the REAL (non-demo) users/agents in the org, and which KPI
// Arena board (if any) each qualifies for. Answers "why isn't <real user> on the
// leaderboard". Writes nothing.
//
//   CONFIRM_PROD=1 node --env-file=/etc/leaddrive/app.env scripts/seeds/arena-roster-audit.mjs --slug=leaddrive

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
function getArg(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : null
}
const slug = getArg("slug") || "leaddrive"
const DEMO = "@arena-demo.local"

const org = await prisma.organization.findUnique({ where: { slug } })
if (!org) { console.error(`Org not found: ${slug}`); process.exit(1) }
const orgId = org.id
console.log(`Tenant: ${org.name} (${orgId})\n`)

// ── ALL real (non-demo) USER accounts + board eligibility ──
const users = await prisma.user.findMany({
  where: { organizationId: orgId, NOT: { email: { endsWith: DEMO } } },
  select: { id: true, name: true, email: true, role: true, isActive: true },
  orderBy: { name: "asc" },
})
console.log(`=== REAL User accounts (non-demo): ${users.length} ===`)
console.log(`(Boards: Tickets needs role=support + resolved tickets; Sales needs a SalesQuota this quarter; Projects needs managed projects; Tasks needs completed tasks. MTM board is a SEPARATE table — Users never appear there.)\n`)
const now = new Date()
const year = now.getFullYear(), quarter = Math.floor(now.getMonth() / 3) + 1
for (const u of users) {
  const [resolvedTickets, quota, projects, tasks] = await Promise.all([
    prisma.ticket.count({ where: { organizationId: orgId, assignedTo: u.id, resolvedAt: { not: null } } }),
    prisma.salesQuota.findFirst({ where: { organizationId: orgId, userId: u.id, year, quarter }, select: { amount: true } }),
    prisma.project.count({ where: { organizationId: orgId, managerId: u.id, status: { not: "cancelled" } } }),
    prisma.task.count({ where: { organizationId: orgId, assignedTo: u.id, completedAt: { not: null } } }),
  ])
  const boards = []
  if (u.role === "support" && resolvedTickets > 0) boards.push("Tickets")
  if (quota) boards.push("Sales")
  if (projects > 0) boards.push("Projects")
  if (tasks > 0) boards.push("Tasks")
  console.log(
    `  ${(u.name || "(no name)").padEnd(24)} ${u.email.padEnd(30)} role=${(u.role || "?").padEnd(8)} active=${u.isActive}` +
    `  | resolvedTickets=${resolvedTickets} quota=${quota ? "yes" : "no"} projects=${projects} tasks=${tasks}` +
    `  → boards: ${boards.length ? boards.join(",") : "NONE"}`,
  )
}

// ── ALL real (non-demo) MTM agents (the MTM board's roster) ──
const mtm = await prisma.mtmAgent.findMany({
  where: { organizationId: orgId, NOT: { email: { endsWith: DEMO } } },
  select: { name: true, email: true, status: true },
  orderBy: { name: "asc" },
})
console.log(`\n=== REAL MtmAgents (non-demo) — the MTM board roster: ${mtm.length} ===`)
for (const a of mtm) console.log(`  ${(a.name || "(no name)").padEnd(24)} ${(a.email || "(no email)").padEnd(30)} status=${a.status}`)

await prisma.$disconnect()
