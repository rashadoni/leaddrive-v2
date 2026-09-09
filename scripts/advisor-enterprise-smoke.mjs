// Temporary live-data smoke for Da Vinci Advisor enterprise modules.
//
// Creates non-demo, marker-prefixed rows that should produce Advisor signals in:
// contracts, marketing, routes and MTM. Run with --clean after verification.
//
// Usage:
//   node scripts/advisor-enterprise-smoke.mjs --slug=<tenant-slug> --seed
//   node scripts/advisor-enterprise-smoke.mjs --org=<organization-id> --seed
//   node scripts/advisor-enterprise-smoke.mjs --slug=<tenant-slug> --clean
//
// Optional:
//   --enable-modules   Enables contracts/marketing/mtm/analytics in org.modules for the smoke tenant.

import { makeScriptPrisma } from "./_rls.mjs"

const PREFIX = "ADV-ENT-SMOKE"
const MARKER = "@advisor-enterprise-smoke.local"
const SHOULD_SEED = process.argv.includes("--seed")
const SHOULD_CLEAN = process.argv.includes("--clean")
const SHOULD_ENABLE_MODULES = process.argv.includes("--enable-modules")

function getArg(name) {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`))
  return arg ? arg.split("=").slice(1).join("=") : null
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000)
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3_600_000)
}

function today() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function plannedMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000)
}

async function resolveOrganization(prisma) {
  const orgId = getArg("org")
  const slug = getArg("slug")
  if (!orgId && !slug) {
    throw new Error("Pass --org=<organization-id> or --slug=<tenant-slug>.")
  }
  const org = await prisma.organization.findFirst({
    where: orgId ? { id: orgId } : { slug },
    select: { id: true, name: true, slug: true, modules: true, features: true, addons: true },
  })
  if (!org) throw new Error(`Organization not found for ${orgId ? `id=${orgId}` : `slug=${slug}`}.`)
  return org
}

async function enableAdvisorSmokeModules(prisma, org) {
  if (!SHOULD_ENABLE_MODULES) return false
  const modules = org.modules && typeof org.modules === "object" && !Array.isArray(org.modules) ? org.modules : {}
  const features = Array.isArray(org.features) ? org.features : []
  const addons = Array.isArray(org.addons) ? org.addons : []
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      modules: {
        ...modules,
        contracts: true,
        marketing: true,
        mtm: true,
        analytics: true,
      },
      features: Array.from(new Set([...features, "contracts", "campaigns", "mtm", "reports", "tasks"])),
      addons: Array.from(new Set([...addons, "mtm"])),
    },
  })
  return true
}

async function cleanSmokeData(prisma, organizationId) {
  const agents = await prisma.mtmAgent.findMany({
    where: { organizationId, email: { endsWith: MARKER } },
    select: { id: true },
  })
  const agentIds = agents.map((agent) => agent.id)
  const customers = await prisma.mtmCustomer.findMany({
    where: { organizationId, code: { startsWith: PREFIX } },
    select: { id: true },
  })
  const customerIds = customers.map((customer) => customer.id)
  const routes = await prisma.mtmRoute.findMany({
    where: { organizationId, name: { startsWith: PREFIX } },
    select: { id: true },
  })
  const routeIds = routes.map((route) => route.id)
  const photos = await prisma.mtmPhoto.findMany({
    where: {
      organizationId,
      OR: [
        { url: { contains: "advisor-enterprise-smoke.local" } },
        { agentId: { in: agentIds.length ? agentIds : ["__none__"] } },
      ],
    },
    select: { id: true },
  })
  const photoIds = photos.map((photo) => photo.id)

  await prisma.mtmPhoto.deleteMany({
    where: {
      organizationId,
      OR: [
        { id: { in: photoIds.length ? photoIds : ["__none__"] } },
        { url: { contains: "advisor-enterprise-smoke.local" } },
      ],
    },
  })
  await prisma.mtmVisit.deleteMany({
    where: {
      organizationId,
      OR: [
        { agentId: { in: agentIds.length ? agentIds : ["__none__"] } },
        { customerId: { in: customerIds.length ? customerIds : ["__none__"] } },
      ],
    },
  })
  await prisma.mtmRoutePoint.deleteMany({ where: { routeId: { in: routeIds.length ? routeIds : ["__none__"] } } })
  await prisma.mtmRoute.deleteMany({ where: { organizationId, id: { in: routeIds.length ? routeIds : ["__none__"] } } })
  await prisma.mtmCustomer.deleteMany({ where: { organizationId, id: { in: customerIds.length ? customerIds : ["__none__"] } } })
  await prisma.mtmAgent.deleteMany({ where: { organizationId, id: { in: agentIds.length ? agentIds : ["__none__"] } } })
  await prisma.campaign.deleteMany({ where: { organizationId, name: { startsWith: PREFIX } } })
  await prisma.contract.deleteMany({ where: { organizationId, contractNumber: { startsWith: PREFIX } } })
}

async function seedSmokeData(prisma, org) {
  await cleanSmokeData(prisma, org.id)
  const modulesChanged = await enableAdvisorSmokeModules(prisma, org)

  const contract = await prisma.contract.create({
    data: {
      organizationId: org.id,
      contractNumber: `${PREFIX}-CONTRACT`,
      title: `${PREFIX} unsigned approved contract`,
      status: "approved",
      endDate: new Date(Date.now() + 30 * 86_400_000),
      valueAmount: 12500,
      currency: "AZN",
      notes: "Temporary Advisor enterprise smoke row. Safe to delete.",
    },
    select: { id: true },
  })
  await prisma.$executeRaw`UPDATE contracts SET "updatedAt" = ${daysAgo(10)} WHERE id = ${contract.id}`

  const campaign = await prisma.campaign.create({
    data: {
      organizationId: org.id,
      name: `${PREFIX} zero-click campaign`,
      status: "sent",
      type: "email",
      totalRecipients: 150,
      totalSent: 150,
      totalOpened: 65,
      totalClicked: 0,
      description: "Temporary Advisor enterprise smoke row. Safe to delete.",
    },
    select: { id: true },
  })

  const agent = await prisma.mtmAgent.create({
    data: {
      organizationId: org.id,
      name: `${PREFIX} Agent`,
      email: `agent${MARKER}`,
      status: "ACTIVE",
    },
    select: { id: true },
  })
  const customer = await prisma.mtmCustomer.create({
    data: {
      organizationId: org.id,
      code: `${PREFIX}-CUSTOMER`,
      name: `${PREFIX} Customer`,
      city: "Baku",
      address: "Temporary Advisor enterprise smoke customer",
    },
    select: { id: true },
  })
  const route = await prisma.mtmRoute.create({
    data: {
      organizationId: org.id,
      agentId: agent.id,
      date: today(),
      name: `${PREFIX} route`,
      status: "IN_PROGRESS",
      totalPoints: 3,
      visitedPoints: 1,
      startedAt: hoursAgo(4),
    },
    select: { id: true },
  })
  await prisma.mtmRoutePoint.create({
    data: {
      organizationId: org.id,
      routeId: route.id,
      customerId: customer.id,
      orderIndex: 1,
      status: "PENDING",
      plannedTime: plannedMinutesAgo(95),
      notes: "Temporary Advisor enterprise smoke missed stop.",
    },
  })
  const visit = await prisma.mtmVisit.create({
    data: {
      organizationId: org.id,
      agentId: agent.id,
      customerId: customer.id,
      status: "CHECKED_IN",
      checkInAt: hoursAgo(2),
      notes: "Temporary Advisor enterprise smoke open visit.",
    },
    select: { id: true },
  })
  const photo = await prisma.mtmPhoto.create({
    data: {
      organizationId: org.id,
      agentId: agent.id,
      visitId: visit.id,
      url: `https://advisor-enterprise-smoke.local/${org.id}/display.jpg`,
      category: "display",
      status: "REJECTED",
      hasWatermark: true,
    },
    select: { id: true },
  })
  return {
    modulesChanged,
    expectedSignals: [
      { domain: "contracts", signalId: `contracts:signature:${contract.id}`, entityType: "contract", entityId: contract.id },
      { domain: "marketing", signalId: `marketing:low_engagement:${campaign.id}`, entityType: "campaign", entityId: campaign.id },
      { domain: "routes", signalId: `routes:deviation:${route.id}`, entityType: "mtm_route", entityId: route.id },
      { domain: "routes", signalId: `routes:open_visit:${visit.id}`, entityType: "mtm_visit", entityId: visit.id },
      { domain: "mtm", signalId: `mtm:photo_review:${photo.id}`, entityType: "mtm_photo", entityId: photo.id },
    ],
  }
}

async function main() {
  if (!SHOULD_SEED && !SHOULD_CLEAN) {
    throw new Error("Pass --seed or --clean.")
  }
  const prisma = await makeScriptPrisma()
  try {
    const org = await resolveOrganization(prisma)
    if (SHOULD_CLEAN) {
      await cleanSmokeData(prisma, org.id)
      console.log(JSON.stringify({ ok: true, action: "clean", organizationId: org.id, slug: org.slug }, null, 2))
      return
    }
    const result = await seedSmokeData(prisma, org)
    console.log(JSON.stringify({
      ok: true,
      action: "seed",
      organizationId: org.id,
      slug: org.slug,
      marker: PREFIX,
      note: "Open /ai/actions or GET Advisor payload for this tenant; expectedSignals should appear if modules are enabled and collectors are healthy.",
      ...result,
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
