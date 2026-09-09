// Seed realistic, BACKDATED MTM activity into an existing tenant so the
// Route & Field → Analytics page has meaningful weekly/monthly/yearly data.
//
// Why backdate createdAt: the analytics API filters + groups by `createdAt`
// (not checkInAt), so records must carry real past createdAt values or the
// trend / weekly-comparison charts stay flat. The visit-create API can't set
// createdAt, hence this direct (RLS-bypass) prisma seed.
//
// Idempotent: every row is tagged with MARK in notes/description; re-running
// skips unless --force. Only ADDS demo rows; never edits/deletes existing data.
//
// Usage (on the server, DATABASE_URL = prod):
//   CONFIRM_PROD=1 node scripts/seeds/leaddrive-analytics.mjs --slug=leaddrive
//   CONFIRM_PROD=1 node scripts/seeds/leaddrive-analytics.mjs --slug=leaddrive --force

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()

if (!process.env.CONFIRM_PROD) {
  console.error("Refusing to run without CONFIRM_PROD=1 (writes demo MTM data). Re-run:\n  CONFIRM_PROD=1 node scripts/seeds/leaddrive-analytics.mjs --slug=leaddrive")
  process.exit(1)
}

const getArg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? null
const hasFlag = (n) => process.argv.includes(`--${n}`)
const SLUG = getArg("slug") || "leaddrive"
const MARK = "[analytics-demo]"

const org = await prisma.organization.findUnique({ where: { slug: SLUG } })
if (!org) { console.error(`Org "${SLUG}" not found.`); process.exit(1) }
const orgId = org.id
console.log(`Tenant "${SLUG}" → ${orgId}`)

const already = await prisma.mtmVisit.count({ where: { organizationId: orgId, notes: { contains: MARK } } })
if (already > 0 && !hasFlag("force")) {
  console.log(`Already seeded (${already} tagged visits). Pass --force to add more. Nothing to do.`)
  await prisma.$disconnect(); process.exit(0)
}

const agents = await prisma.mtmAgent.findMany({ where: { organizationId: orgId, status: "ACTIVE" }, take: 8 })
const customers = await prisma.mtmCustomer.findMany({ where: { organizationId: orgId }, take: 20 })
if (agents.length < 3 || customers.length < 3) { console.error(`Not enough agents(${agents.length})/customers(${customers.length}).`); process.exit(1) }
console.log(`Using ${agents.length} agents, ${customers.length} customers.`)

const today = new Date()
const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d }
const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x }
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const lat = () => +(40.36 + Math.random() * 0.07).toFixed(5)
const lng = () => +(49.82 + Math.random() * 0.09).toFixed(5)

let vCount = 0, rCount = 0, tCount = 0

for (let i = 0; i < 64; i++) {
  const d = daysAgo(rnd(0, 27))
  const dow = d.getDay()
  if ((dow === 0 || dow === 6) && Math.random() < 0.6) continue
  const agent = pick(agents), cust = pick(customers)
  const checkInAt = at(d, rnd(9, 17), pick([0, 15, 30, 45]))
  const duration = rnd(18, 52)
  const checkOutAt = new Date(checkInAt.getTime() + duration * 60000)
  const visit = await prisma.mtmVisit.create({ data: {
    organizationId: orgId, agentId: agent.id, customerId: cust.id,
    status: "CHECKED_OUT", checkInAt, checkOutAt, duration,
    checkInLat: lat(), checkInLng: lng(), checkOutLat: lat(), checkOutLng: lng(),
    notes: `${MARK} plan visit`, createdAt: checkInAt,
  } })
  vCount++
}

// 2) Completed routes with timing over last 21 days (for avgTimeOnRoute).
for (let i = 0; i < 16; i++) {
  const d = daysAgo(rnd(0, 20))
  const dow = d.getDay()
  if ((dow === 0 || dow === 6) && Math.random() < 0.6) continue
  const agent = pick(agents)
  const startedAt = at(d, rnd(8, 10), pick([0, 30]))
  const completedAt = new Date(startedAt.getTime() + rnd(180, 360) * 60000)
  await prisma.mtmRoute.create({ data: {
    organizationId: orgId, agentId: agent.id, date: at(d, 0, 0),
    name: `${MARK} Route ${d.getMonth() + 1}/${d.getDate()}`,
    status: "COMPLETED", startedAt, completedAt, createdAt: startedAt,
  } })
  rCount++
}

// 3) Field tasks over last 21 days (~70% completed) → completionRate + task trend.
const titles = ["Проверить выкладку", "Заменить ценники", "Инспекция холодильника", "Согласовать промо", "Получить подпись акта", "Фото полки", "Пополнить POSM"]
for (let i = 0; i < 30; i++) {
  const d = daysAgo(rnd(0, 20)), agent = pick(agents), cust = pick(customers)
  const done = Math.random() < 0.7
  await prisma.mtmTask.create({ data: {
    organizationId: orgId, agentId: agent.id, customerId: cust.id,
    title: `${pick(titles)} — ${cust.name}`, description: MARK,
    status: done ? "COMPLETED" : pick(["PENDING", "IN_PROGRESS"]),
    priority: pick(["LOW", "MEDIUM", "HIGH"]),
    dueDate: at(d, 18), completedAt: done ? at(d, rnd(11, 17)) : null,
    createdAt: at(d, rnd(8, 10)),
  } })
  tCount++
}

console.log(`SEEDED → visits=${vCount}  routes=${rCount}  tasks=${tCount}`)
await prisma.$disconnect()
