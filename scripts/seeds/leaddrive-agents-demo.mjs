// Make the Route & Field → Agents page demonstrable: give existing demo agents
// varied lastSeenAt (some online, some hours/days ago), app-install tokens on
// most, and a manager for grouping. UPDATE-only on demo agents; adds nothing.
//
//   CONFIRM_PROD=1 node scripts/seeds/leaddrive-agents-demo.mjs --slug=leaddrive

import { makeScriptPrisma } from "../_rls.mjs"
const prisma = await makeScriptPrisma()
if (!process.env.CONFIRM_PROD) { console.error("Refusing without CONFIRM_PROD=1"); process.exit(1) }
const SLUG = process.argv.find(a => a.startsWith("--slug="))?.split("=")[1] || "leaddrive"
const org = await prisma.organization.findUnique({ where: { slug: SLUG } })
if (!org) { console.error(`Org "${SLUG}" not found`); process.exit(1) }
const orgId = org.id

const agents = await prisma.mtmAgent.findMany({ where: { organizationId: orgId, status: "ACTIVE" } })
const managers = agents.filter(a => a.role === "MANAGER" || a.role === "SUPERVISOR")
const now = Date.now()
const minsAgo = (m) => new Date(now - m * 60000)
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))

let online = 0, installed = 0, assigned = 0
for (let i = 0; i < agents.length; i++) {
  const a = agents[i]
  const bucket = i % 3 // 0 = online (just now), 1 = hours, 2 = days
  const lastSeenAt = bucket === 0 ? minsAgo(rnd(0, 2)) : bucket === 1 ? minsAgo(rnd(60, 480)) : minsAgo(rnd(1440, 12960))
  const hasApp = i % 4 !== 3 // ~75% have the app installed
  const data = { lastSeenAt, isOnline: bucket === 0, expoPushToken: hasApp ? `ExpoDemo-${a.id.slice(-8)}` : null }
  if (a.role === "AGENT" && !a.managerId && managers.length) { data.managerId = managers[i % managers.length].id; assigned++ }
  await prisma.mtmAgent.update({ where: { id: a.id }, data })
  if (bucket === 0) online++
  if (hasApp) installed++
}
console.log(`Updated ${agents.length} agents → online=${online}, app-installed=${installed}, manager-assigned=${assigned}`)
await prisma.$disconnect()
