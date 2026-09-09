// READ-ONLY: replicate the Sales + Tasks aggregator logic to show EXACTLY whether
// the real users (Rashad / Emil) land on those boards and at what % / window.
//   CONFIRM_PROD=1 node --env-file=/etc/leaddrive/app.env scripts/seeds/arena-board-diagnose.mjs --slug=leaddrive

import { makeScriptPrisma } from "../_rls.mjs"
const prisma = await makeScriptPrisma()
function getArg(n) { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=").slice(1).join("=") : null }
const slug = getArg("slug") || "leaddrive"
const org = await prisma.organization.findUnique({ where: { slug } })
const orgId = org.id
const now = new Date()
const year = now.getFullYear(), quarter = Math.floor(now.getMonth() / 3) + 1
const qStart = new Date(year, (quarter - 1) * 3, 1)
const qEnd = new Date(year, quarter * 3, 0, 23, 59, 59)
const monthStart = new Date(year, now.getMonth(), 1)
console.log(`now=${now.toISOString().slice(0, 10)}  quarter=Q${quarter}/${year} [${qStart.toISOString().slice(0,10)}..${qEnd.toISOString().slice(0,10)}]  monthStart=${monthStart.toISOString().slice(0,10)}\n`)

// ── SALES board: quotas this quarter for ACTIVE users (the exact aggregator filter) ──
const quotas = await prisma.salesQuota.findMany({
  where: { organizationId: orgId, year, quarter, user: { isActive: true } },
  include: { user: { select: { name: true, email: true } } },
})
console.log(`=== SALES board roster (Q${quarter}/${year}, active users with a quota): ${quotas.length} ===`)
for (const q of quotas) {
  const won = await prisma.deal.aggregate({
    where: { organizationId: orgId, stage: "WON", assignedTo: q.userId, updatedAt: { gte: qStart, lte: qEnd } },
    _sum: { valueAmount: true },
  })
  const wonSum = Number(won._sum.valueAmount ?? 0)
  const pct = q.amount > 0 ? Math.round((wonSum / q.amount) * 100) : 0
  const real = !q.user.email.endsWith("@arena-demo.local")
  console.log(`  ${(q.user.name || "?").padEnd(22)} quota=${q.amount} won=${wonSum} → ${pct}%${real ? "   <-- REAL USER" : ""}`)
}

// ── TASKS board: do the real users' tasks fall in the period windows? ──
const targets = await prisma.user.findMany({
  where: { organizationId: orgId, OR: [{ name: { contains: "Rashad" } }, { name: { contains: "Emil" } }] },
  select: { id: true, name: true, isActive: true },
})
console.log(`\n=== TASKS for real users (Task + ProjectTask, completed) ===`)
for (const u of targets) {
  const [tasks, ptasks] = await Promise.all([
    prisma.task.findMany({ where: { organizationId: orgId, assignedTo: u.id, completedAt: { not: null } }, select: { title: true, completedAt: true, dueDate: true } }),
    prisma.projectTask.findMany({ where: { organizationId: orgId, assignedTo: u.id, completedAt: { not: null } }, select: { title: true, completedAt: true, dueDate: true } }),
  ])
  const all = [...tasks, ...ptasks]
  console.log(`  ${u.name} (active=${u.isActive}): ${all.length} completed task(s)`)
  for (const t of all) {
    const c = t.completedAt
    console.log(`     "${t.title}"  completedAt=${c.toISOString().slice(0,10)}  due=${t.dueDate ? t.dueDate.toISOString().slice(0,10) : "none"}  inMonth(AY)=${c >= monthStart}  inAll=yes`)
  }
}
await prisma.$disconnect()
