// Seed demo CRM agents for the KPI Arena's Tickets / Projects / Tasks tabs, with
// a spread of attainment so each board shows the red→green + small→large range.
// Companion to arena-demo.mjs (which does MTM). Creates demo USERS (role=support
// so they appear on the Tickets board; they also manage projects + own tasks).
//
// Attainment per group:
//   Tickets  = SLA adherence %  (resolvedAt ≤ slaDueAt)
//   Projects = on-time delivery % (completed, actualEndDate ≤ endDate)
//   Tasks    = on-time completion % (completedAt ≤ dueDate)
//
// Usage (ON THE PROD SERVER):
//   CONFIRM_PROD=1 node --env-file=/etc/leaddrive/app.env scripts/seeds/arena-demo-crm.mjs --slug=leaddrive
//   CONFIRM_PROD=1 node --env-file=/etc/leaddrive/app.env scripts/seeds/arena-demo-crm.mjs --slug=leaddrive --clean
//
// Footprint: demo USERS appear in the Users list + their tickets/projects/tasks
// in those module lists (demo tenant only). Tagged email "@arena-demo.local" +
// ticket prefix "ADEMO-" → --clean removes exactly those, real data untouched.

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
const TICKET_PREFIX = "ADEMO-"
const CLEAN = process.argv.includes("--clean")
const slug = getArg("slug") || "leaddrive"

// [name, ticketTotal,ticketSla, projTotal,projOnTime, taskTotal,taskOnTime]
const USERS = [
  ["Ləman Hacıyeva", 12, 12, 6, 6, 12, 12], // ~100%
  ["Nərmin Süleymanova", 10, 9, 6, 5, 10, 9], // ~88%
  ["Aytən Rəhimli", 10, 8, 5, 4, 10, 8], // ~80%
  ["Vüsal Əhmədov", 11, 10, 6, 5, 10, 9], // ~90%
  ["Ramil Quliyev", 10, 7, 5, 3, 10, 6], // ~65%
  ["Kənan Məmmədov", 10, 6, 5, 3, 10, 7], // ~62%
  ["Pərvin Məmmədli", 10, 5, 5, 2, 10, 5], // ~50%
  ["Tunar Vəliyev", 10, 4, 6, 2, 10, 4], // ~40%
  ["Aysu Kərimli", 10, 3, 5, 1, 10, 2], // ~25%
  ["Elnur Babayev", 10, 1, 5, 0, 10, 1], // ~10%
]

const DAY = 86_400_000

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

  if (CLEAN) {
    const demo = await prisma.user.findMany({
      // "agent" prefix keeps this clean scoped to the CRM seed only — the sales
      // seed uses a "salesrep" prefix on the same @arena-demo.local domain.
      where: { organizationId: orgId, email: { startsWith: "agent", endsWith: MARKER } },
      select: { id: true },
    })
    const ids = demo.map((u) => u.id)
    await prisma.ticket.deleteMany({ where: { organizationId: orgId, ticketNumber: { startsWith: TICKET_PREFIX } } })
    if (ids.length) {
      await prisma.project.deleteMany({ where: { organizationId: orgId, managerId: { in: ids } } })
      await prisma.task.deleteMany({ where: { organizationId: orgId, assignedTo: { in: ids } } })
      await prisma.user.deleteMany({ where: { id: { in: ids } } })
    }
    console.log(`Removed ${ids.length} demo CRM users + their tickets/projects/tasks.`)
    return
  }

  const now = Date.now()
  let ui = 0
  for (const [name, tkTot, tkSla, prTot, prOk, taTot, taOk] of USERS) {
    ui++
    const email = "agent" + ui + MARKER
    let user = await prisma.user.findFirst({ where: { organizationId: orgId, email } })
    if (!user) {
      user = await prisma.user.create({
        data: {
          organizationId: orgId,
          email,
          name,
          role: "support",
          passwordHash: "DEMO-DISABLED-NO-LOGIN",
          avatar: `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
        },
      })
    }
    const uid = user.id

    // wipe this demo user's prior records (idempotent re-run)
    await prisma.ticket.deleteMany({ where: { organizationId: orgId, ticketNumber: { startsWith: `${TICKET_PREFIX}${ui}-` } } })
    await prisma.project.deleteMany({ where: { organizationId: orgId, managerId: uid } })
    await prisma.task.deleteMany({ where: { organizationId: orgId, assignedTo: uid } })

    // Tickets — all resolved; first `tkSla` resolved within SLA, rest breached.
    await prisma.ticket.createMany({
      data: Array.from({ length: tkTot }, (_, i) => {
        const created = new Date(now - 3 * DAY)
        const slaDue = new Date(now - 1 * DAY)
        const resolved = i < tkSla ? new Date(now - 1.5 * DAY) : new Date(now - 0.4 * DAY)
        return {
          organizationId: orgId,
          ticketNumber: `${TICKET_PREFIX}${ui}-${i + 1}`,
          subject: `Demo müraciət ${i + 1}`,
          status: "resolved",
          assignedTo: uid,
          createdAt: created,
          slaDueAt: slaDue,
          resolvedAt: resolved,
          satisfactionRating: i < tkSla ? 5 : 3,
        }
      }),
    })

    // Projects — all completed; first `prOk` delivered on time, rest late.
    await prisma.project.createMany({
      data: Array.from({ length: prTot }, (_, i) => {
        const endDate = new Date(now - 2 * DAY)
        const actualEnd = i < prOk ? new Date(now - 3 * DAY) : new Date(now - 0.5 * DAY)
        return {
          organizationId: orgId,
          name: `Demo layihə ${name.split(" ")[0]} ${i + 1}`,
          status: "completed",
          managerId: uid,
          startDate: new Date(now - 20 * DAY),
          endDate,
          actualStartDate: new Date(now - 18 * DAY),
          actualEndDate: actualEnd,
          completionPercentage: 100,
        }
      }),
    })

    // Tasks — all completed; first `taOk` finished on time, rest late.
    await prisma.task.createMany({
      data: Array.from({ length: taTot }, (_, i) => {
        const dueDate = new Date(now - 2 * DAY)
        const completedAt = i < taOk ? new Date(now - 3 * DAY) : new Date(now - 0.5 * DAY)
        return {
          organizationId: orgId,
          title: `Demo tapşırıq ${name.split(" ")[0]} ${i + 1}`,
          status: "completed",
          assignedTo: uid,
          dueDate,
          completedAt,
        }
      }),
    })

    console.log(`✓ ${name}  tickets-SLA ${tkSla}/${tkTot}  proj-ontime ${prOk}/${prTot}  task-ontime ${taOk}/${taTot}`)
  }
  console.log(`Done: ${ui} demo CRM users seeded for "${slug}".`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
