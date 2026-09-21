#!/usr/bin/env node
/**
 * scripts/seeds/demo-journey-clips.mjs
 * =====================================================================
 * Fills the DEMO tenant with the records the guided demo's intro clips film:
 * campaigns (/campaigns), two team boards with tasks (/boards) and leads
 * (/leads). docs/demo-guided-sales-journey-handoff.md, phase F.
 *
 * Why a stand of its own: on 2026-09-21 the help library's leads and boards
 * clips turned out to be filmed on LeadDrive Inc.'s own records (the owner's
 * test data), so the demo stopped showing them. Clips a prospect sees are
 * filmed here instead, on invented data only.
 *
 * Everything is invented and belongs to the Omni-channel reel's made-up brand,
 * «Demo Mebel», so the tenant tells one story. What is written, and why it
 * is safe to show, lives in ./demo-journey-legend.mjs.
 *
 * Owns only its rows, all inside the demo organisation, found by what the
 * legend names: campaigns by exact name, boards by division key (their
 * columns, tasks and checklists go with them), leads by exact contact name
 * (their activities with them). It never touches the reel's rows —
 * organisation features and settings, contacts, conversations, messages,
 * chatbot rules, knowledge base — nor any user.
 *
 * Scores are left to the product: leads are written unscored, then
 * scripts/seeds/demo-journey-clips-rescore.mjs saves each one through the
 * app's API as the recorder account, which runs the same scoring every
 * saved lead gets. A number typed here would be the product asserting a
 * judgement it never made (src/lib/ai/lead-scoring.ts).
 *
 *   CONFIRM_PROD=1 DATABASE_URL=… node scripts/seeds/demo-journey-clips.mjs --slug=demo
 *   … --clean   removes this seed's rows and creates nothing
 * =====================================================================
 */
import { makeScriptPrisma } from "../_rls.mjs"
import { BOARDS, CAMPAIGNS, CANONICAL_COLUMNS, LEADS, TASKS, TEAM, daysAgo, inDays } from "./demo-journey-legend.mjs"

const ALLOWED_SLUGS = new Set(["demo"])

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=")
const slug = arg("slug") || "demo"
if (!ALLOWED_SLUGS.has(slug)) {
  console.error(`FATAL: slug "${slug}" is not an allowed demo tenant (${[...ALLOWED_SLUGS].join(", ")})`)
  process.exit(1)
}
const dbUrl = process.env.DATABASE_URL || ""
const isLocalDb = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
if (!isLocalDb && !process.env.CONFIRM_PROD) {
  console.error("FATAL: non-local DATABASE_URL — set CONFIRM_PROD=1 to seed the demo tenant")
  process.exit(1)
}
const clean = process.argv.includes("--clean")

// ── Run ───────────────────────────────────────────────────────────────────
const prisma = await makeScriptPrisma()
const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true, name: true } })
if (!org) {
  console.error(`FATAL: organization "${slug}" not found`)
  process.exit(1)
}
const orgId = org.id

// Removal first, dependants before what they point at. Every filter carries
// the organisation AND something this file named.
const wipe = async () => {
  const boards = await prisma.division.findMany({
    where: { organizationId: orgId, key: { in: BOARDS.map((b) => b.key) } },
    select: { id: true },
  })
  const boardIds = boards.map((b) => b.id)
  const { count: tasks } = boardIds.length
    ? await prisma.task.deleteMany({ where: { organizationId: orgId, divisionId: { in: boardIds } } })
    : { count: 0 }
  const { count: divisions } = boardIds.length
    ? await prisma.division.deleteMany({ where: { organizationId: orgId, id: { in: boardIds } } })
    : { count: 0 }
  const leads = await prisma.lead.findMany({
    where: { organizationId: orgId, contactName: { in: LEADS.map((l) => l.contactName) } },
    select: { id: true },
  })
  const leadIds = leads.map((l) => l.id)
  const { count: activities } = leadIds.length
    ? await prisma.activity.deleteMany({ where: { organizationId: orgId, relatedType: "lead", relatedId: { in: leadIds } } })
    : { count: 0 }
  const { count: leadRows } = leadIds.length
    ? await prisma.lead.deleteMany({ where: { organizationId: orgId, id: { in: leadIds } } })
    : { count: 0 }
  const { count: campaigns } = await prisma.campaign.deleteMany({
    where: { organizationId: orgId, name: { in: CAMPAIGNS.map((c) => c.name) } },
  })
  console.log(`removed: tasks ${tasks}, boards ${divisions}, activities ${activities}, leads ${leadRows}, campaigns ${campaigns}`)
}

await wipe()
if (clean) {
  console.log("--clean: the stand's rows are gone, nothing created.")
  await prisma.$disconnect()
  process.exit(0)
}

const users = await prisma.user.findMany({
  where: { organizationId: orgId, name: { in: Object.values(TEAM) } },
  select: { id: true, name: true },
})
const userId = (key) => (key ? users.find((u) => u.name === TEAM[key])?.id ?? null : null)
const pipeline = await prisma.pipeline.findFirst({
  where: { organizationId: orgId, isDefault: true },
  select: { id: true },
})

for (const c of CAMPAIGNS) {
  await prisma.campaign.create({ data: { organizationId: orgId, createdBy: userId("sebine"), ...c } })
}

const leadIdByName = {}
for (const l of LEADS) {
  const lead = await prisma.lead.create({
    data: {
      organizationId: orgId,
      contactName: l.contactName,
      companyName: l.companyName ?? null,
      email: l.email ?? null,
      source: l.source,
      status: l.status,
      priority: l.priority,
      category: l.category,
      customerStage: l.customerStage ?? null,
      interest: l.interest ?? null,
      notes: l.notes ?? null,
      estimatedValue: l.estimatedValue,
      assignedTo: userId(l.assign),
      pipelineId: pipeline?.id ?? null,
      convertedAt: l.convertedDays ? daysAgo(l.convertedDays) : null,
      createdAt: daysAgo(l.createdDays),
    },
  })
  leadIdByName[l.contactName] = lead.id
  for (const a of l.activities ?? []) {
    await prisma.activity.create({
      data: {
        organizationId: orgId,
        type: a.type,
        subject: a.subject,
        description: a.description,
        relatedType: "lead",
        relatedId: lead.id,
        createdBy: userId(l.assign),
        completedAt: a.type === "meeting" ? null : daysAgo(a.days),
        scheduledAt: a.type === "meeting" ? inDays(1) : null,
        createdAt: daysAgo(a.days),
      },
    })
  }
}

let taskCount = 0
for (const b of BOARDS) {
  const division = await prisma.division.create({
    data: {
      organizationId: orgId,
      key: b.key,
      name: b.name,
      description: b.description,
      color: b.color,
      sortOrder: b.sortOrder,
      headUserId: userId(b.head),
    },
  })
  await prisma.boardColumn.createMany({
    data: CANONICAL_COLUMNS.map(([key, label], i) => ({
      organizationId: orgId, divisionId: division.id, key, label, sortOrder: i, mapsToStatus: key,
    })),
  })
  let n = 0
  for (const t of TASKS[b.key]) {
    n += 1
    const task = await prisma.task.create({
      data: {
        organizationId: orgId,
        divisionId: division.id,
        taskKey: `${b.key}-${n}`,
        title: t.title,
        type: "task",
        status: t.status,
        boardColumnKey: t.status,
        boardPosition: n * 1000,
        priority: t.priority,
        dueDate: t.due === undefined ? null : inDays(t.due),
        assignedTo: userId(t.assign),
        createdBy: userId("sebine"),
        relatedType: t.lead ? "lead" : null,
        relatedId: t.lead ? leadIdByName[t.lead] ?? null : null,
        completedAt: t.status === "done" ? daysAgo(Math.max(0, -(t.due ?? 0))) : null,
        createdAt: daysAgo(10 - Math.min(n, 9)),
      },
    })
    if (t.checklist) {
      await prisma.taskChecklist.createMany({
        data: t.checklist.map(([title, completed], i) => ({ organizationId: orgId, taskId: task.id, title, completed, sortOrder: i })),
      })
    }
    taskCount += 1
  }
}

console.log(`seeded «${org.name}»: campaigns ${CAMPAIGNS.length}, leads ${LEADS.length}, boards ${BOARDS.length}, tasks ${taskCount}`)
console.log(`team found: ${users.map((u) => u.name).join(", ") || "none — tasks and leads left unassigned"}`)
console.log("next: scripts/seeds/demo-journey-clips-rescore.mjs, so the product scores the leads")
await prisma.$disconnect()
