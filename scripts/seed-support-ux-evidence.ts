import { createHash, randomBytes } from "node:crypto"
import { writeFile } from "node:fs/promises"
import type { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

const DEMO_ORGANIZATION = "Northstar Support Lab"
const DEMO_SLUG = "support-evidence"
const SEED_CONFIRMATION = "ephemeral-support-ux-v1"
const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function assertEphemeralTarget(): void {
  if (process.env.CI !== "true") throw new Error("Support evidence seed is CI-only")
  if (process.env.NODE_ENV === "production") throw new Error("Support evidence seed refuses NODE_ENV=production")
  if (process.env.SUPPORT_EVIDENCE_SEED_CONFIRM !== SEED_CONFIRMATION) {
    throw new Error("Support evidence seed confirmation is missing")
  }

  const databaseUrl = new URL(requiredEnv("DATABASE_URL"))
  if (!LOCAL_DATABASE_HOSTS.has(databaseUrl.hostname)) {
    throw new Error(`Support evidence seed refuses non-local database host: ${databaseUrl.hostname}`)
  }
  if (!/support[_-]ux[_-]evidence/i.test(databaseUrl.pathname)) {
    throw new Error("Support evidence seed requires a dedicated support_ux_evidence database")
  }
}

function fixtureCount(value: string | undefined): number {
  const profile = (value || "typical").trim()
  const named: Record<string, number> = { empty: 0, typical: 50, high: 500 }
  const count = profile in named ? named[profile] : Number(profile)
  if (![0, 5, 50, 500].includes(count)) {
    throw new Error("SUPPORT_EVIDENCE_DATA_PROFILE must identify empty/typical/high or 0/5/50/500")
  }
  return count
}

function closureToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url")
  return { token, tokenHash: createHash("sha256").update(token).digest("hex") }
}

async function main(): Promise<void> {
  assertEphemeralTarget()
  prisma = await makeScriptPrisma()

  const outputPath = requiredEnv("SUPPORT_EVIDENCE_FIXTURE_MANIFEST")
  const count = fixtureCount(process.env.SUPPORT_EVIDENCE_DATA_PROFILE)
  const credentials = {
    agent: {
      email: "agent@support-evidence.invalid",
      password: requiredEnv("SUPPORT_EVIDENCE_AGENT_PASSWORD"),
    },
    manager: {
      email: "manager@support-evidence.invalid",
      password: requiredEnv("SUPPORT_EVIDENCE_MANAGER_PASSWORD"),
    },
    admin: {
      email: "admin@support-evidence.invalid",
      password: requiredEnv("SUPPORT_EVIDENCE_ADMIN_PASSWORD"),
    },
    customer: {
      email: "customer@support-evidence.invalid",
      password: requiredEnv("SUPPORT_EVIDENCE_PORTAL_PASSWORD"),
    },
  }

  const hashes = await Promise.all([
    bcrypt.hash(credentials.agent.password, 12),
    bcrypt.hash(credentials.manager.password, 12),
    bcrypt.hash(credentials.admin.password, 12),
    bcrypt.hash(credentials.customer.password, 12),
  ])

  const organization = await prisma.organization.create({
    data: {
      name: DEMO_ORGANIZATION,
      slug: DEMO_SLUG,
      plan: "enterprise",
      addons: ["ai", "voip"],
      features: ["crm", "support", "settings", "analytics", "voip", "ai", "complaints_register"],
      modules: { crm: true, support: true, settings: true, analytics: true, voip: true, ai: true },
      settings: { defaultLocale: "az", landingPath: "/tickets" },
      maxUsers: 20,
      maxContacts: 1000,
      provisionedAt: new Date(),
      provisionedBy: "support-ux-evidence-ci",
    },
  })

  const [agent, manager, admin] = await Promise.all([
    prisma.user.create({
      data: {
        organizationId: organization.id,
        email: credentials.agent.email,
        name: "Ayla Morgan",
        passwordHash: hashes[0],
        passwordChangedAt: new Date(),
        role: "support",
        skills: ["billing", "technical", "returns"],
        maxTickets: 40,
        isAvailable: true,
        preferredLanguage: "az",
      },
    }),
    prisma.user.create({
      data: {
        organizationId: organization.id,
        email: credentials.manager.email,
        name: "Milan Reed",
        passwordHash: hashes[1],
        passwordChangedAt: new Date(),
        role: "manager",
        skills: ["billing", "technical", "quality"],
        maxTickets: 60,
        isAvailable: true,
        preferredLanguage: "az",
      },
    }),
    prisma.user.create({
      data: {
        organizationId: organization.id,
        email: credentials.admin.email,
        name: "Noah Ellis",
        passwordHash: hashes[2],
        passwordChangedAt: new Date(),
        role: "admin",
        skills: ["administration", "quality"],
        maxTickets: 80,
        isAvailable: true,
        preferredLanguage: "az",
      },
    }),
  ])

  const sla = await prisma.slaPolicy.create({
    data: {
      organizationId: organization.id,
      name: "Standard care",
      priority: "medium",
      firstResponseHours: 1,
      resolutionHours: 8,
      businessHoursOnly: true,
      isDefault: true,
    },
  })
  const company = await prisma.company.create({
    data: {
      organizationId: organization.id,
      name: DEMO_ORGANIZATION,
      industry: "Software testing",
      email: "hello@northstar-support.invalid",
      status: "active",
      category: "client",
      slaPolicyId: sla.id,
    },
  })
  const contact = await prisma.contact.create({
    data: {
      organizationId: organization.id,
      companyId: company.id,
      fullName: "Jamie Parker",
      email: credentials.customer.email,
      phone: "+12025550143",
      preferredLanguage: "az",
      lifecycleStage: "customer",
      portalAccessEnabled: true,
      portalPasswordHash: hashes[3],
    },
  })
  const queue = await prisma.ticketQueue.create({
    data: {
      organizationId: organization.id,
      name: "Customer care",
      skills: ["billing", "technical", "returns"],
      priority: 10,
      assignMethod: "least_loaded",
      lastAssignedTo: agent.id,
    },
  })
  const [generalCategory, complaintCategory] = await Promise.all([
    prisma.ticketCategory.create({
      data: {
        organizationId: organization.id,
        name: "Technical help",
        slug: "technical-help",
        description: "Product questions and troubleshooting",
        scope: "ticket",
        defaultPriority: "medium",
        defaultQueueId: queue.id,
        sortOrder: 10,
      },
    }),
    prisma.ticketCategory.create({
      data: {
        organizationId: organization.id,
        name: "Product feedback",
        slug: "product-feedback",
        description: "Complaints and improvement requests",
        scope: "complaint",
        defaultPriority: "high",
        defaultQueueId: queue.id,
        sortOrder: 20,
      },
    }),
  ])
  await prisma.ticketCategory.create({
    data: {
      organizationId: organization.id,
      name: "Sign-in troubleshooting",
      slug: "sign-in-troubleshooting",
      description: "Child category used to prove hierarchy behavior",
      parentId: generalCategory.id,
      scope: "ticket",
      defaultPriority: "medium",
      defaultQueueId: queue.id,
      sortOrder: 10,
    },
  })

  await Promise.all([
    prisma.escalationRule.create({
      data: {
        organizationId: organization.id,
        name: "Escalate approaching SLA",
        triggerType: "resolution_warning",
        triggerMinutes: 30,
        level: 1,
        actions: [{ type: "notify", target: "manager" }, { type: "increase_priority" }],
      },
    }),
    prisma.ticketMacro.create({
      data: {
        organizationId: organization.id,
        name: "Request diagnostics",
        description: "Ask the customer for reproducible diagnostic details",
        category: "technical",
        actions: [{ type: "add_comment", value: "Please share the exact steps and the time the issue occurred." }],
        shortcutKey: "diagnostics",
        createdBy: admin.id,
      },
    }),
  ])

  const kbCategory = await prisma.kbCategory.create({
    data: { organizationId: organization.id, name: "Getting started", sortOrder: 10 },
  })
  const [primaryKbArticle] = await Promise.all([
    prisma.kbArticle.create({
      data: {
        organizationId: organization.id,
        title: "Resolve a sign-in issue",
        content: "Check your workspace address, then reset your password if needed.",
        categoryId: kbCategory.id,
        status: "published",
        authorId: manager.id,
        tags: ["account", "sign-in"],
        viewCount: 24,
        helpfulCount: 18,
      },
    }),
    prisma.kbArticle.create({
      data: {
        organizationId: organization.id,
        title: "Follow a support request",
        content: "Open My tickets to review the latest status and replies.",
        categoryId: kbCategory.id,
        status: "published",
        authorId: agent.id,
        tags: ["tickets"],
        viewCount: 16,
        helpfulCount: 12,
      },
    }),
  ])

  if (count === 0) {
    await writeFile(outputPath, JSON.stringify({
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
      accounts: {
        agent: { email: credentials.agent.email },
        manager: { email: credentials.manager.email },
        admin: { email: credentials.admin.email },
        customer: { email: credentials.customer.email },
      },
      fixtures: {},
      dataProfile: process.env.SUPPORT_EVIDENCE_DATA_PROFILE || "empty",
      synthetic: true,
    }, null, 2) + "\n", { mode: 0o600 })
    return
  }

  const portalTicket = await prisma.ticket.create({
    data: {
      organizationId: organization.id,
      ticketNumber: "SUP-1001",
      subject: `${DEMO_ORGANIZATION}: access request`,
      description: "The customer needs help restoring access to a test workspace.",
      priority: "medium",
      status: "open",
      category: "technical",
      categoryId: generalCategory.id,
      contactId: contact.id,
      companyId: company.id,
      assignedTo: agent.id,
      createdBy: manager.id,
      source: "portal",
      requesterName: contact.fullName,
      requesterEmail: contact.email,
      requesterPhone: contact.phone,
      tags: ["demo", "access"],
      slaPolicyName: sla.name,
      slaFirstResponseDueAt: new Date(Date.now() + 60 * 60 * 1000),
      slaDueAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    },
  })
  await prisma.ticketComment.createMany({
    data: [
      { ticketId: portalTicket.id, userId: contact.id, comment: "I can open the portal but cannot reach my workspace." },
      { ticketId: portalTicket.id, userId: agent.id, comment: "I am checking the access policy now." },
    ],
  })

  const complaint = await prisma.ticket.create({
    data: {
      organizationId: organization.id,
      ticketNumber: "CMP-1001",
      subject: `${DEMO_ORGANIZATION}: delayed notification`,
      description: "A test notification arrived later than expected.",
      priority: "high",
      status: "in_progress",
      category: "complaint",
      categoryId: complaintCategory.id,
      contactId: contact.id,
      companyId: company.id,
      assignedTo: manager.id,
      createdBy: admin.id,
      source: "portal",
      requesterName: contact.fullName,
      requesterEmail: contact.email,
      tags: ["demo", "quality"],
      slaPolicyName: sla.name,
      slaFirstResponseDueAt: new Date(Date.now() - 30 * 60 * 1000),
      slaDueAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
  })
  await prisma.complaintMeta.create({
    data: {
      ticketId: complaint.id,
      organizationId: organization.id,
      externalRegistryNumber: 1001,
      complaintType: "complaint",
      brand: "Northstar Desk",
      productionArea: "Customer portal",
      productCategory: "Notifications",
      complaintObject: "Delivery delay",
      complaintObjectDetail: "Synthetic evidence fixture",
      responsibleDepartment: "Support quality",
      riskLevel: "medium",
    },
  })

  const additionalTickets = Math.max(0, count - 2)
  if (additionalTickets > 0) {
    const statuses = ["new", "open", "in_progress", "resolved"]
    const priorities = ["low", "medium", "high", "urgent"]
    await prisma.ticket.createMany({
      data: Array.from({ length: additionalTickets }, (_, index) => ({
        organizationId: organization.id,
        ticketNumber: `SUP-${String(index + 1002).padStart(4, "0")}`,
        subject: `Synthetic request ${index + 1}`,
        description: "Generated only for Support UX density and performance evidence.",
        priority: priorities[index % priorities.length],
        status: statuses[index % statuses.length],
        category: "technical",
        categoryId: generalCategory.id,
        contactId: contact.id,
        companyId: company.id,
        assignedTo: index % 5 === 0 ? null : index % 3 === 0 ? manager.id : agent.id,
        createdBy: admin.id,
        source: index % 2 === 0 ? "portal" : "email",
        requesterName: contact.fullName,
        requesterEmail: contact.email,
        tags: ["demo", `batch-${index % 5}`],
        slaPolicyName: sla.name,
        slaFirstResponseDueAt: new Date(Date.now() + (index + 1) * 60 * 1000),
        slaDueAt: new Date(Date.now() + (index + 2) * 60 * 60 * 1000),
      })),
    })
  }

  await prisma.callLog.createMany({
    data: Array.from({ length: 8 }, (_, index) => ({
      organizationId: organization.id,
      callSid: `support-evidence-${index + 1}`,
      direction: index % 2 === 0 ? "inbound" : "outbound",
      fromNumber: index % 2 === 0 ? "+12025550143" : "+12025550199",
      toNumber: index % 2 === 0 ? "+12025550199" : "+12025550143",
      targetPhoneE164: "+12025550143",
      status: "completed",
      duration: 90 + index * 15,
      contactId: contact.id,
      companyId: company.id,
      ticketId: portalTicket.id,
      userId: agent.id,
      provider: "evidence-fixture",
      providerCallId: `support-evidence-provider-${index + 1}`,
      wasAnswered: true,
      providerOutcome: "connected",
      startedAt: new Date(Date.now() - (index + 1) * 60 * 60 * 1000),
      endedAt: new Date(Date.now() - (index + 1) * 60 * 60 * 1000 + (90 + index * 15) * 1000),
    })),
  })

  const entitlement = await prisma.entitlement.create({
    data: {
      organizationId: organization.id,
      companyId: company.id,
      slaPolicyId: sla.id,
      supportLevel: "premium",
      validFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      status: "active",
      notes: "Synthetic Support UX evidence entitlement",
      createdBy: admin.id,
    },
  })
  await prisma.entitlementMilestoneDefinition.createMany({
    data: [
      {
        organizationId: organization.id,
        entitlementId: entitlement.id,
        type: "first_response",
        name: "First response",
        dueWithinSeconds: 3600,
      },
      {
        organizationId: organization.id,
        entitlementId: entitlement.id,
        type: "resolution",
        name: "Resolution",
        dueWithinSeconds: 28800,
      },
    ],
  })
  const template = await prisma.entitlementMilestoneTemplate.create({
    data: {
      organizationId: organization.id,
      supportLevel: "premium",
      name: "Premium support milestones",
      description: "Reusable synthetic evidence template",
    },
  })
  await prisma.entitlementMilestoneTemplateRule.createMany({
    data: [
      {
        organizationId: organization.id,
        templateId: template.id,
        type: "first_response",
        name: "First response",
        dueWithinSeconds: 3600,
        sortOrder: 10,
      },
      {
        organizationId: organization.id,
        templateId: template.id,
        type: "resolution",
        name: "Resolution",
        dueWithinSeconds: 28800,
        sortOrder: 20,
      },
    ],
  })

  const closure = closureToken()
  await prisma.ticketClosureRequest.create({
    data: {
      organizationId: organization.id,
      ticketId: portalTicket.id,
      status: "pending",
      channel: "portal",
      recipient: contact.email,
      tokenHash: closure.tokenHash,
      requestedBy: agent.id,
      dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  await writeFile(outputPath, JSON.stringify({
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    accounts: {
      agent: { email: credentials.agent.email },
      manager: { email: credentials.manager.email },
      admin: { email: credentials.admin.email },
      customer: { email: credentials.customer.email },
    },
    fixtures: {
      ticketId: portalTicket.id,
      complaintId: complaint.id,
      portalTicketId: portalTicket.id,
      kbArticleId: primaryKbArticle.id,
      ticketCategoryId: generalCategory.id,
      slaPolicyId: sla.id,
      entitlementId: entitlement.id,
      closureToken: closure.token,
    },
    dataProfile: process.env.SUPPORT_EVIDENCE_DATA_PROFILE || "typical",
    synthetic: true,
  }, null, 2) + "\n", { mode: 0o600 })
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
