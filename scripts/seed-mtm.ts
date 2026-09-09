// @ts-nocheck
/**
 * MTM Quickstart Seed Script
 * Creates test data for Route & Field module:
 * - 4 agents (1 manager, 1 supervisor, 2 agents)
 * - 2 agent teams with distinct visit-action requirements
 * - 11 customers (categories A/B/C/D plus a doctor with a Baku address)
 * - 3 routes with points
 * - 8 tasks (mixed statuses/priorities)
 * - 5 visits (checked-in + checked-out)
 * - 4 alerts (critical/warning/info)
 *
 * Usage:
 *   MTM_DEMO_ADMIN_PASSWORD=... MTM_DEMO_AGENT_PASSWORD=... \
 *     npx tsx scripts/seed-mtm.ts
 * Idempotent: safe to run multiple times (uses upsert)
 */

import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import { passwordPolicyError } from "./password-policy.mjs"
import bcrypt from "bcryptjs"

let prisma: PrismaClient | undefined

const ADMIN_PASSWORD = process.env.MTM_DEMO_ADMIN_PASSWORD || ""
const AGENT_PASSWORD = process.env.MTM_DEMO_AGENT_PASSWORD || ""

const today = new Date()
const yesterday = new Date(today)
yesterday.setDate(yesterday.getDate() - 1)
const tomorrow = new Date(today)
tomorrow.setDate(tomorrow.getDate() + 1)

function dateAt(base: Date, hours: number, minutes = 0): Date {
  const d = new Date(base)
  d.setHours(hours, minutes, 0, 0)
  return d
}

// Default feature flags for the seeded `leaddrive` org. Matches what
// /admin/tenants would create for a fully-featured enterprise plan.
const LEADDRIVE_FEATURES = [
  "mtm", "core", "deals", "leads", "tasks", "contracts", "campaigns",
  "reports", "whatsapp", "ai", "voip", "portal", "events",
  "complaints_register", "knowledge-base", "tickets", "custom-fields",
  "currencies", "projects", "workflows",
]

async function main() {
  // Validate all safety signals before opening a database connection. Never
  // print DATABASE_URL because it commonly contains a database password.
  const dbUrl = process.env.DATABASE_URL || ""
  let dbHostname = ""
  let dbProtocol = ""
  try {
    const parsedDbUrl = new URL(dbUrl)
    dbHostname = parsedDbUrl.hostname
    dbProtocol = parsedDbUrl.protocol
  } catch {}
  const isLocalDb = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(dbHostname)
    && ["postgres:", "postgresql:"].includes(dbProtocol)
  if (process.env.NODE_ENV === "production" || !isLocalDb) {
    throw new Error("scripts/seed-mtm.ts only runs in non-production against a localhost database")
  }

  for (const [name, password] of [
    ["MTM_DEMO_ADMIN_PASSWORD", ADMIN_PASSWORD],
    ["MTM_DEMO_AGENT_PASSWORD", AGENT_PASSWORD],
  ] as const) {
    const policyError = passwordPolicyError(password)
    if (policyError) throw new Error(`${name}: ${policyError}`)
  }

  prisma = await makeScriptPrisma()
  console.log("🚀 MTM Quickstart Seed — starting...\n")

  // 1. Find or create the branded `leaddrive` org. Priority on lookup:
  // leaddrive → leaddrive-inc → demo-company → any. When `leaddrive` is
  // missing entirely (fresh-clone case, F-37) we upsert it ourselves so a
  // single `npx tsx scripts/seed-mtm.ts` run gets a dev to a fully-branded
  // local tenant with no manual SQL.
  const PRIORITY_SLUGS = ["leaddrive", "leaddrive-inc", "demo-company"]
  let org = null
  for (const slug of PRIORITY_SLUGS) {
    org = await prisma.organization.findUnique({ where: { slug } })
    if (org) break
  }
  if (!org) {
    // Nothing matching priorities — bootstrap the `leaddrive` tenant.
    org = await prisma.organization.create({
      data: {
        slug: "leaddrive",
        name: "LeadDrive Inc.",
        plan: "enterprise",
        isActive: true,
        features: LEADDRIVE_FEATURES as any,
      },
    })
    console.log(`  ✓ bootstrapped new org leaddrive (${org.id})`)
  }
  console.log(`✅ Organization: ${org.name} (${org.id})`)
  const orgId = org.id

  // Ensure the MTM module is enabled on this org. Without it, the sidebar
  // hides the entire Route & Field group via hasModule(org, "mtm") and the
  // freshly-seeded data is unreachable from the admin UI.
  const rawFeatures = (org as any).features
  const features = Array.isArray(rawFeatures)
    ? [...rawFeatures]
    : typeof rawFeatures === "string"
      ? JSON.parse(rawFeatures || "[]")
      : []
  if (!features.includes("mtm")) {
    features.push("mtm")
    await prisma.organization.update({ where: { id: orgId }, data: { features } })
    console.log(`  ✓ enabled "mtm" module on ${org.slug}`)
  }

  // Hash demo password once for all agents.
  const demoPasswordHash = await bcrypt.hash(AGENT_PASSWORD, 12)

  // 2. Find or create the demo admin user (F-37). We use a tenant-distinct
  //    email `admin@leaddrive.com` rather than a personal email so this seed
  //    can run idempotently across machines without colliding with someone's
  //    real CRM account.
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
  const adminUser = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: orgId, email: "admin@leaddrive.com" } },
    update: {
      name: "LeadDrive Admin",
      role: "admin",
      isActive: true,
      passwordHash: adminHash,
      passwordChangedAt: new Date(),
    },
    create: {
      organizationId: orgId,
      email: "admin@leaddrive.com",
      name: "LeadDrive Admin",
      role: "admin",
      isActive: true,
      passwordHash: adminHash,
      passwordChangedAt: new Date(),
    },
  })
  console.log("  ✓ ensured admin user admin@leaddrive.com")
  console.log(`✅ Admin user: ${adminUser.name}`)

  // ═══════════════════════════════════════════════════
  // AGENTS (4)
  // ═══════════════════════════════════════════════════
  console.log("\n📋 Creating agents...")

  const agentRashad = await prisma.mtmAgent.upsert({
    where: { organizationId_email: { organizationId: orgId, email: "rashad@leaddrivecrm.org" } },
    update: { name: "Rashad Rahimov", role: "MANAGER", status: "ACTIVE", userId: adminUser?.id || null },
    create: {
      organizationId: orgId,
      name: "Rashad Rahimov",
      email: "rashad@leaddrivecrm.org",
      phone: "+994-50-555-0001",
      role: "MANAGER",
      status: "ACTIVE",
      isOnline: true,
      userId: adminUser?.id || null,
    },
  })
  console.log(`  ✅ ${agentRashad.name} (MANAGER)`)

  const agentAnar = await prisma.mtmAgent.upsert({
    where: { organizationId_email: { organizationId: orgId, email: "anar@leaddrivecrm.org" } },
    update: { name: "Anar Mammadov", role: "AGENT", status: "ACTIVE", managerId: agentRashad.id },
    create: {
      organizationId: orgId,
      name: "Anar Mammadov",
      email: "anar@leaddrivecrm.org",
      phone: "+994-50-555-0002",
      role: "AGENT",
      status: "ACTIVE",
      isOnline: true,
      managerId: agentRashad.id,
    },
  })
  console.log(`  ✅ ${agentAnar.name} (AGENT)`)

  const agentNigar = await prisma.mtmAgent.upsert({
    where: { organizationId_email: { organizationId: orgId, email: "nigar@leaddrivecrm.org" } },
    update: { name: "Nigar Huseynova", role: "AGENT", status: "ACTIVE", managerId: agentRashad.id },
    create: {
      organizationId: orgId,
      name: "Nigar Huseynova",
      email: "nigar@leaddrivecrm.org",
      phone: "+994-50-555-0003",
      role: "AGENT",
      status: "ACTIVE",
      isOnline: false,
      managerId: agentRashad.id,
    },
  })
  console.log(`  ✅ ${agentNigar.name} (AGENT)`)

  // F-35 follow-up: prior versions of this seed created Farid as
  // `farid@leaddrivecrm.org`. Re-running the new seed against an old DB
  // would leave both rows in the same org — mobile auth's compound unique
  // is (orgId, email) so they don't collide on insert, but they do
  // confuse a fresh dev. Delete the stale row inside *this* org only.
  const staleFarid = await prisma.mtmAgent.findUnique({
    where: { organizationId_email: { organizationId: orgId, email: "farid@leaddrivecrm.org" } },
    select: {
      id: true,
      _count: { select: { visits: true, photos: true } },
    },
  })
  if (staleFarid) {
    const used = staleFarid._count.visits + staleFarid._count.photos
    if (used === 0) {
      await prisma.mtmAgent.delete({ where: { id: staleFarid.id } })
      console.log(`  ✓ removed stale Farid row (farid@leaddrivecrm.org) — superseded by farid@leaddrive.com`)
    } else {
      console.log(`  ⚠️  stale Farid row farid@leaddrivecrm.org has ${used} dependent records — leaving in place`)
    }
  }

  // Farid is the demo "mobile agent" that scripts/farid-day.ts logs in as.
  // Email kept tenant-distinct (farid@leaddrive.com, not @leaddrivecrm.org)
  // because the same MtmAgent email in N orgs collides with the legacy
  // non-tenant-scoped lookup in mobile auth — see F-35.
  //
  // Re-seeding deliberately aligns mobile and web credentials with the two
  // explicit local fixture passwords supplied for this run.
  const agentFarid = await prisma.mtmAgent.upsert({
    where: { organizationId_email: { organizationId: orgId, email: "farid@leaddrive.com" } },
    update: {
      name: "Farid Aliyev",
      role: "AGENT",
      status: "ACTIVE",
      managerId: agentRashad.id,
      passwordHash: demoPasswordHash,
    },
    create: {
      organizationId: orgId,
      name: "Farid Aliyev",
      email: "farid@leaddrive.com",
      phone: "+994-50-555-0004",
      role: "AGENT",
      status: "ACTIVE",
      isOnline: false,
      managerId: agentRashad.id,
      passwordHash: demoPasswordHash,
    },
  })
  console.log(`  ✅ ${agentFarid.name} (AGENT)`)

  const faridUser = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: orgId, email: "farid@leaddrive.com" } },
    update: {
      name: "Farid Aliyev",
      role: "sales",
      isActive: true,
      passwordHash: demoPasswordHash,
      passwordChangedAt: new Date(),
    },
    create: {
      organizationId: orgId,
      email: "farid@leaddrive.com",
      name: "Farid Aliyev",
      role: "sales",
      isActive: true,
      passwordHash: demoPasswordHash,
      passwordChangedAt: new Date(),
    },
  })
  if (agentFarid.userId !== faridUser.id) {
    await prisma.mtmAgent.update({ where: { id: agentFarid.id }, data: { userId: faridUser.id } })
  }
  console.log("  ✓ ensured linked web agent farid@leaddrive.com")

  // ═════════════════════════════════════════════════════
  // TEAMS AND VISIT POLICIES
  // ═════════════════════════════════════════════════════
  console.log("\n⚙️  Creating agent teams and visit policies...")

  async function ensureTeam(code: string, name: string) {
    const existing = await prisma.mtmTeam.findFirst({ where: { organizationId: orgId, code } })
    return existing
      ? prisma.mtmTeam.update({ where: { id: existing.id }, data: { name, isActive: true } })
      : prisma.mtmTeam.create({ data: { organizationId: orgId, code, name, isActive: true } })
  }

  const medicalTeam = await ensureTeam("SEED-MEDICAL", "[SEED] Medical Representatives")
  const retailTeam = await ensureTeam("SEED-RETAIL", "[SEED] Retail Agents")
  await Promise.all([
    prisma.mtmAgent.update({ where: { id: agentFarid.id }, data: { teamId: medicalTeam.id } }),
    prisma.mtmAgent.update({ where: { id: agentNigar.id }, data: { teamId: medicalTeam.id } }),
    prisma.mtmAgent.update({ where: { id: agentAnar.id }, data: { teamId: retailTeam.id } }),
  ])

  const defaultAction = (actionKey: string, mode: string, conditions: object | null = null) => ({
    organizationId: orgId,
    actionKey: actionKey as any,
    mode: mode as any,
    minCount: 1,
    conditions: conditions as any,
    allowWaiver: false,
  })
  const policyDefinitions = [
    {
      name: "[SEED] Medical visit requirements",
      teamId: medicalTeam.id,
      actions: [
        defaultAction("PHOTO", "OPTIONAL"),
        defaultAction("PRESENTATION", "REQUIRED"),
        defaultAction("STOCK_CHECK", "OPTIONAL"),
        defaultAction("VISIT_NOTE", "OPTIONAL"),
        defaultAction("CHECKLIST", "OPTIONAL"),
        defaultAction("FEEDBACK", "OPTIONAL"),
        defaultAction("NEXT_ACTION", "REQUIRED", { objectTypes: ["DOCTOR"] }),
      ],
    },
    {
      name: "[SEED] Retail visit requirements",
      teamId: retailTeam.id,
      actions: [
        defaultAction("PHOTO", "OPTIONAL"),
        defaultAction("PRESENTATION", "HIDDEN"),
        defaultAction("STOCK_CHECK", "REQUIRED"),
        defaultAction("VISIT_NOTE", "OPTIONAL"),
        defaultAction("CHECKLIST", "OPTIONAL"),
        defaultAction("FEEDBACK", "OPTIONAL"),
        defaultAction("NEXT_ACTION", "OPTIONAL"),
      ],
    },
  ]

  for (const definition of policyDefinitions) {
    const existing = await prisma.mtmVisitPolicy.findFirst({
      where: { organizationId: orgId, name: definition.name },
      select: { id: true },
    })
    const policy = existing
      ? await prisma.$transaction(async (tx) => {
          await tx.mtmVisitPolicyAction.deleteMany({ where: { policyId: existing.id } })
          return tx.mtmVisitPolicy.update({
            where: { id: existing.id },
            data: {
              teamId: definition.teamId,
              visitType: "DEFAULT",
              priority: 10,
              effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
              effectiveTo: null,
              isActive: true,
              actions: { create: definition.actions },
            },
          })
        })
      : await prisma.mtmVisitPolicy.create({
          data: {
            organizationId: orgId,
            teamId: definition.teamId,
            name: definition.name,
            visitType: "DEFAULT",
            priority: 10,
            effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
            isActive: true,
            createdBy: adminUser.id,
            actions: { create: definition.actions },
          },
        })
    console.log(`  ✅ ${policy.name}`)
  }

  // ═══════════════════════════════════════════════════
  // CUSTOMERS (11) — Baku locations
  // ═══════════════════════════════════════════════════
  console.log("\n🏪 Creating customers...")

  const customersData = [
    { code: "MTM-A01", name: "Əczaçı Plus — Nəsimi", category: "A", city: "Bakı", district: "Nəsimi", address: "Təbriz küç. 28", lat: 40.3953, lng: 49.8822, phone: "+994-12-408-1001", contact: "Elçin Hüseynov" },
    { code: "MTM-A02", name: "Zeytun Market — 28 May", category: "A", city: "Bakı", district: "Səbail", address: "Neftçilər pr. 95", lat: 40.3722, lng: 49.8485, phone: "+994-12-408-1002", contact: "Aynur Qasımova" },
    { code: "MTM-A03", name: "Grand Pharmacy — Xətai", category: "A", city: "Bakı", district: "Xətai", address: "Babək pr. 2044", lat: 40.3882, lng: 49.8750, phone: "+994-12-408-1003", contact: "Rəşad Əlizadə" },
    { code: "MTM-B01", name: "Mini Market Günəş", category: "B", city: "Bakı", district: "Yasamal", address: "Ş.Bədəlbəyli küç. 12", lat: 40.3812, lng: 49.8321, phone: "+994-12-408-2001", contact: "Tural Məmmədov" },
    { code: "MTM-B02", name: "Sağlam Pharmacy", category: "B", city: "Bakı", district: "Binəqədi", address: "M.Hadi küç. 45", lat: 40.4283, lng: 49.8167, phone: "+994-12-408-2002", contact: "Leyla Həsənova" },
    { code: "MTM-B03", name: "Nur Supermarket", category: "B", city: "Bakı", district: "Nərimanov", address: "Ə.Əliyev küç. 77", lat: 40.4102, lng: 49.8531, phone: "+994-12-408-2003", contact: "Kamran Əhmədov" },
    { code: "MTM-B04", name: "Vita Apteki", category: "B", city: "Bakı", district: "Suraxanı", address: "Hövsan şos. 14", lat: 40.4165, lng: 50.0015, phone: "+994-12-408-2004", contact: "Gülnar Babayeva" },
    { code: "MTM-C01", name: "Köşə Dükanı Əhməd", category: "C", city: "Bakı", district: "Sabunçu", address: "Bakıxanov küç. 3", lat: 40.4350, lng: 49.9483, phone: "+994-50-333-0001", contact: "Əhməd Nəsibov" },
    { code: "MTM-C02", name: "Kiçik Mağaza Lalə", category: "C", city: "Bakı", district: "Qaradağ", address: "Lökbatan qəs. 8", lat: 40.3168, lng: 49.7525, phone: "+994-50-333-0002", contact: "Lalə İsmayılova" },
    { code: "MTM-D01", name: "Bağlanmış Dükan — Mərdəkan", category: "D", city: "Bakı", district: "Xəzər", address: "Mərdəkan küç. 55", lat: 40.4950, lng: 50.1494, phone: null, contact: null },
    { code: "MTM-DOC01", name: "Dr. Leyla Qasımova", objectType: "DOCTOR", category: "A", city: "Bakı", district: "Nərimanov", address: "Ağ çiçəyim küç. 19", lat: 40.4021, lng: 49.8724, phone: "+994-50-555-1011", contact: "Dr. Leyla Qasımova" },
  ]

  const customers: any[] = []
  for (const c of customersData) {
    const customer = await prisma.mtmCustomer.upsert({
      where: { organizationId_code: { organizationId: orgId, code: c.code } },
      update: { name: c.name, objectType: (c.objectType || "STORE") as any, category: c.category, city: c.city, district: c.district, address: c.address, latitude: c.lat, longitude: c.lng, phone: c.phone, contactPerson: c.contact },
      create: {
        organizationId: orgId,
        code: c.code,
        name: c.name,
        objectType: (c.objectType || "STORE") as any,
        category: c.category as any,
        status: c.category === "D" ? "INACTIVE" : "ACTIVE",
        city: c.city,
        district: c.district,
        address: c.address,
        latitude: c.lat,
        longitude: c.lng,
        phone: c.phone,
        contactPerson: c.contact,
      },
    })
    customers.push(customer)
    console.log(`  ✅ ${customer.code} — ${customer.name} (${c.category})`)
  }

  // ═══════════════════════════════════════════════════
  // ROUTES (3) with points
  // ═══════════════════════════════════════════════════
  console.log("\n🗺️  Creating routes...")

  // Clean existing routes first (for idempotency)
  await prisma.mtmRoutePoint.deleteMany({ where: { route: { organizationId: orgId, name: { startsWith: "[SEED]" } } } })
  await prisma.mtmRoute.deleteMany({ where: { organizationId: orgId, name: { startsWith: "[SEED]" } } })

  // Route 1: Anar today — PLANNED
  const route1 = await prisma.mtmRoute.create({
    data: {
      organizationId: orgId,
      agentId: agentAnar.id,
      date: today,
      name: "[SEED] Nəsimi-Səbail Route",
      status: "PLANNED",
      totalPoints: 4,
      visitedPoints: 0,
      points: {
        create: [
          { organizationId: orgId, customerId: customers[0].id, orderIndex: 0, status: "PENDING", plannedTime: dateAt(today, 9, 0) },
          { organizationId: orgId, customerId: customers[1].id, orderIndex: 1, status: "PENDING", plannedTime: dateAt(today, 10, 0) },
          { organizationId: orgId, customerId: customers[3].id, orderIndex: 2, status: "PENDING", plannedTime: dateAt(today, 11, 30) },
          { organizationId: orgId, customerId: customers[4].id, orderIndex: 3, status: "PENDING", plannedTime: dateAt(today, 13, 0) },
        ],
      },
    },
  })
  console.log(`  ✅ Route: ${route1.name} (${route1.status}, ${route1.totalPoints} points)`)

  // Route 2: Nigar today — IN_PROGRESS
  const route2 = await prisma.mtmRoute.create({
    data: {
      organizationId: orgId,
      agentId: agentNigar.id,
      date: today,
      name: "[SEED] Xətai-Nərimanov Route",
      status: "IN_PROGRESS",
      totalPoints: 3,
      visitedPoints: 1,
      startedAt: dateAt(today, 9, 15),
      points: {
        create: [
          { organizationId: orgId, customerId: customers[2].id, orderIndex: 0, status: "VISITED", visitedAt: dateAt(today, 9, 30) },
          { organizationId: orgId, customerId: customers[5].id, orderIndex: 1, status: "PENDING", plannedTime: dateAt(today, 11, 0) },
          { organizationId: orgId, customerId: customers[6].id, orderIndex: 2, status: "PENDING", plannedTime: dateAt(today, 13, 0) },
        ],
      },
    },
  })
  console.log(`  ✅ Route: ${route2.name} (${route2.status}, 1/${route2.totalPoints} visited)`)

  // Route 3: Farid yesterday — COMPLETED
  const route3 = await prisma.mtmRoute.create({
    data: {
      organizationId: orgId,
      agentId: agentFarid.id,
      date: yesterday,
      name: "[SEED] Full Bakı Tour",
      status: "COMPLETED",
      totalPoints: 5,
      visitedPoints: 4,
      startedAt: dateAt(yesterday, 8, 30),
      completedAt: dateAt(yesterday, 16, 45),
      points: {
        create: [
          { organizationId: orgId, customerId: customers[0].id, orderIndex: 0, status: "VISITED", visitedAt: dateAt(yesterday, 9, 0) },
          { organizationId: orgId, customerId: customers[2].id, orderIndex: 1, status: "VISITED", visitedAt: dateAt(yesterday, 10, 30) },
          { organizationId: orgId, customerId: customers[4].id, orderIndex: 2, status: "VISITED", visitedAt: dateAt(yesterday, 12, 0) },
          { organizationId: orgId, customerId: customers[5].id, orderIndex: 3, status: "VISITED", visitedAt: dateAt(yesterday, 14, 0) },
          { organizationId: orgId, customerId: customers[7].id, orderIndex: 4, status: "SKIPPED", notes: "Closed for lunch" },
        ],
      },
    },
  })
  console.log(`  ✅ Route: ${route3.name} (${route3.status}, 4/${route3.totalPoints} visited)`)

  // ═══════════════════════════════════════════════════
  // TASKS (8)
  // ═══════════════════════════════════════════════════
  console.log("\n📝 Creating tasks...")

  // Clean existing seed tasks
  await prisma.mtmTask.deleteMany({ where: { organizationId: orgId, title: { startsWith: "[SEED]" } } })

  const tasksData = [
    { agentId: agentAnar.id, customerId: customers[0].id, title: "[SEED] Stock check — Əczaçı Plus", priority: "HIGH", status: "PENDING", dueDate: today },
    { agentId: agentAnar.id, customerId: customers[1].id, title: "[SEED] Display setup — Zeytun Market", priority: "MEDIUM", status: "PENDING", dueDate: today },
    { agentId: agentNigar.id, customerId: customers[2].id, title: "[SEED] Collect payment — Grand Pharmacy", priority: "URGENT", status: "IN_PROGRESS", dueDate: today },
    { agentId: agentNigar.id, customerId: customers[5].id, title: "[SEED] Promo materials delivery — Nur", priority: "MEDIUM", status: "IN_PROGRESS", dueDate: today },
    { agentId: agentFarid.id, customerId: customers[0].id, title: "[SEED] Monthly audit — Əczaçı Plus", priority: "HIGH", status: "COMPLETED", dueDate: yesterday, completedAt: dateAt(yesterday, 15, 0) },
    { agentId: agentFarid.id, customerId: customers[4].id, title: "[SEED] Contract renewal — Sağlam", priority: "LOW", status: "COMPLETED", dueDate: yesterday, completedAt: dateAt(yesterday, 14, 0) },
    { agentId: agentAnar.id, customerId: customers[3].id, title: "[SEED] Price list update — Mini Market", priority: "LOW", status: "OVERDUE", dueDate: new Date(today.getTime() - 3 * 86400000) },
    { agentId: agentNigar.id, customerId: customers[6].id, title: "[SEED] Return defective goods — Vita", priority: "MEDIUM", status: "CANCELLED" },
  ]

  for (const t of tasksData) {
    const task = await prisma.mtmTask.create({
      data: {
        organizationId: orgId,
        agentId: t.agentId,
        customerId: t.customerId,
        title: t.title,
        priority: t.priority as any,
        status: t.status as any,
        dueDate: t.dueDate || null,
        completedAt: (t as any).completedAt || null,
      },
    })
    console.log(`  ✅ ${task.title} (${task.status}/${task.priority})`)
  }

  // ═══════════════════════════════════════════════════
  // VISITS (5)
  // ═══════════════════════════════════════════════════
  console.log("\n📍 Creating visits...")

  await prisma.mtmVisit.deleteMany({ where: { organizationId: orgId, notes: { startsWith: "[SEED]" } } })

  const visitsData = [
    { agentId: agentNigar.id, customerId: customers[2].id, status: "CHECKED_IN", checkInAt: dateAt(today, 9, 30), lat: 40.3882, lng: 49.8750, notes: "[SEED] Checking inventory" },
    { agentId: agentAnar.id, customerId: customers[0].id, status: "CHECKED_IN", checkInAt: dateAt(today, 10, 15), lat: 40.3953, lng: 49.8822, notes: "[SEED] Waiting for manager" },
    { agentId: agentFarid.id, customerId: customers[0].id, status: "CHECKED_OUT", checkInAt: dateAt(yesterday, 9, 0), checkOutAt: dateAt(yesterday, 9, 45), lat: 40.3953, lng: 49.8822, duration: 45, notes: "[SEED] Audit complete" },
    { agentId: agentFarid.id, customerId: customers[2].id, status: "CHECKED_OUT", checkInAt: dateAt(yesterday, 10, 30), checkOutAt: dateAt(yesterday, 11, 20), lat: 40.3882, lng: 49.8750, duration: 50, notes: "[SEED] Order placed" },
    { agentId: agentFarid.id, customerId: customers[4].id, status: "CHECKED_OUT", checkInAt: dateAt(yesterday, 12, 0), checkOutAt: dateAt(yesterday, 12, 30), lat: 40.4283, lng: 49.8167, duration: 30, notes: "[SEED] Quick visit, contract signed" },
  ]

  for (const v of visitsData) {
    await prisma.mtmVisit.create({
      data: {
        organizationId: orgId,
        agentId: v.agentId,
        customerId: v.customerId,
        status: v.status as any,
        checkInAt: v.checkInAt,
        checkOutAt: v.checkOutAt || null,
        checkInLat: v.lat,
        checkInLng: v.lng,
        duration: v.duration || null,
        notes: v.notes,
      },
    })
    console.log(`  ✅ Visit: ${v.status} (${v.notes?.replace("[SEED] ", "")})`)
  }

  // ═══════════════════════════════════════════════════
  // ALERTS (4)
  // ═══════════════════════════════════════════════════
  console.log("\n🚨 Creating alerts...")

  await prisma.mtmAlert.deleteMany({ where: { organizationId: orgId, title: { startsWith: "[SEED]" } } })

  const alertsData = [
    { agentId: agentAnar.id, type: "GPS_SPOOFING", category: "CRITICAL", title: "[SEED] GPS spoofing detected", description: "Agent location jumped 15km in 2 minutes. Possible GPS spoofing." },
    { agentId: agentNigar.id, type: "LATE_START", category: "WARNING", title: "[SEED] Late start — Nigar", description: "Agent started route 45 minutes late (10:00 instead of 09:15)." },
    { agentId: agentAnar.id, type: "LOW_BATTERY", category: "WARNING", title: "[SEED] Low battery — Anar", description: "Agent device battery below 15%. GPS tracking may be interrupted." },
    { agentId: agentFarid.id, type: "MISSED_VISIT", category: "INFO", title: "[SEED] Skipped visit — Sabunçu", description: "Customer was closed. Visit rescheduled for tomorrow.", isResolved: true, resolvedAt: dateAt(yesterday, 17, 0) },
  ]

  for (const a of alertsData) {
    await prisma.mtmAlert.create({
      data: {
        organizationId: orgId,
        agentId: a.agentId,
        type: a.type,
        category: a.category as any,
        title: a.title,
        description: a.description,
        isResolved: a.isResolved || false,
        resolvedAt: (a as any).resolvedAt || null,
      },
    })
    console.log(`  ✅ ${a.category}: ${a.title.replace("[SEED] ", "")}`)
  }

  // ═══════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════
  console.log("\n" + "═".repeat(50))
  console.log("🎉 MTM Quickstart Seed — COMPLETE!")
  console.log("═".repeat(50))
  console.log(`  Agents:    4`)
  console.log(`  Customers: 11`)
  console.log(`  Routes:    3 (with 12 points)`)
  console.log(`  Tasks:     8`)
  console.log(`  Visits:    5`)
  console.log(`  Alerts:    4`)
  console.log(`\n  Total: 35 top-level records + 12 route points`)
  console.log(`  Organization: ${org.name}`)
  console.log(`\n  ✅ Open ${process.env.NEXTAUTH_URL || "http://localhost:3000"} → MTM section to see data!`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma?.$disconnect())
