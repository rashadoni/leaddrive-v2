// READ-ONLY: why doesn't a just-completed task show the user on the Tasks board?
//   CONFIRM_PROD=1 node --env-file=/etc/leaddrive/app.env scripts/seeds/arena-task-debug.mjs --slug=leaddrive
import { makeScriptPrisma } from "../_rls.mjs"
const prisma = await makeScriptPrisma()
function getArg(n){const a=process.argv.find(x=>x.startsWith(`--${n}=`));return a?a.split("=").slice(1).join("="):null}
const slug = getArg("slug") || "leaddrive"
const org = await prisma.organization.findUnique({ where: { slug } })
const orgId = org.id
const now = new Date()
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

// 1) The specific task the user just completed (by title fragment) — Task + ProjectTask.
console.log("=== Task/ProjectTask matching 'Elvin Abushev' or HHH-18 ===")
for (const model of ["task", "projectTask"]) {
  const rows = await prisma[model].findMany({
    where: { organizationId: orgId, OR: [{ title: { contains: "Elvin Abushev" } }, { title: { contains: "Abushev" } }] },
    select: { id: true, title: true, status: true, completedAt: true, dueDate: true, assignedTo: true },
  })
  for (const r of rows) console.log(`  [${model}] "${r.title.slice(0,40)}" status=${r.status} completedAt=${r.completedAt?r.completedAt.toISOString():"NULL <-- not counted!"} due=${r.dueDate?r.dueDate.toISOString().slice(0,10):"none"} assignedTo=${r.assignedTo}`)
}

// 2) Rashad: how many tasks does the AGGREGATOR see (completedAt != null) vs total assigned?
const rashad = await prisma.user.findFirst({ where: { organizationId: orgId, name: { contains: "Rashad" } }, select: { id: true, name: true } })
console.log(`\n=== Rashad (${rashad?.id}) task counts as the aggregator sees them ===`)
for (const model of ["task", "projectTask"]) {
  const total = await prisma[model].count({ where: { organizationId: orgId, assignedTo: rashad.id } })
  const completed = await prisma[model].count({ where: { organizationId: orgId, assignedTo: rashad.id, completedAt: { not: null } } })
  const completedInMonth = await prisma[model].count({ where: { organizationId: orgId, assignedTo: rashad.id, completedAt: { gte: monthStart } } })
  const doneStatus = await prisma[model].count({ where: { organizationId: orgId, assignedTo: rashad.id, status: { in: ["done", "DONE", "completed", "COMPLETED"] } } })
  console.log(`  [${model}] total=${total}  status∈done=${doneStatus}  completedAt!=null=${completed}  completedAt≥monthStart=${completedInMonth}`)
}
console.log(`\n(If status∈done > completedAt!=null → the DONE move did NOT stamp completedAt → aggregator blind to it. monthStart=${monthStart.toISOString().slice(0,10)})`)
await prisma.$disconnect()
