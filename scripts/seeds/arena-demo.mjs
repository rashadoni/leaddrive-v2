// Seed demo MTM agents for the KPI Arena, with a full spread of attainment so
// the red→green colour + small→large size range is visible (the showcase the
// user asked for). MTM-module-isolated — creates NO deals/invoices/etc., so it
// does NOT pollute core CRM/sales/finance dashboards.
//
// Composite attainment (what drives bubble colour + size) =
//   0.5·taskCompletion% + 0.3·photoApproval% + 0.2·routeCompletion%
// so each agent's done/total ratios below produce a known attainment.
//
// Usage (ON THE PROD SERVER, where DATABASE_URL points at the local DB):
//   CONFIRM_PROD=1 node scripts/seeds/arena-demo.mjs --slug=leaddrive
//   CONFIRM_PROD=1 node scripts/seeds/arena-demo.mjs --slug=leaddrive --clean   (remove all demo agents)
//
// Demo agents are tagged by the email suffix "@arena-demo.local" — that's the
// ONLY thing --clean keys off, so real agents are never touched. Idempotent:
// re-running wipes each demo agent's prior tasks/photos/routes and re-creates.
//
// Route POINTS: each route gets 5 MtmRoutePoint rows (VISITED on a COMPLETED
// route, PENDING on a PLANNED one) referencing a shared demo store pool, so the
// per-agent drill-down "route points" list has showcase data.
//
// NOTE: no MtmVisit rows are seeded (the bubble's "Visits" volume metric reads 0
// for demo agents — intended; SIZE + COLOUR come from attainment = tasks/photos/
// routes, and the drill-down now lists route points, not visits).

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()

if (!process.env.CONFIRM_PROD) {
  console.error("Refusing to run without CONFIRM_PROD=1 (this script writes data).")
  process.exit(1)
}

function getArg(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : null
}

const MARKER = "@arena-demo.local"
const CLEAN = process.argv.includes("--clean")
const slug = getArg("slug") || "leaddrive"

// [name, taskTotal, taskDone, photoTotal, photoApproved, routeTotal, routeDone]
// attainment = 0.5·(taskDone/taskTotal) + 0.3·(photoApproved/photoTotal) + 0.2·(routeDone/routeTotal), ×100
const AGENTS = [
  ["Elçin Quliyev", 10, 10, 8, 8, 5, 5], // 100%  → huge green
  ["Günel Vəliyeva", 12, 12, 6, 6, 4, 4], // 100%  → huge green
  ["Səbinə Kərimova", 10, 8, 10, 9, 5, 4], // ~83% → green
  ["Aysel Məmmədova", 10, 9, 8, 7, 5, 4], // ~87% → green
  ["Tural Hüseynov", 10, 7, 10, 6, 5, 3], // ~65% → amber
  ["Orxan Bayramov", 10, 6, 10, 5, 5, 4], // ~61% → amber
  ["Nigar Əlizadə", 10, 5, 10, 5, 5, 2], // ~48% → orange
  ["Leyla İsmayılova", 10, 4, 10, 4, 5, 3], // ~44% → orange
  ["Rəşad Sadıqov", 10, 3, 10, 2, 5, 1], // ~25% → red
  ["Kamran Abbasov", 10, 2, 10, 1, 5, 0], // ~13% → deep red
]

async function main() {
  let org = await prisma.organization.findUnique({ where: { slug } })
  if (!org) {
    // Fallback: target the org that already owns the seeded demo agent "Farid
    // Aliyev" (so we always hit the same tenant the Arena reads, regardless of slug).
    const known = await prisma.mtmAgent.findFirst({
      where: { name: "Farid Aliyev" },
      select: { organizationId: true },
    })
    if (known) org = await prisma.organization.findUnique({ where: { id: known.organizationId } })
  }
  if (!org) {
    console.error(`Organization not found (slug "${slug}", no "Farid Aliyev" agent). Pass --slug=<tenant>.`)
    process.exit(1)
  }
  const orgId = org.id
  console.log(`Tenant: ${org.name} (${slug}) — ${orgId}`)

  if (CLEAN) {
    const demo = await prisma.mtmAgent.findMany({
      where: { organizationId: orgId, email: { endsWith: MARKER } },
      select: { id: true },
    })
    const ids = demo.map((a) => a.id)
    if (ids.length) {
      await prisma.mtmTask.deleteMany({ where: { organizationId: orgId, agentId: { in: ids } } })
      await prisma.mtmPhoto.deleteMany({ where: { organizationId: orgId, agentId: { in: ids } } })
      // deleting routes cascade-deletes their MtmRoutePoint rows (onDelete: Cascade)
      await prisma.mtmRoute.deleteMany({ where: { organizationId: orgId, agentId: { in: ids } } })
      await prisma.mtmAgent.deleteMany({ where: { id: { in: ids } } })
    }
    // demo store pool, keyed on the ADEMO-STORE- code (real customers untouched);
    // any leftover points cascade away with the customer.
    const delC = await prisma.mtmCustomer.deleteMany({
      where: { organizationId: orgId, code: { startsWith: "ADEMO-STORE-" } },
    })
    console.log(`Removed ${ids.length} demo agents + their tasks/photos/routes/points + ${delC.count} demo stores.`)
    return
  }

  const now = new Date()

  // Demo customer pool — the stores each route POINT references (MtmRoutePoint
  // FK-requires a customer). Shared across all demo agents, idempotent by code
  // "ADEMO-STORE-N". On --clean these are removed last (their points cascade away
  // with the routes first). Real customers (no ADEMO- code) are never touched.
  const STORE_NAMES = [
    "Bravo Market", "Araz Supermarket", "Bazarstore", "Neptun",
    "Rahat Market", "Favorit", "OBA Market", "Spar",
  ]
  const customers = []
  for (let i = 0; i < STORE_NAMES.length; i++) {
    const code = `ADEMO-STORE-${i + 1}`
    let c = await prisma.mtmCustomer.findFirst({ where: { organizationId: orgId, code } })
    if (!c) {
      c = await prisma.mtmCustomer.create({
        data: { organizationId: orgId, code, name: STORE_NAMES[i], category: "B", status: "ACTIVE" },
      })
    }
    customers.push(c)
  }

  let n = 0
  for (const [name, tTot, tDone, pTot, pApp, rTot, rDone] of AGENTS) {
    const email = name.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "") + MARKER
    let agent = await prisma.mtmAgent.findFirst({ where: { organizationId: orgId, email } })
    if (!agent) {
      agent = await prisma.mtmAgent.create({
        data: {
          organizationId: orgId,
          name,
          email,
          status: "ACTIVE",
          role: "AGENT",
          avatar: `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
        },
      })
    }
    const agentId = agent.id
    // idempotent re-run: clear this demo agent's prior rows
    await prisma.mtmTask.deleteMany({ where: { organizationId: orgId, agentId } })
    await prisma.mtmPhoto.deleteMany({ where: { organizationId: orgId, agentId } })
    await prisma.mtmRoute.deleteMany({ where: { organizationId: orgId, agentId } })

    await prisma.mtmTask.createMany({
      data: Array.from({ length: tTot }, (_, i) => ({
        organizationId: orgId,
        agentId,
        title: `Tapşırıq ${i + 1}`,
        status: i < tDone ? "COMPLETED" : "PENDING",
        completedAt: i < tDone ? now : null,
      })),
    })
    await prisma.mtmPhoto.createMany({
      data: Array.from({ length: pTot }, (_, i) => ({
        organizationId: orgId,
        agentId,
        url: `https://demo.arena.local/${agentId}/p${i + 1}.jpg`,
        status: i < pApp ? "APPROVED" : "PENDING",
      })),
    })
    // Routes WITH their points. A COMPLETED route has all 5 points VISITED (the
    // drill-down "route points" list shows VISITED points), a PLANNED route has 0.
    // Each point references a store from the shared pool (cycled). Nested-create
    // so the points get their routeId without a second round-trip.
    for (let i = 0; i < rTot; i++) {
      const completed = i < rDone
      await prisma.mtmRoute.create({
        data: {
          organizationId: orgId,
          agentId,
          date: now,
          status: completed ? "COMPLETED" : "PLANNED",
          totalPoints: 5,
          visitedPoints: completed ? 5 : 0,
          points: {
            create: Array.from({ length: 5 }, (_, j) => ({
              customerId: customers[(i * 5 + j) % customers.length].id,
              orderIndex: j,
              status: completed ? "VISITED" : "PENDING",
              visitedAt: completed ? now : null,
            })),
          },
        },
      })
    }
    n++
    console.log(`✓ ${name}  tasks ${tDone}/${tTot}  photos ${pApp}/${pTot}  routes ${rDone}/${rTot}`)
  }
  console.log(`Done: ${n} demo MTM agents seeded for "${slug}".`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
