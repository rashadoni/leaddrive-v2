import bcrypt from "bcryptjs"
import { makeScriptPrisma } from "./_rls.mjs"
import { passwordPolicyError } from "./password-policy.mjs"

const REQUIRED_CONFIRMATION = "zeytun-phase1-closeout"
const confirmation = process.env.CONFIRM_PROD
const organizationSlug = process.env.PILOT_ORG_SLUG
const managerEmail = process.env.PILOT_MANAGER_EMAIL?.trim().toLowerCase()
const pilotPassword = process.env.PILOT_AGENT_PASSWORD
const runId = process.env.PILOT_RUN_ID?.trim() || new Date().toISOString().slice(0, 10).replaceAll("-", "")

if (confirmation !== REQUIRED_CONFIRMATION) {
  throw new Error(`Set CONFIRM_PROD=${REQUIRED_CONFIRMATION} to run this scoped production seed`)
}
if (!organizationSlug || !managerEmail || !pilotPassword) {
  throw new Error("PILOT_ORG_SLUG, PILOT_MANAGER_EMAIL, and a 16+ character PILOT_AGENT_PASSWORD are required")
}
const pilotPasswordError = passwordPolicyError(pilotPassword)
if (pilotPasswordError) {
  throw new Error(`PILOT_AGENT_PASSWORD rejected: ${pilotPasswordError}`)
}
if ([...pilotPassword].length < 16) {
  throw new Error("PILOT_AGENT_PASSWORD must contain at least 16 characters for this production fixture")
}

const prefix = `[PILOT-PHASE1-${runId}]`
const codePrefix = `P1-${runId}`.slice(0, 32)
const primaryEmail = `phase1.primary.${runId}@leaddrivecrm.org`
const participantEmail = `phase1.participant.${runId}@leaddrivecrm.org`
const prisma = await makeScriptPrisma()

function action(actionKey, mode, conditions = null) {
  return {
    actionKey,
    mode,
    minCount: 1,
    conditions,
    allowWaiver: false,
  }
}

async function ensureTeam(organizationId, code, name) {
  const existing = await prisma.mtmTeam.findFirst({ where: { organizationId, code } })
  return existing
    ? prisma.mtmTeam.update({ where: { id: existing.id }, data: { name, isActive: true } })
    : prisma.mtmTeam.create({ data: { organizationId, code, name, isActive: true } })
}

async function ensurePolicy({ organizationId, teamId, name, createdBy, actions }) {
  const existing = await prisma.mtmVisitPolicy.findFirst({
    where: { organizationId, name },
    select: { id: true },
  })
  if (existing) {
    return prisma.$transaction(async (tx) => {
      await tx.mtmVisitPolicyAction.deleteMany({ where: { policyId: existing.id } })
      return tx.mtmVisitPolicy.update({
        where: { id: existing.id },
        data: {
          teamId,
          visitType: "DEFAULT",
          priority: 10,
          effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
          effectiveTo: null,
          isActive: true,
          actions: {
            create: actions.map((item) => ({ organizationId, ...item })),
          },
        },
      })
    })
  }
  return prisma.mtmVisitPolicy.create({
    data: {
      organizationId,
      teamId,
      name,
      visitType: "DEFAULT",
      priority: 10,
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      isActive: true,
      createdBy,
      actions: {
        create: actions.map((item) => ({ organizationId, ...item })),
      },
    },
  })
}

try {
  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { id: true, slug: true },
  })
  if (!organization) throw new Error(`Organization ${organizationSlug} was not found`)

  const manager = await prisma.mtmAgent.findFirst({
    where: {
      organizationId: organization.id,
      role: "MANAGER",
      status: "ACTIVE",
      user: { email: managerEmail, isActive: true },
    },
    select: { id: true, userId: true, name: true },
  })
  if (!manager?.userId) throw new Error("A linked active MTM manager was not found")

  await Promise.all([
    prisma.mtmSetting.upsert({
      where: { organizationId_key: { organizationId: organization.id, key: "routeAssignmentsEnabled" } },
      update: { value: true },
      create: { organizationId: organization.id, key: "routeAssignmentsEnabled", value: true },
    }),
    prisma.mtmSetting.upsert({
      where: { organizationId_key: { organizationId: organization.id, key: "visitPoliciesEnabled" } },
      update: { value: true },
      create: { organizationId: organization.id, key: "visitPoliciesEnabled", value: true },
    }),
    prisma.mtmSetting.upsert({
      where: { organizationId_key: { organizationId: organization.id, key: "excelImportsEnabled" } },
      update: { value: true },
      create: { organizationId: organization.id, key: "excelImportsEnabled", value: true },
    }),
    prisma.mtmSetting.upsert({
      where: { organizationId_key: { organizationId: organization.id, key: "timezone" } },
      update: { value: "Asia/Baku" },
      create: { organizationId: organization.id, key: "timezone", value: "Asia/Baku" },
    }),
  ])

  const [medicalTeam, retailTeam] = await Promise.all([
    ensureTeam(organization.id, `${codePrefix}-MED`, `${prefix} Medical Representatives`),
    ensureTeam(organization.id, `${codePrefix}-RTL`, `${prefix} Retail Representatives`),
  ])
  const passwordHash = await bcrypt.hash(pilotPassword, 12)

  const primaryAgent = await prisma.mtmAgent.upsert({
    where: { organizationId_email: { organizationId: organization.id, email: primaryEmail } },
    update: {
      name: `${prefix} Primary Agent`,
      role: "AGENT",
      status: "ACTIVE",
      teamId: medicalTeam.id,
      managerId: manager.id,
      passwordHash,
    },
    create: {
      organizationId: organization.id,
      name: `${prefix} Primary Agent`,
      email: primaryEmail,
      role: "AGENT",
      status: "ACTIVE",
      teamId: medicalTeam.id,
      managerId: manager.id,
      passwordHash,
    },
  })
  const participantAgent = await prisma.mtmAgent.upsert({
    where: { organizationId_email: { organizationId: organization.id, email: participantEmail } },
    update: {
      name: `${prefix} Participant Agent`,
      role: "AGENT",
      status: "ACTIVE",
      teamId: retailTeam.id,
      managerId: manager.id,
      passwordHash,
    },
    create: {
      organizationId: organization.id,
      name: `${prefix} Participant Agent`,
      email: participantEmail,
      role: "AGENT",
      status: "ACTIVE",
      teamId: retailTeam.id,
      managerId: manager.id,
      passwordHash,
    },
  })

  const [doctor, pharmacy, market] = await Promise.all([
    prisma.mtmCustomer.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: `${codePrefix}-D01` } },
      update: { name: `${prefix} Doctor`, objectType: "DOCTOR", status: "ACTIVE", deletedAt: null },
      create: {
        organizationId: organization.id,
        code: `${codePrefix}-D01`,
        name: `${prefix} Doctor`,
        objectType: "DOCTOR",
        category: "A",
        status: "ACTIVE",
        address: "Nərimanov pilot address 1",
        city: "Bakı",
        district: "Nərimanov",
        latitude: 40.4021,
        longitude: 49.8724,
      },
    }),
    prisma.mtmCustomer.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: `${codePrefix}-P01` } },
      update: { name: `${prefix} Pharmacy`, objectType: "PHARMACY", status: "ACTIVE", deletedAt: null },
      create: {
        organizationId: organization.id,
        code: `${codePrefix}-P01`,
        name: `${prefix} Pharmacy`,
        objectType: "PHARMACY",
        category: "A",
        status: "ACTIVE",
        address: "Nəsimi pilot address 2",
        city: "Bakı",
        district: "Nəsimi",
        latitude: 40.3953,
        longitude: 49.8822,
      },
    }),
    prisma.mtmCustomer.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: `${codePrefix}-S01` } },
      update: { name: `${prefix} Store`, objectType: "STORE", status: "ACTIVE", deletedAt: null },
      create: {
        organizationId: organization.id,
        code: `${codePrefix}-S01`,
        name: `${prefix} Store`,
        objectType: "STORE",
        category: "B",
        status: "ACTIVE",
        address: "Xətai pilot address 3",
        city: "Bakı",
        district: "Xətai",
        latitude: 40.3882,
        longitude: 49.875,
      },
    }),
  ])

  const [medicalPolicy, retailPolicy] = await Promise.all([
    ensurePolicy({
      organizationId: organization.id,
      teamId: medicalTeam.id,
      name: `${prefix} Medical Policy`,
      createdBy: manager.userId,
      actions: [
        action("PRESENTATION", "REQUIRED"),
        action("NEXT_ACTION", "REQUIRED", { objectTypes: ["DOCTOR"] }),
        action("PHOTO", "OPTIONAL"),
        action("STOCK_CHECK", "OPTIONAL"),
      ],
    }),
    ensurePolicy({
      organizationId: organization.id,
      teamId: retailTeam.id,
      name: `${prefix} Retail Policy`,
      createdBy: manager.userId,
      actions: [
        action("PRESENTATION", "HIDDEN"),
        action("STOCK_CHECK", "REQUIRED"),
        action("PHOTO", "OPTIONAL"),
        action("NEXT_ACTION", "OPTIONAL"),
      ],
    }),
  ])

  console.log(JSON.stringify({
    runId,
    prefix,
    organization: { id: organization.id, slug: organization.slug },
    manager: { id: manager.id, userId: manager.userId },
    agents: {
      primary: { id: primaryAgent.id, email: primaryAgent.email, teamId: medicalTeam.id },
      participant: { id: participantAgent.id, email: participantAgent.email, teamId: retailTeam.id },
    },
    customers: { doctor: doctor.id, pharmacy: pharmacy.id, market: market.id },
    policies: { medical: medicalPolicy.id, retail: retailPolicy.id },
  }, null, 2))
} finally {
  await prisma.$disconnect()
}
