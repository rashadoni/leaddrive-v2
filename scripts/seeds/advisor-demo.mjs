// Seed pilot-ready Da Vinci Advisor data for one tenant.
//
// Usage:
//   ADVISOR_DEMO_PASSWORD='...' node scripts/seeds/advisor-demo.mjs --slug=<tenant-slug>
//   node scripts/seeds/advisor-demo.mjs --slug=<tenant-slug> --clean
// Non-local databases additionally require CONFIRM_PROD=advisor-demo:<tenant-slug>.
//
// The seed is intentionally narrow and signal-driven: every row below is shaped
// to trigger src/lib/ai/advisor/signals.ts, so /ai/actions has real Advisor
// risks across CRM, sales, contracts, marketing, tasks, finance, support,
// routes, MTM and KPI.

import bcrypt from "bcryptjs"
import { makeScriptPrisma } from "../_rls.mjs"
import { passwordPolicyError } from "../password-policy.mjs"

let prisma

const PREFIX = "ADV-DEMO"
const MARKER = "@advisor-demo.local"
const CLEAN = process.argv.includes("--clean")
const REQUIRED_TABLES = [
  "ai_shadow_actions",
  "proactive_alerts",
  "mtm_agents",
  "mtm_routes",
  "mtm_visits",
  "mtm_photos",
  "payment_orders",
  "invoices",
  "bills",
  "quotes",
  "offers",
  "contracts",
  "tickets",
  "campaigns",
  "advisor_playbooks",
  "advisor_signal_snapshots",
]

function getArg(name) {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`))
  return arg ? arg.split("=").slice(1).join("=") : null
}

const slug = getArg("slug")

if (!slug) {
  console.error("Usage: node scripts/seeds/advisor-demo.mjs --slug=<tenant-slug> [--clean]")
  process.exit(1)
}

function isLocalDatabase(databaseUrl) {
  if (process.env.NODE_ENV === "production") return false
  try {
    const hostname = new URL(databaseUrl || "").hostname
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(hostname)
  } catch {
    return false
  }
}

if (!isLocalDatabase(process.env.DATABASE_URL)) {
  const requiredConfirmation = `advisor-demo:${slug}`
  if (process.env.CONFIRM_PROD !== requiredConfirmation) {
    throw new Error(`Set CONFIRM_PROD=${requiredConfirmation} to modify this non-local tenant`)
  }
}

const advisorPassword = process.env.ADVISOR_DEMO_PASSWORD
if (!CLEAN) {
  const passwordError = passwordPolicyError(advisorPassword)
  if (passwordError) throw new Error(`ADVISOR_DEMO_PASSWORD rejected: ${passwordError}`)
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

function todayAt(hours, minutes = 0) {
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date
}

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

function mergeUnique(values) {
  return Array.from(new Set(values.filter(Boolean)))
}

function advisorDemoActionPayload(input) {
  return {
    title: input.title,
    description: input.description,
    relatedType: input.relatedType,
    relatedId: input.relatedId,
    advisor: {
      signalId: input.signalId,
      domain: input.domain,
      severity: input.severity,
      ownerId: input.ownerId,
      ownerLabel: input.ownerLabel,
      title: input.signalTitle,
      summary: input.summary,
      facts: input.facts,
      sources: input.sources,
      actionLabel: input.actionLabel,
      risk: input.risk,
      autonomy: {
        actionType: input.actionType,
        maxLevel: "L2",
        requiresApproval: true,
        reason: "Advisor demo tenant starts approval-gated.",
      },
      queuedAt: new Date().toISOString(),
    },
  }
}

async function setUpdatedAt(modelName, id, updatedAt) {
  await prisma[modelName].update({
    where: { id },
    data: { updatedAt },
  })
}

async function ensureAdvisorModules(org) {
  const currentModules = org.modules && typeof org.modules === "object" && !Array.isArray(org.modules)
    ? org.modules
    : {}
  const modules = {
    ...currentModules,
    crm: true,
    sales: true,
    contracts: true,
    marketing: true,
    support: true,
    finance: true,
    analytics: true,
    mtm: true,
    settings: true,
  }
  const currentFeatures = Array.isArray(org.features) ? org.features : []
  const features = mergeUnique([
    ...currentFeatures,
    "ai",
    "deals",
    "leads",
    "offers",
    "quotes",
    "contracts",
    "campaigns",
    "tickets",
    "invoices",
    "payments",
    "budgeting",
    "reports",
    "tasks",
    "projects",
    "mtm",
  ])
  const addons = mergeUnique([...(org.addons || []), "ai", "finance", "mtm"])
  const settings = org.settings && typeof org.settings === "object" && !Array.isArray(org.settings)
    ? org.settings
    : {}

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      modules,
      features,
      addons,
      settings: {
        ...settings,
        aiDailyBudgetUsd: Math.max(Number(settings.aiDailyBudgetUsd || 0), 10),
        aiAdvisorDailyRequestLimit: Math.max(Number(settings.aiAdvisorDailyRequestLimit || 0), 300),
      },
    },
  })
}

async function assertAdvisorDemoSchema() {
  const missing = []
  for (const table of REQUIRED_TABLES) {
    const rows = await prisma.$queryRaw`SELECT to_regclass(${`public.${table}`})::text AS name`
    if (!rows?.[0]?.name) missing.push(table)
  }
  if (missing.length > 0) {
    const error = new Error([
      "Advisor demo seed requires the current database schema before it can create responsive-QA data.",
      `Missing tables: ${missing.join(", ")}`,
      "For a local database, load the project env and run: npx prisma migrate dev",
      "For a deployed database, run the normal migration deploy procedure first.",
    ].join("\n"))
    error.advisorPreflight = true
    throw error
  }
}

async function cleanAdvisorDemoData(orgId) {
  const demoUsers = await prisma.user.findMany({
    where: { organizationId: orgId, email: { endsWith: MARKER } },
    select: { id: true },
  })
  const demoUserIds = demoUsers.map((user) => user.id)
  const demoAgents = await prisma.mtmAgent.findMany({
    where: { organizationId: orgId, email: { endsWith: MARKER } },
    select: { id: true },
  })
  const demoAgentIds = demoAgents.map((agent) => agent.id)
  const demoPhotos = await prisma.mtmPhoto.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { url: { contains: "advisor-demo.local" } },
        { agentId: { in: demoAgentIds.length ? demoAgentIds : ["__none__"] } },
      ],
    },
    select: { id: true },
  })
  const demoPhotoIds = demoPhotos.map((photo) => photo.id)

  await prisma.aiShadowAction.deleteMany({
    where: {
      organizationId: orgId,
      OR: [
        { featureName: { startsWith: "advisor:" } },
        { featureName: "advisor_signal", sourceSignalId: { startsWith: `${PREFIX}:` } },
      ],
    },
  })
  await prisma.advisorPlaybook.deleteMany({ where: { organizationId: orgId, patternKey: { startsWith: "sales:deal:create_task:create_follow-up_task" } } }).catch(() => undefined)
  await prisma.advisorSignalSnapshot.deleteMany({
    where: {
      organizationId: orgId,
      OR: [
        { snapshotKey: { startsWith: `${PREFIX}-` } },
        { signalIds: { hasSome: [`${PREFIX}:sales:previous`, `${PREFIX}:finance:previous`] } },
      ],
    },
  }).catch(() => undefined)
  await prisma.proactiveAlert.deleteMany({ where: { organizationId: orgId, context: { path: ["advisor"], equals: true } } }).catch(() => undefined)
  await prisma.mtmPhoto.deleteMany({
    where: {
      organizationId: orgId,
      OR: [
        { id: { in: demoPhotoIds.length ? demoPhotoIds : ["__none__"] } },
        { url: { contains: "advisor-demo.local" } },
      ],
    },
  })
  await prisma.mtmVisit.deleteMany({
    where: {
      organizationId: orgId,
      OR: [
        { notes: { contains: PREFIX } },
        { agentId: { in: demoAgentIds.length ? demoAgentIds : ["__none__"] } },
      ],
    },
  })
  await prisma.mtmRoute.deleteMany({
    where: {
      organizationId: orgId,
      OR: [
        { name: { startsWith: PREFIX } },
        { agentId: { in: demoAgentIds.length ? demoAgentIds : ["__none__"] } },
      ],
    },
  })
  await prisma.mtmTask.deleteMany({ where: { organizationId: orgId, title: { startsWith: PREFIX } } })
  await prisma.mtmCustomer.deleteMany({ where: { organizationId: orgId, code: { startsWith: `${PREFIX}-STORE-` } } })
  await prisma.mtmAgent.deleteMany({ where: { organizationId: orgId, email: { endsWith: MARKER } } })

  await prisma.invoice.deleteMany({ where: { organizationId: orgId, invoiceNumber: { startsWith: PREFIX } } })
  await prisma.bill.deleteMany({ where: { organizationId: orgId, billNumber: { startsWith: PREFIX } } })
  await prisma.paymentOrder.deleteMany({ where: { organizationId: orgId, orderNumber: { startsWith: PREFIX } } })
  await prisma.quote.deleteMany({ where: { organizationId: orgId, quoteNumber: { startsWith: PREFIX } } })
  await prisma.offer.deleteMany({ where: { organizationId: orgId, offerNumber: { startsWith: PREFIX } } })
  await prisma.contract.deleteMany({ where: { organizationId: orgId, contractNumber: { startsWith: PREFIX } } })
  await prisma.ticket.deleteMany({ where: { organizationId: orgId, ticketNumber: { startsWith: PREFIX } } })
  await prisma.task.deleteMany({ where: { organizationId: orgId, title: { startsWith: PREFIX } } })
  await prisma.campaign.deleteMany({ where: { organizationId: orgId, name: { startsWith: PREFIX } } })
  await prisma.lead.deleteMany({ where: { organizationId: orgId, email: { endsWith: MARKER } } })
  await prisma.deal.deleteMany({ where: { organizationId: orgId, name: { startsWith: PREFIX } } })
  await prisma.contact.deleteMany({ where: { organizationId: orgId, email: { endsWith: MARKER } } })
  await prisma.company.deleteMany({ where: { organizationId: orgId, email: { endsWith: MARKER } } })
  await prisma.user.deleteMany({ where: { organizationId: orgId, id: { in: demoUserIds.length ? demoUserIds : ["__none__"] } } })

  return {
    users: demoUserIds.length,
    agents: demoAgentIds.length,
    photos: demoPhotoIds.length,
  }
}

async function ensureUser(orgId, name, email, role) {
  const existing = await prisma.user.findFirst({ where: { organizationId: orgId, email } })
  if (existing) return existing
  const passwordHash = await bcrypt.hash(advisorPassword, 12)
  return prisma.user.create({
    data: {
      organizationId: orgId,
      name,
      email,
      role,
      passwordHash,
      passwordChangedAt: new Date(),
      isActive: true,
    },
  })
}

async function createCompany(orgId, input) {
  return prisma.company.create({
    data: {
      organizationId: orgId,
      name: input.name,
      industry: input.industry,
      website: input.website,
      email: input.email,
      phone: input.phone,
      city: "Baku",
      country: "AZ",
      employeeCount: input.employeeCount,
      annualRevenue: input.annualRevenue,
      status: "active",
      category: input.category || "client",
      leadScore: input.leadScore || 0,
    },
  })
}

async function main() {
  prisma = await makeScriptPrisma()
  const org = await prisma.organization.findUnique({ where: { slug } })
  if (!org) {
    console.error(`Tenant not found: ${slug}`)
    process.exit(1)
  }

  console.log(`Tenant: ${org.name} (${slug})`)
  await assertAdvisorDemoSchema()

  const cleaned = await cleanAdvisorDemoData(org.id)
  console.log(`Cleaned Advisor demo rows: users=${cleaned.users}, agents=${cleaned.agents}, photos=${cleaned.photos}`)

  if (CLEAN) return

  await ensureAdvisorModules(org)

  const manager = await ensureUser(org.id, "Advisor Demo Manager", `advisor.manager${MARKER}`, "manager")
  const supportOwner = await ensureUser(org.id, "Advisor Support Owner", `advisor.support${MARKER}`, "support")
  const fieldOwner = await ensureUser(org.id, "Advisor Field Supervisor", `advisor.field${MARKER}`, "manager")

  const retail = await createCompany(org.id, {
    name: `${PREFIX} Retail Group`,
    industry: "Retail",
    website: "advisor-demo.local/retail",
    email: `retail${MARKER}`,
    phone: "+994 12 000 10 01",
    employeeCount: 420,
    annualRevenue: 4800000,
  })
  const logistics = await createCompany(org.id, {
    name: `${PREFIX} Logistics Buyer`,
    industry: "Distribution",
    website: "advisor-demo.local/logistics",
    email: `logistics${MARKER}`,
    phone: "+994 12 000 10 02",
    employeeCount: 160,
    annualRevenue: 2700000,
  })
  const supportCompany = await createCompany(org.id, {
    name: `${PREFIX} Support Account`,
    industry: "FMCG",
    website: "advisor-demo.local/support",
    email: `support-account${MARKER}`,
    phone: "+994 12 000 10 03",
    employeeCount: 85,
    annualRevenue: 950000,
  })

  const staleContact = await prisma.contact.create({
    data: {
      organizationId: org.id,
      companyId: retail.id,
      fullName: "Aysel Advisor Demo",
      email: `aysel${MARKER}`,
      phone: "+994 50 000 10 01",
      position: "Procurement Lead",
      lifecycleStage: "customer",
      engagementScore: 22,
      isActive: true,
      lastActivityAt: daysAgo(67),
      lastContactAt: daysAgo(67),
      createdAt: daysAgo(140),
      tags: ["advisor-demo"],
    },
  })

  const buyerContact = await prisma.contact.create({
    data: {
      organizationId: org.id,
      companyId: logistics.id,
      fullName: "Kamran Advisor Demo",
      email: `kamran${MARKER}`,
      phone: "+994 50 000 10 02",
      position: "Operations Director",
      lifecycleStage: "opportunity",
      engagementScore: 58,
      isActive: true,
      lastActivityAt: daysAgo(18),
      createdAt: daysAgo(90),
      tags: ["advisor-demo"],
    },
  })

  const stalledDeal = await prisma.deal.create({
    data: {
      organizationId: org.id,
      companyId: retail.id,
      contactId: staleContact.id,
      name: `${PREFIX} stalled route expansion`,
      stage: "NEGOTIATION",
      valueAmount: 42000,
      currency: "AZN",
      probability: 65,
      assignedTo: manager.id,
      expectedClose: daysAgo(5),
      stageChangedAt: daysAgo(38),
      tags: ["advisor-demo"],
    },
  })

  await prisma.lead.create({
    data: {
      organizationId: org.id,
      contactName: "Leyla Hot Advisor",
      companyName: `${PREFIX} New Retail Chain`,
      email: `hot.lead${MARKER}`,
      phone: "+994 50 000 20 01",
      source: "website",
      status: "new",
      priority: "high",
      score: 94,
      assignedTo: null,
      estimatedValue: 18000,
      notes: "Advisor demo: hot unassigned lead.",
      createdAt: daysAgo(2),
    },
  })
  const coldLead = await prisma.lead.create({
    data: {
      organizationId: org.id,
      contactName: "Rauf Cold Advisor",
      companyName: `${PREFIX} Dormant Prospect`,
      email: `cold.lead${MARKER}`,
      phone: "+994 50 000 20 02",
      source: "event",
      status: "contacted",
      priority: "medium",
      score: 18,
      assignedTo: manager.id,
      estimatedValue: 9000,
      notes: "Advisor demo: low-score stale lead.",
      createdAt: daysAgo(80),
    },
  })
  await setUpdatedAt("lead", coldLead.id, daysAgo(51))

  const contract = await prisma.contract.create({
    data: {
      organizationId: org.id,
      companyId: retail.id,
      contactId: staleContact.id,
      dealId: stalledDeal.id,
      contractNumber: `${PREFIX}-CTR-001`,
      title: `${PREFIX} annual retail operations contract`,
      type: "service_agreement",
      status: "approved",
      startDate: daysAgo(45),
      endDate: daysFromNow(30),
      valueAmount: 42000,
      currency: "AZN",
      createdBy: manager.id,
      signedAt: null,
      currentApprovalStage: null,
      notes: "Advisor demo: approved but unsigned.",
    },
  })
  await setUpdatedAt("contract", contract.id, daysAgo(12))

  const approvalContract = await prisma.contract.create({
    data: {
      organizationId: org.id,
      companyId: logistics.id,
      contactId: buyerContact.id,
      dealId: stalledDeal.id,
      contractNumber: `${PREFIX}-CTR-002`,
      title: `${PREFIX} logistics renewal approval`,
      type: "service_agreement",
      status: "pending_approval",
      startDate: daysAgo(370),
      endDate: daysFromNow(18),
      valueAmount: 26000,
      currency: "AZN",
      createdBy: manager.id,
      currentApprovalStage: 2,
      notes: "Advisor demo: approval stage is open.",
    },
  })

  const offer = await prisma.offer.create({
    data: {
      organizationId: org.id,
      offerNumber: `${PREFIX}-OFF-001`,
      dealId: stalledDeal.id,
      companyId: retail.id,
      contactId: staleContact.id,
      title: `${PREFIX} field execution package offer`,
      status: "sent",
      totalAmount: 15500,
      currency: "AZN",
      clientName: retail.name,
      contactPerson: staleContact.fullName,
      validUntil: daysAgo(4),
      sentAt: daysAgo(24),
      recipientEmail: staleContact.email,
      createdBy: manager.id,
      notes: "Advisor demo: sent offer is idle.",
    },
  })
  await setUpdatedAt("offer", offer.id, daysAgo(20))

  const quote = await prisma.quote.create({
    data: {
      organizationId: org.id,
      quoteNumber: `${PREFIX}-Q-001`,
      version: 1,
      dealId: stalledDeal.id,
      status: "viewed",
      validUntil: daysAgo(2),
      currency: "AZN",
      subtotal: 18800,
      totalAmount: 18800,
      customerName: retail.name,
      sentAt: daysAgo(21),
      viewedAt: daysAgo(18),
      createdBy: manager.id,
      notes: "Advisor demo: quote viewed without decision.",
    },
  })
  await setUpdatedAt("quote", quote.id, daysAgo(18))

  await prisma.campaign.create({
    data: {
      organizationId: org.id,
      name: `${PREFIX} dormant leads email campaign`,
      description: "Advisor demo: delivery without clicks.",
      type: "email",
      status: "active",
      subject: "Field execution audit offer",
      totalRecipients: 680,
      totalSent: 640,
      totalOpened: 146,
      totalClicked: 0,
      budget: 2200,
      actualCost: 1850,
      createdBy: manager.id,
      sentAt: daysAgo(6),
      updatedAt: daysAgo(3),
    },
  })

  const taskSeeds = [
    ["Renewal approval is blocked", "urgent", 9, "contract", approvalContract.id],
    ["Collect overdue invoice owner update", "high", 7, "contract", contract.id],
    ["Route deviation customer callback", "high", 5, "deal", stalledDeal.id],
    ["Repeated ticket root-cause review", "medium", 3, "company", supportCompany.id],
  ]
  for (const [title, priority, overdueDays, relatedType, relatedId] of taskSeeds) {
    await prisma.task.create({
      data: {
        organizationId: org.id,
        title: `${PREFIX} ${title}`,
        description: "Advisor demo: open overdue work for task and KPI signals.",
        status: "in_progress",
        priority,
        dueDate: daysAgo(overdueDays),
        assignedTo: manager.id,
        createdBy: manager.id,
        relatedType,
        relatedId,
        createdAt: daysAgo(overdueDays + 4),
      },
    })
  }

  await prisma.invoice.create({
    data: {
      organizationId: org.id,
      invoiceNumber: `${PREFIX}-INV-001`,
      companyId: retail.id,
      contactId: staleContact.id,
      contractId: contract.id,
      dealId: stalledDeal.id,
      offerId: offer.id,
      title: `${PREFIX} overdue retail rollout invoice`,
      status: "overdue",
      subtotal: 23000,
      totalAmount: 23000,
      paidAmount: 0,
      balanceDue: 23000,
      currency: "AZN",
      issueDate: daysAgo(61),
      dueDate: daysAgo(31),
      sentAt: daysAgo(60),
      recipientEmail: staleContact.email,
      recipientName: staleContact.fullName,
      createdBy: manager.id,
      notes: "Advisor demo: overdue invoice tied to unsigned contract.",
    },
  })

  await prisma.bill.create({
    data: {
      organizationId: org.id,
      billNumber: `${PREFIX}-BILL-001`,
      vendorName: `${PREFIX} Logistics Vendor`,
      vendorId: logistics.id,
      title: `${PREFIX} overdue delivery subcontractor payable`,
      status: "overdue",
      totalAmount: 12800,
      paidAmount: 0,
      balanceDue: 12800,
      currency: "AZN",
      issueDate: daysAgo(50),
      dueDate: daysAgo(19),
      category: "logistics",
      createdBy: manager.id,
      notes: "Advisor demo: payable is overdue.",
    },
  })

  await prisma.paymentOrder.create({
    data: {
      organizationId: org.id,
      orderNumber: `${PREFIX}-PAY-001`,
      counterpartyName: `${PREFIX} Logistics Vendor`,
      counterpartyId: logistics.id,
      amount: 12800,
      currency: "AZN",
      purpose: "Overdue subcontractor payment",
      status: "approved",
      createdBy: manager.id,
      approvedBy: manager.id,
      approvedAt: daysAgo(5),
    },
  })

  await prisma.ticket.create({
    data: {
      organizationId: org.id,
      ticketNumber: `${PREFIX}-TCK-001`,
      subject: "SLA breach: route sync is blocking dispatch",
      description: "Advisor demo: first response SLA is breached.",
      priority: "critical",
      status: "open",
      category: "operations",
      companyId: supportCompany.id,
      contactId: buyerContact.id,
      assignedTo: supportOwner.id,
      createdBy: supportOwner.id,
      slaFirstResponseDueAt: hoursAgo(3),
      slaDueAt: hoursAgo(1),
      firstResponseAt: null,
      source: "portal",
      createdAt: daysAgo(1),
    },
  })
  for (let i = 2; i <= 4; i++) {
    await prisma.ticket.create({
      data: {
        organizationId: org.id,
        ticketNumber: `${PREFIX}-TCK-00${i}`,
        subject: `Repeated complaint ${i}: display data mismatch`,
        description: "Advisor demo: repeated open support issue.",
        priority: i === 2 ? "high" : "medium",
        status: "open",
        category: "operations",
        companyId: supportCompany.id,
        contactId: buyerContact.id,
        assignedTo: supportOwner.id,
        createdBy: supportOwner.id,
        source: "email",
        createdAt: daysAgo(i),
      },
    })
  }

  const agent = await prisma.mtmAgent.create({
    data: {
      organizationId: org.id,
      userId: fieldOwner.id,
      name: "Advisor Field Agent",
      email: `field.agent${MARKER}`,
      phone: "+994 50 000 30 01",
      role: "AGENT",
      status: "ACTIVE",
      isOnline: true,
      lastSeenAt: hoursAgo(2),
    },
  })

  const stores = []
  for (let i = 1; i <= 4; i++) {
    stores.push(await prisma.mtmCustomer.create({
      data: {
        organizationId: org.id,
        code: `${PREFIX}-STORE-${i}`,
        name: `${PREFIX} Store ${i}`,
        category: "B",
        status: "ACTIVE",
        city: "Baku",
        district: i % 2 === 0 ? "Yasamal" : "Narimanov",
      },
    }))
  }

  const route = await prisma.mtmRoute.create({
    data: {
      organizationId: org.id,
      agentId: agent.id,
      date: todayAt(0),
      name: `${PREFIX} Baku retail route`,
      status: "IN_PROGRESS",
      totalPoints: 4,
      visitedPoints: 1,
      startedAt: todayAt(9),
      notes: "Advisor demo: route has missed stop and long break.",
      points: {
        create: [
          { customerId: stores[0].id, orderIndex: 0, status: "VISITED", plannedTime: todayAt(9, 30), visitedAt: hoursAgo(3) },
          { customerId: stores[1].id, orderIndex: 1, status: "PENDING", plannedTime: hoursAgo(1), notes: "Advisor demo missed stop" },
          { customerId: stores[2].id, orderIndex: 2, status: "PENDING", plannedTime: todayAt(15) },
          { customerId: stores[3].id, orderIndex: 3, status: "PENDING", plannedTime: todayAt(16) },
        ],
      },
    },
  })

  const visit = await prisma.mtmVisit.create({
    data: {
      organizationId: org.id,
      agentId: agent.id,
      customerId: stores[1].id,
      status: "CHECKED_IN",
      checkInAt: hoursAgo(3),
      notes: `${PREFIX} stale open visit`,
      tasksCompleted: 1,
      tasksTotal: 4,
    },
  })

  await prisma.mtmPhoto.create({
    data: {
      organizationId: org.id,
      agentId: agent.id,
      visitId: visit.id,
      url: `https://advisor-demo.local/${route.id}/rejected-display.jpg`,
      category: "display",
      status: "REJECTED",
      reviewNote: "Blurred display image; retake required.",
      createdAt: daysAgo(1),
    },
  })

  const salesSources = [{ label: "Deal", entityType: "deal", entityId: stalledDeal.id, href: `/deals/${stalledDeal.id}` }]
  const salesFacts = [
    { label: "Stage age", value: "38 days" },
    { label: "Expected close", value: "overdue" },
  ]
  const pendingPayload = advisorDemoActionPayload({
    signalId: `${PREFIX}:sales:stalled-deal`,
    domain: "sales",
    severity: "high",
    ownerId: manager.id,
    ownerLabel: manager.name,
    signalTitle: `${PREFIX} stalled route expansion has no next step`,
    summary: "Deal is aging in negotiation and close date is overdue.",
    facts: salesFacts,
    sources: salesSources,
    actionType: "create_task",
    actionLabel: "Create follow-up task",
    risk: "low",
    title: `${PREFIX} Follow up stalled route expansion`,
    description: "Call the customer, confirm the blocker and update the next step.",
    relatedType: "deal",
    relatedId: stalledDeal.id,
  })
  const executedPayload = advisorDemoActionPayload({
    signalId: `${PREFIX}:sales:approved-followup`,
    domain: "sales",
    severity: "high",
    ownerId: manager.id,
    ownerLabel: manager.name,
    signalTitle: `${PREFIX} approved follow-up pattern`,
    summary: "Managers repeatedly approved this follow-up pattern.",
    facts: salesFacts,
    sources: salesSources,
    actionType: "create_task",
    actionLabel: "Create follow-up task",
    risk: "low",
    title: `${PREFIX} Approved follow-up task`,
    description: "Demo executed action for Advisor history.",
    relatedType: "deal",
    relatedId: stalledDeal.id,
  })

  await prisma.aiShadowAction.create({
    data: {
      organizationId: org.id,
      featureName: "advisor_signal",
      entityType: "deal",
      entityId: stalledDeal.id,
      actionType: "create_task",
      riskLevel: "low",
      sourceSignalId: `${PREFIX}:sales:queue`,
      evidenceSnapshot: {
        title: pendingPayload.advisor.title,
        summary: pendingPayload.advisor.summary,
        facts: salesFacts,
        sources: salesSources,
        detectedAt: new Date().toISOString(),
      },
      executionStatus: "pending",
      payload: pendingPayload,
    },
  })

  const executedActionIds = []
  for (const index of [1, 2]) {
    const executedAction = await prisma.aiShadowAction.create({
      data: {
        organizationId: org.id,
        featureName: "advisor_signal",
        entityType: "deal",
        entityId: stalledDeal.id,
        actionType: "create_task",
        riskLevel: "low",
        sourceSignalId: `${PREFIX}:sales:approved-${index}`,
        evidenceSnapshot: {
          title: executedPayload.advisor.title,
          summary: executedPayload.advisor.summary,
          facts: salesFacts,
          sources: salesSources,
          detectedAt: daysAgo(index + 1).toISOString(),
        },
        approved: true,
        reviewedBy: manager.id,
        reviewedAt: daysAgo(index),
        executionStatus: "executed",
        executedAt: hoursAgo(18 + index),
        payload: executedPayload,
      },
    })
    executedActionIds.push(executedAction.id)
  }

  await prisma.aiShadowAction.create({
    data: {
      organizationId: org.id,
      featureName: "advisor_signal",
      entityType: "company",
      entityId: supportCompany.id,
      actionType: "create_alert",
      riskLevel: "medium",
      sourceSignalId: `${PREFIX}:support:rejected`,
      evidenceSnapshot: {
        title: `${PREFIX} repeated support complaints`,
        summary: "Rejected demo action remains visible in history.",
        facts: [{ label: "Repeated tickets", value: "4" }],
        sources: [{ label: "Company", entityType: "company", entityId: supportCompany.id, href: `/companies/${supportCompany.id}` }],
        detectedAt: daysAgo(3).toISOString(),
      },
      approved: false,
      reviewedBy: manager.id,
      reviewedAt: daysAgo(2),
      executionStatus: "rejected",
      payload: advisorDemoActionPayload({
        signalId: `${PREFIX}:support:rejected`,
        domain: "support",
        severity: "medium",
        ownerId: supportOwner.id,
        ownerLabel: supportOwner.name,
        signalTitle: `${PREFIX} repeated support complaints`,
        summary: "Rejected demo action remains visible in history.",
        facts: [{ label: "Repeated tickets", value: "4" }],
        sources: [{ label: "Company", entityType: "company", entityId: supportCompany.id, href: `/companies/${supportCompany.id}` }],
        actionType: "create_alert",
        actionLabel: "Create alert",
        risk: "medium",
        title: `${PREFIX} Escalate repeated support complaints`,
        description: "Review support trend before escalating.",
        relatedType: "company",
        relatedId: supportCompany.id,
      }),
    },
  })

  await prisma.advisorPlaybook.upsert({
    where: {
      organizationId_patternKey: {
        organizationId: org.id,
        patternKey: "sales:deal:create_task:create_follow-up_task",
      },
    },
    create: {
      organizationId: org.id,
      name: "sales: Create follow-up task",
      patternKey: "sales:deal:create_task:create_follow-up_task",
      domain: "sales",
      entityType: "deal",
      actionType: "create_task",
      status: "disabled",
      maxAutonomyLevel: "L4",
      dailyLimit: 10,
      approvalCount: 2,
      rejectionCount: 0,
      executionSuccessCount: 2,
      sourceActionIds: executedActionIds,
      payloadTemplate: executedPayload,
      promotedBy: manager.id,
      promotedAt: new Date(),
    },
    update: {
      status: "disabled",
      approvalCount: 2,
      executionSuccessCount: 2,
      sourceActionIds: executedActionIds,
      payloadTemplate: executedPayload,
      promotedBy: manager.id,
      promotedAt: new Date(),
    },
  })

  const previousSnapshotKey = dateKey(daysAgo(1))
  await prisma.advisorSignalSnapshot.upsert({
    where: {
      organizationId_snapshotKey: {
        organizationId: org.id,
        snapshotKey: previousSnapshotKey,
      },
    },
    create: {
      organizationId: org.id,
      snapshotKey: previousSnapshotKey,
      snapshotAt: daysAgo(1),
      totalSignals: 4,
      criticalCount: 0,
      highCount: 1,
      moneyAtRisk: 12000,
      signalIds: [`${PREFIX}:sales:previous`, `${PREFIX}:finance:previous`],
      domainCounts: { sales: 1, finance: 1, support: 1, routes: 1 },
      ownerCounts: { [manager.name]: 2, [supportOwner.name]: 1, [fieldOwner.name]: 1 },
      overview: { totalSignals: 4, criticalCount: 0, highCount: 1, moneyAtRisk: 12000 },
      signals: [
        {
          id: `${PREFIX}:sales:previous`,
          domain: "sales",
          domainLabel: "Sales",
          entityType: "deal",
          entityId: stalledDeal.id,
          title: `${PREFIX} previous stalled deal snapshot`,
          summary: "Previous day baseline for Advisor briefing deltas.",
          severity: "high",
          ownerId: manager.id,
          ownerLabel: manager.name,
          detectedAt: daysAgo(1).toISOString(),
          facts: salesFacts,
          sources: salesSources,
          recommendedActions: [],
        },
      ],
    },
    update: {
      snapshotAt: daysAgo(1),
      totalSignals: 4,
      highCount: 1,
      moneyAtRisk: 12000,
    },
  })

  console.log("Seeded Advisor demo signals:")
  console.log("- CRM idle contact")
  console.log("- Sales stalled deal, hot unassigned lead, cold lead, idle offer and idle quote")
  console.log("- Contract approval/signature risks")
  console.log("- Marketing low-engagement campaign")
  console.log("- Task and KPI overdue owner risks")
  console.log("- Finance overdue invoice, bill and payment order")
  console.log("- Support SLA and repeated-ticket risks")
  console.log("- Routes missed stop/open visit risks")
  console.log("- Approval queue, executed history, rejected history, disabled playbook and briefing snapshot")
  console.log("Demo user credentials were read from ADVISOR_DEMO_PASSWORD and were not logged")
}

main()
  .catch((error) => {
    if (error?.advisorPreflight) {
      console.error(error.message)
    } else {
      console.error(error)
    }
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma?.$disconnect()
  })
