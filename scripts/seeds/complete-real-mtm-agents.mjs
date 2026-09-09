// Give the REAL existing MTM agents (Farid Aliyev, Anar Mammadov, Nigar Huseynova,
// Rashad Rahimov) a spread of COMPLETED work so they show a real KPI % on the board
// instead of 0% (their existing tasks were pending). Authorized by the user 2026-06-20
// ("довести их работу до реального %"). Resets each named agent's mtm tasks/photos/
// routes to a controlled completed set → deterministic, idempotent.
//   CONFIRM_PROD=1 node --env-file=/etc/leaddrive/app.env scripts/seeds/complete-real-mtm-agents.mjs
import { makeScriptPrisma } from "../_rls.mjs"
const prisma = await makeScriptPrisma()
if (!process.env.CONFIRM_PROD) {
  console.error("Refusing without CONFIRM_PROD=1 (writes data).")
  process.exit(1)
}
const org =
  (await prisma.organization.findUnique({ where: { slug: "leaddrive" } })) ||
  (await prisma.organization.findUnique({
    where: { id: (await prisma.mtmAgent.findFirst({ where: { name: "Farid Aliyev" }, select: { organizationId: true } }))?.organizationId },
  }))
const orgId = org.id
const now = new Date()

// [name, taskTotal, taskDone, photoTotal, photoApproved, routeTotal, routeDone]
// attainment = 0.5·(taskDone/taskTotal) + 0.3·(photoApp/photoTotal) + 0.2·(routeDone/routeTotal)
const REAL = [
  ["Farid Aliyev", 10, 9, 8, 8, 5, 4], // ~89% — strongest real agent
  ["Nigar Huseynova", 8, 7, 6, 5, 4, 4], // ~88%
  ["Anar Mammadov", 8, 5, 6, 4, 4, 3], // ~66%
  ["Rashad Rahimov", 8, 4, 6, 3, 4, 2], // ~50%
]

for (const [name, tT, tD, pT, pA, rT, rD] of REAL) {
  const agent = await prisma.mtmAgent.findFirst({ where: { organizationId: orgId, name } })
  if (!agent) {
    console.log(`SKIP (not found): ${name}`)
    continue
  }
  const agentId = agent.id
  await prisma.mtmTask.deleteMany({ where: { organizationId: orgId, agentId } })
  await prisma.mtmPhoto.deleteMany({ where: { organizationId: orgId, agentId } })
  await prisma.mtmRoute.deleteMany({ where: { organizationId: orgId, agentId } })
  await prisma.mtmTask.createMany({
    data: Array.from({ length: tT }, (_, i) => ({
      organizationId: orgId,
      agentId,
      title: `Tapşırıq ${i + 1}`,
      status: i < tD ? "COMPLETED" : "PENDING",
      completedAt: i < tD ? now : null,
    })),
  })
  await prisma.mtmPhoto.createMany({
    data: Array.from({ length: pT }, (_, i) => ({
      organizationId: orgId,
      agentId,
      url: `https://demo.arena.local/${agentId}/p${i + 1}.jpg`,
      status: i < pA ? "APPROVED" : "PENDING",
    })),
  })
  await prisma.mtmRoute.createMany({
    data: Array.from({ length: rT }, (_, i) => ({
      organizationId: orgId,
      agentId,
      date: now,
      status: i < rD ? "COMPLETED" : "PLANNED",
      totalPoints: 5,
      visitedPoints: i < rD ? 5 : 0,
    })),
  })
  const pct = Math.round(0.5 * (tD / tT) * 100 + 0.3 * (pA / pT) * 100 + 0.2 * (rD / rT) * 100)
  console.log(`✓ ${name.padEnd(18)} tasks ${tD}/${tT}  photos ${pA}/${pT}  routes ${rD}/${rT}  → ~${pct}%`)
}
console.log("Done: real MTM agents now show a real KPI %.")
await prisma.$disconnect()
