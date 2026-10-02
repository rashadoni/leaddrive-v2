import { writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import bcrypt from "bcryptjs"
import { assertHistoricalSeedEnvironment, historicalFixture, historicalFixtureDigest, historicalTicketIdentity } from "./support-ux-historical-layout-contract.mjs"

export async function seedHistoricalLayout(prisma, fixture, password) {
  historicalFixtureDigest(fixture)
  if (typeof password !== "string" || password.length < 32) throw new Error("EPHEMERAL_PASSWORD_REQUIRED")
  if (await prisma.organization.count() !== 0 || await prisma.user.count() !== 0 || await prisma.ticket.count() !== 0) throw new Error("EMPTY_DATABASE_REQUIRED")
  const anchor = Date.parse(fixture.anchor)
  const date = (offset) => new Date(anchor + offset)
  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.$transaction(async (tx) => {
    await tx.organization.create({ data: {
      ...fixture.organization, plan: "enterprise", features: ["crm", "support", "settings", "analytics"],
      modules: { crm: true, support: true, settings: true, analytics: true },
      settings: { defaultLocale: "en", landingPath: "/tickets" }, maxUsers: 5, maxContacts: 100,
      provisionedAt: date(0), provisionedBy: "support-historical-layout-ci",
      createdAt: date(0), updatedAt: date(0),
    } })
    await tx.user.create({ data: {
      ...fixture.admin, organizationId: fixture.organization.id, passwordHash,
      passwordChangedAt: date(-60 * 1000), maxTickets: 100, isAvailable: true, preferredLanguage: "en", timezone: "UTC",
      createdAt: date(0), updatedAt: date(0),
    } })
    await tx.slaPolicy.create({ data: {
      ...fixture.sla, organizationId: fixture.organization.id, priority: "medium",
      firstResponseHours: 1, resolutionHours: 8, businessHoursOnly: true, isDefault: true,
      createdAt: date(0),
    } })
    await tx.company.create({ data: {
      ...fixture.company, organizationId: fixture.organization.id, industry: "Software testing",
      status: "active", category: "client", slaPolicyId: fixture.sla.id,
      createdAt: date(0), updatedAt: date(0),
    } })
    await tx.ticket.createMany({ data: Array.from({ length: fixture.ticketCount }, (_, index) => ({
      id: historicalTicketIdentity(fixture, index).id,
      organizationId: fixture.organization.id, ticketNumber: historicalTicketIdentity(fixture, index).number,
      subject: historicalTicketIdentity(fixture, index).subject,
      description: "Synthetic historical layout measurement only", priority: index === 0 ? "critical" : "medium", status: "open",
      category: "general", companyId: fixture.company.id, assignedTo: fixture.admin.id, createdBy: fixture.admin.id,
      slaPolicyName: fixture.sla.name, slaFirstResponseDueAt: date(index === 0 ? -30 * 60 * 1000 : (index + 120) * 60 * 1000),
      slaDueAt: new Date(historicalTicketIdentity(fixture, index).dueAt),
      createdAt: date(-(index + 1) * 60 * 1000), updatedAt: date(-(index + 1) * 60 * 1000), source: "agent",
    })) })
    await tx.entitlement.create({ data: {
      ...fixture.entitlement, organizationId: fixture.organization.id, companyId: fixture.company.id,
      slaPolicyId: fixture.sla.id, validFrom: date(-7 * 86400000), validTo: date(365 * 86400000),
      notes: "Synthetic historical layout measurement only", createdBy: fixture.admin.id,
      createdAt: date(0), updatedAt: date(0),
    } })
    await tx.entitlementMilestoneDefinition.createMany({ data: [
      { id: "clhistmilestone00000000001", organizationId: fixture.organization.id, entitlementId: fixture.entitlement.id, type: "first_response", name: "First response", dueWithinSeconds: 3600, createdAt: date(0), updatedAt: date(0) },
      { id: "clhistmilestone00000000002", organizationId: fixture.organization.id, entitlementId: fixture.entitlement.id, type: "resolution", name: "Resolution", dueWithinSeconds: 28800, createdAt: date(0), updatedAt: date(0) },
    ] })
  }, { timeout: 30000 })
  if (await prisma.ticket.count({ where: { organizationId: fixture.organization.id, assignedTo: fixture.admin.id } }) !== fixture.ticketCount) throw new Error("TICKET_COHORT_MISMATCH")
}

async function main() {
  assertHistoricalSeedEnvironment(process.env)
  const fixture = historicalFixture(process.env.SUPPORT_HISTORICAL_ANCHOR)
  const url = new URL(process.env.DATABASE_URL)
  url.searchParams.set("connection_limit", "1")
  const { PrismaClient } = await import("@prisma/client")
  const prisma = new PrismaClient({ datasourceUrl: url.toString() })
  try {
    await prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', false)`
    await seedHistoricalLayout(prisma, fixture, process.env.SUPPORT_HISTORICAL_ADMIN_PASSWORD)
    await writeFile(".support-ux-historical-control/fixture.json", JSON.stringify(fixture) + "\n", { mode: 0o600 })
    console.log("Matched synthetic historical layout fixture created: 50 assigned tickets, one entitlement")
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Historical layout fixture failed; no database/config payload emitted"); process.exitCode = 1 })
}
