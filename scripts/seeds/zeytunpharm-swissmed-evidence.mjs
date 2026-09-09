import bcrypt from "bcryptjs"
import { createHash } from "node:crypto"
// Every standalone script opens the database through this one helper. It is not
// ceremony: the helper pins connection_limit=1 because the RLS setting below is
// per-connection, and a pool would apply it to one connection and run the
// queries on another. Doing it by hand here worked and still broke the gate
// that keeps the method from drifting — which is the gate doing its job.
import { makeScriptPrisma } from "../_rls.mjs"
import { passwordPolicyError } from "../password-policy.mjs"

const QA_MARKER = "[QA-SWISSMED]"
const ROUTE_GUIDE_INLINE_CODE = "QA-SWM-UNASSIGNED-CLINIC"
const TENANT_TIME_ZONE = "Asia/Baku"
const ALLOWED_TENANTS = {
  leaddrive: {
    confirmation: "leaddrive-swissmed-evidence",
    adminEmail: "qa.swissmed.admin@leaddrivecrm.org",
    agentEmail: "qa.swissmed.agent@leaddrivecrm.org",
  },
  zeytun: {
    confirmation: "zeytunpharm-swissmed-evidence",
    adminEmail: "qa.swissmed.admin@zeytunpharm.leaddrivecrm.org",
    agentEmail: "qa.swissmed.agent@zeytunpharm.leaddrivecrm.org",
  },
}
const organizationSlug = process.env.MTM_EVIDENCE_ORG_SLUG || "leaddrive"
const adminEmail = (process.env.MTM_EVIDENCE_ADMIN_EMAIL || "").trim().toLowerCase()
const agentEmail = (process.env.MTM_EVIDENCE_AGENT_EMAIL || "").trim().toLowerCase()
const password = process.env.MTM_EVIDENCE_PASSWORD || ""
const target = Object.hasOwn(ALLOWED_TENANTS, organizationSlug)
  ? ALLOWED_TENANTS[organizationSlug]
  : null

if (!target) {
  throw new Error(`This seed is restricted to explicitly allowlisted SwissMed evidence tenants: ${Object.keys(ALLOWED_TENANTS).join(", ")}`)
}
if (process.env.CONFIRM_PROD !== target.confirmation) {
  throw new Error(`Set CONFIRM_PROD=${target.confirmation} to run this scoped production seed for ${organizationSlug}`)
}
if (adminEmail !== target.adminEmail || agentEmail !== target.agentEmail) {
  throw new Error(`Use the dedicated ${target.adminEmail} and ${target.agentEmail} principals for ${organizationSlug}`)
}
const passwordError = passwordPolicyError(password)
if (passwordError) {
  throw new Error(`MTM_EVIDENCE_PASSWORD rejected: ${passwordError}`)
}
if ([...password].length < 24) {
  throw new Error("MTM_EVIDENCE_PASSWORD must contain at least 24 characters for this production fixture")
}

// Cross-tenant by classification: this seed writes for one named tenant but
// resolves it by slug, so it runs with the bypass rather than a tenant context.
const prisma = await makeScriptPrisma()

function tenantCalendarDate(value) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TENANT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value).map((part) => [part.type, part.value]),
  )
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)))
}

const today = tenantCalendarDate(new Date())
const tomorrow = new Date(today)
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
const guideDate = new Date(tomorrow)
while (guideDate.getUTCDay() === 0 || guideDate.getUTCDay() === 6) {
  guideDate.setUTCDate(guideDate.getUTCDate() + 1)
}
const historyDate = new Date(today)
historyDate.setUTCDate(historyDate.getUTCDate() - 1)

function at(date, hour, minute = 0) {
  const calendarDate = date.toISOString().slice(0, 10)
  return new Date(`${calendarDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+04:00`)
}

function canonicalValue(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    )
  }
  return value
}

function promotionHash(value) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex")
}

async function ensureAssignment(model, where, data) {
  const existing = await model.findFirst({ where })
  if (existing) {
    return model.update({ where: { id: existing.id }, data: { ...data, deletedAt: null, effectiveTo: null } })
  }
  return model.create({ data })
}

try {
  const organization = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
    select: { id: true, slug: true, name: true, isActive: true },
  })
  if (!organization?.isActive) throw new Error(`The active ${organizationSlug} tenant was not found`)

  const passwordHash = await bcrypt.hash(password, 12)
  const passwordChangedAt = new Date()
  const adminUser = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: organization.id, email: adminEmail } },
    update: { name: `${QA_MARKER} Acceptance Admin`, role: "admin", isActive: true, passwordHash, passwordChangedAt, resetToken: null, resetTokenExp: null },
    create: { organizationId: organization.id, email: adminEmail, name: `${QA_MARKER} Acceptance Admin`, role: "admin", isActive: true, passwordHash, passwordChangedAt },
  })
  const agentUser = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: organization.id, email: agentEmail } },
    update: { name: `${QA_MARKER} Field Agent`, role: "sales", isActive: true, passwordHash, passwordChangedAt, resetToken: null, resetTokenExp: null },
    create: { organizationId: organization.id, email: agentEmail, name: `${QA_MARKER} Field Agent`, role: "sales", isActive: true, passwordHash, passwordChangedAt },
  })

  const manager = await prisma.mtmAgent.upsert({
    where: { organizationId_email: { organizationId: organization.id, email: adminEmail } },
    update: { userId: adminUser.id, name: `${QA_MARKER} Acceptance Admin`, role: "MANAGER", status: "ACTIVE", passwordHash, isOnline: true, lastSeenAt: new Date() },
    create: { organizationId: organization.id, userId: adminUser.id, email: adminEmail, name: `${QA_MARKER} Acceptance Admin`, role: "MANAGER", status: "ACTIVE", passwordHash, isOnline: true, lastSeenAt: new Date() },
  })
  const fieldAgent = await prisma.mtmAgent.upsert({
    where: { organizationId_email: { organizationId: organization.id, email: agentEmail } },
    update: { userId: agentUser.id, managerId: manager.id, name: `${QA_MARKER} Field Agent`, role: "AGENT", status: "ACTIVE", passwordHash, isOnline: true, lastSeenAt: new Date() },
    create: { organizationId: organization.id, userId: agentUser.id, managerId: manager.id, email: agentEmail, name: `${QA_MARKER} Field Agent`, role: "AGENT", status: "ACTIVE", passwordHash, isOnline: true, lastSeenAt: new Date() },
  })

  const customers = []
  const customerSeeds = [
    { code: "QA-SWM-PHARMACY", name: `${QA_MARKER} Central Pharmacy`, objectType: "PHARMACY", category: "A", address: "Nizami küçəsi 76", region: "Baku", administrativeDistrict: "Nəsimi", locality: "Bakı", cityDistrict: "Nəsimi", specialization: "Pharmacy", organizationKind: "Pharmacy", territoryCode: "QA-BAKU-01", latitude: 40.3712, longitude: 49.8421 },
    { code: "QA-SWM-CLINIC", name: `${QA_MARKER} Medical Clinic`, objectType: "CLINIC", category: "A", address: "Həsən bəy Zərdabi 88", region: "Baku", administrativeDistrict: "Yasamal", locality: "Bakı", cityDistrict: "Yasamal", specialization: "Clinic", organizationKind: "Private clinic", territoryCode: "QA-BAKU-01", latitude: 40.3925, longitude: 49.8225 },
    { code: "QA-SWM-HOSPITAL", name: `${QA_MARKER} City Hospital`, objectType: "OTHER", category: "B", address: "Babək prospekti 17", region: "Baku", administrativeDistrict: "Xətai", locality: "Bakı", cityDistrict: "Xətai", specialization: "Hospital", organizationKind: "Adult hospital", territoryCode: "QA-BAKU-02", latitude: 40.3835, longitude: 49.9133 },
    { code: ROUTE_GUIDE_INLINE_CODE, name: `${QA_MARKER} Unassigned Clinic`, objectType: "CLINIC", category: "B", address: "Tbilisi prospekti 31", region: "Baku", administrativeDistrict: "Yasamal", locality: "Bakı", cityDistrict: "Yasamal", specialization: "Clinic", organizationKind: "Private clinic", territoryCode: "QA-BAKU-01", latitude: 40.3912, longitude: 49.8074 },
  ]
  for (const seed of customerSeeds) {
    customers.push(await prisma.mtmCustomer.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: seed.code } },
      update: { ...seed, status: "ACTIVE", deletedAt: null, managingManagerId: manager.id },
      create: { organizationId: organization.id, ...seed, status: "ACTIVE", managingManagerId: manager.id },
    }))
  }

  const contacts = []
  const contactSeeds = [
    { externalCode: "QA-SWM-DOCTOR-01", firstName: "Aysel", lastName: "Məmmədova", displayName: `${QA_MARKER} Dr Aysel Məmmədova`, type: "DOCTOR", specialtyCode: "PED", specialtyName: "Pediatrician", qualificationCategory: "A2", profile: "Medical opinion leader", category: "A", phone: "+994505550101", whatsappPhone: "+994505550101", verificationStatus: "VERIFIED", consentStatus: "GRANTED", workplace: customers[1], jobTitle: "Doctor", department: "Pediatrics" },
    { externalCode: "QA-SWM-PHARMACIST-01", firstName: "Nigar", lastName: "Hüseynova", displayName: `${QA_MARKER} Pharmacist Nigar Hüseynova`, type: "PHARMACIST", specialtyCode: "PHARM", specialtyName: "Pharmacist", qualificationCategory: "B1", profile: "Pharmacy contact", category: "B", phone: "+994505550102", whatsappPhone: "+994505550102", verificationStatus: "VERIFIED", consentStatus: "GRANTED", workplace: customers[0], jobTitle: "Pharmacist", department: "Sales floor" },
  ]
  for (const seed of contactSeeds) {
    const { workplace, jobTitle, department, ...contactData } = seed
    const contact = await prisma.mtmContact.upsert({
      where: { organizationId_externalCode: { organizationId: organization.id, externalCode: seed.externalCode } },
      update: { ...contactData, status: "ACTIVE", deletedAt: null, source: "QA_SWISSMED" },
      create: { organizationId: organization.id, ...contactData, status: "ACTIVE", source: "QA_SWISSMED" },
    })
    contacts.push(contact)
    const existingWorkplace = await prisma.mtmContactWorkplace.findFirst({ where: { organizationId: organization.id, contactId: contact.id, customerId: workplace.id, endedOn: null, deletedAt: null } })
    if (existingWorkplace) {
      await prisma.mtmContactWorkplace.update({ where: { id: existingWorkplace.id }, data: { jobTitle, department, isPrimary: true, source: "QA_SWISSMED" } })
    } else {
      await prisma.mtmContactWorkplace.create({ data: { organizationId: organization.id, contactId: contact.id, customerId: workplace.id, jobTitle, department, isPrimary: true, startedOn: today, source: "QA_SWISSMED", createdBy: adminUser.id } })
    }
  }

  const routeGuideInlineCustomer = customers.find((customer) => customer.code === ROUTE_GUIDE_INLINE_CODE)
  if (!routeGuideInlineCustomer?.name.includes(QA_MARKER)) {
    throw new Error("The dedicated QA-only route-guide inline assignment customer was not created")
  }
  const assignedCustomers = customers.filter((customer) => customer.id !== routeGuideInlineCustomer.id)

  for (const customer of assignedCustomers) {
    await ensureAssignment(prisma.mtmCustomerAgentAssignment, { organizationId: organization.id, customerId: customer.id, agentId: fieldAgent.id, role: "PRIMARY", effectiveTo: null, deletedAt: null }, { organizationId: organization.id, customerId: customer.id, agentId: fieldAgent.id, role: "PRIMARY", effectiveFrom: today, source: "QA_SWISSMED", assignedBy: adminUser.id, reason: "SwissMed visual acceptance fixture" })
  }
  // This one QA-only organization must begin unassigned so the route guide can
  // prove the inline "find, assign and add" recovery without leaving the draft.
  await prisma.mtmCustomerAgentAssignment.deleteMany({
    where: {
      organizationId: organization.id,
      customerId: routeGuideInlineCustomer.id,
    },
  })
  for (const contact of contacts) {
    await ensureAssignment(prisma.mtmContactAgentAssignment, { organizationId: organization.id, contactId: contact.id, agentId: fieldAgent.id, role: "PRIMARY", effectiveTo: null, deletedAt: null }, { organizationId: organization.id, contactId: contact.id, agentId: fieldAgent.id, role: "PRIMARY", effectiveFrom: today, source: "QA_SWISSMED", assignedBy: adminUser.id, reason: "SwissMed visual acceptance fixture" })
  }

  const route = await prisma.mtmRoute.upsert({
    where: { organizationId_externalId: { organizationId: organization.id, externalId: "QA-SWM-ROUTE-TODAY" } },
    update: { agentId: fieldAgent.id, date: today, name: `${QA_MARKER} Today route`, status: "IN_PROGRESS", totalPoints: assignedCustomers.length, visitedPoints: 1, startedAt: at(today, 8, 45), deletedAt: null },
    create: { organizationId: organization.id, agentId: fieldAgent.id, externalId: "QA-SWM-ROUTE-TODAY", date: today, name: `${QA_MARKER} Today route`, status: "IN_PROGRESS", totalPoints: assignedCustomers.length, visitedPoints: 1, startedAt: at(today, 8, 45), notes: "SwissMed visual acceptance fixture" },
  })

  const routePoints = []
  for (let index = 0; index < assignedCustomers.length; index += 1) {
    const customer = assignedCustomers[index]
    const existing = await prisma.mtmRoutePoint.findFirst({ where: { organizationId: organization.id, routeId: route.id, customerId: customer.id, deletedAt: null } })
    const data = { organizationId: organization.id, routeId: route.id, customerId: customer.id, contactId: contacts[index % contacts.length].id, orderIndex: index + 1, status: index === 0 ? "VISITED" : "PENDING", plannedTime: at(today, 9 + index, 15), visitedAt: index === 0 ? at(today, 9, 30) : null, notes: "SwissMed visual acceptance fixture" }
    routePoints.push(existing ? await prisma.mtmRoutePoint.update({ where: { id: existing.id }, data }) : await prisma.mtmRoutePoint.create({ data }))
  }

  // A separate DRAFT is deliberately kept for the detailed Routes help
  // video. A presenter may publish it during capture; the confirmed fixture
  // refresh resets it to this exact safe draft rather than changing any
  // customer-owned route.
  const guideRoute = await prisma.mtmRoute.upsert({
    where: { organizationId_externalId: { organizationId: organization.id, externalId: "QA-SWM-ROUTE-GUIDE-DRAFT" } },
    update: {
      agentId: fieldAgent.id,
      date: guideDate,
      name: `${QA_MARKER} Video guide draft`,
      status: "DRAFT",
      totalPoints: 2,
      visitedPoints: 0,
      startedAt: null,
      completedAt: null,
      publishedAt: null,
      publishedBy: null,
      publishedVersion: null,
      notes: "SwissMed Routes video guide fixture",
      deletedAt: null,
    },
    create: {
      organizationId: organization.id,
      agentId: fieldAgent.id,
      externalId: "QA-SWM-ROUTE-GUIDE-DRAFT",
      date: guideDate,
      name: `${QA_MARKER} Video guide draft`,
      status: "DRAFT",
      totalPoints: 2,
      visitedPoints: 0,
      notes: "SwissMed Routes video guide fixture",
    },
  })
  const guideRoutePointSeeds = [
    { customer: customers[1], contact: contacts[0], orderIndex: 1, plannedTime: at(guideDate, 10, 0) },
    { customer: customers[0], contact: contacts[1], orderIndex: 2, plannedTime: at(guideDate, 11, 0) },
  ]
  const guideRoutePoints = []
  for (const point of guideRoutePointSeeds) {
    const existing = await prisma.mtmRoutePoint.findFirst({
      where: {
        organizationId: organization.id,
        routeId: guideRoute.id,
        customerId: point.customer.id,
        contactId: point.contact.id,
        deletedAt: null,
      },
    })
    const data = {
      organizationId: organization.id,
      routeId: guideRoute.id,
      customerId: point.customer.id,
      contactId: point.contact.id,
      orderIndex: point.orderIndex,
      status: "PENDING",
      plannedTime: point.plannedTime,
      visitedAt: null,
      notes: "SwissMed Routes video guide fixture",
      deletedAt: null,
    }
    guideRoutePoints.push(existing
      ? await prisma.mtmRoutePoint.update({ where: { id: existing.id }, data })
      : await prisma.mtmRoutePoint.create({ data }))
  }
  await prisma.mtmRoutePoint.updateMany({
    where: {
      organizationId: organization.id,
      routeId: guideRoute.id,
      deletedAt: null,
      id: { notIn: guideRoutePoints.map((point) => point.id) },
    },
    data: { deletedAt: new Date() },
  })

  const completedVisit = await prisma.mtmVisit.findFirst({ where: { organizationId: organization.id, routePointId: routePoints[0].id, deletedAt: null } })
  const visitData = { organizationId: organization.id, agentId: fieldAgent.id, customerId: customers[0].id, contactId: contacts[1].id, routeId: route.id, routePointId: routePoints[0].id, status: "CHECKED_OUT", checkInAt: at(today, 9, 28), checkOutAt: at(today, 9, 52), checkInLat: 40.3713, checkInLng: 49.8422, checkOutLat: 40.3712, checkOutLng: 49.8421, duration: 24, notes: "SwissMed visual acceptance fixture", outcome: "SUCCESSFUL", potential: "HIGH", tasksCompleted: 1, tasksTotal: 1, deletedAt: null }
  const visit = completedVisit ? await prisma.mtmVisit.update({ where: { id: completedVisit.id }, data: visitData }) : await prisma.mtmVisit.create({ data: visitData })

  const existingTask = await prisma.mtmTask.findFirst({ where: { organizationId: organization.id, sourceKey: "QA-SWM-TASK-01" } })
  const taskData = { organizationId: organization.id, agentId: fieldAgent.id, customerId: customers[1].id, visitId: visit.id, sourceKey: "QA-SWM-TASK-01", title: `${QA_MARKER} Confirm next doctor visit`, description: "SwissMed visual acceptance fixture", status: "IN_PROGRESS", priority: "HIGH", scheduledStartAt: at(today, 14), dueDate: tomorrow, progress: 40, recurrenceRule: "WEEKLY", recurrenceInterval: 1, recurrenceUntil: new Date(today.getTime() + 28 * 86400000), recurrenceTimezone: "Asia/Baku", deletedAt: null }
  const task = existingTask ? await prisma.mtmTask.update({ where: { id: existingTask.id }, data: taskData }) : await prisma.mtmTask.create({ data: taskData })

  // SWM-09 acceptance requires one real, reviewable execution. Keep every
  // definition and row under QA-only codes, and make refresh idempotent so the
  // production evidence workflow never needs to touch customer business rows.
  const promotionObservedAt = new Date()
  const campaignStartsOn = new Date("2026-01-01T00:00:00.000Z")
  const campaignEndsOn = new Date("2099-12-31T00:00:00.000Z")
  const formulaDefinition = {
    schemaVersion: 1,
    kind: "LINEAR_V1",
    factPointsPerUnit: "1",
    rewardPointsPerUnit: "0.5",
    scale: 4,
    rounding: "HALF_UP",
    // Keep the acceptance row usable for a full test day after a confirmed
    // refresh while still proving that stale imported facts fail closed.
    sourceFreshnessMinutes: 1_440,
  }
  const approvalPolicyDefinition = {
    schemaVersion: 1,
    levels: ["L1", "L2"],
    l1Roles: ["MANAGER", "SUPERVISOR", "ADMIN"],
    l2Roles: ["MANAGER", "ADMIN"],
    preventSelfApproval: true,
    requireDistinctReviewers: true,
    reasonRequiredFor: ["REJECTED", "RETURNED"],
  }
  const eligibilityDefinition = {
    schemaVersion: 1,
    customerObjectTypes: ["PHARMACY"],
    requireActiveCustomer: true,
    requireCompletedVisit: true,
    minimumEvidenceCount: 0,
  }
  const formulaDefinitionHash = promotionHash(formulaDefinition)
  const approvalPolicyDefinitionHash = promotionHash(approvalPolicyDefinition)
  const eligibilityDefinitionHash = promotionHash(eligibilityDefinition)
  const formula = await prisma.mtmPharmacyPointsFormula.upsert({
    where: { organizationId_code_version: { organizationId: organization.id, code: "QA-SWM-FORMULA", version: 1 } },
    update: {},
    create: {
      organizationId: organization.id, code: "QA-SWM-FORMULA", version: 1,
      nameRu: `${QA_MARKER} Линейные баллы`, nameAz: `${QA_MARKER} Xətti xallar`, nameEn: `${QA_MARKER} Linear points`,
      schemaVersion: 1, definition: formulaDefinition, definitionHash: formulaDefinitionHash,
      approvalReference: "QA-SWM-FORMULA-APPROVAL", sourceSystem: "QA_SWISSMED", sourceReference: "SWM-09",
      sourceObservedAt: promotionObservedAt, sourceReceivedAt: promotionObservedAt, status: "ACTIVE",
      createdByUserId: adminUser.id, signedByUserId: adminUser.id, signedAt: promotionObservedAt, activatedAt: promotionObservedAt,
    },
  })
  const approvalPolicy = await prisma.mtmPharmacyApprovalPolicy.upsert({
    where: { organizationId_code_version: { organizationId: organization.id, code: "QA-SWM-APPROVAL", version: 1 } },
    update: {},
    create: {
      organizationId: organization.id, code: "QA-SWM-APPROVAL", version: 1,
      name: `${QA_MARKER} L1/L2 manager review`, l1Roles: approvalPolicyDefinition.l1Roles,
      l2Roles: approvalPolicyDefinition.l2Roles, l1Scope: { kind: "CURRENT_ACTOR_SCOPE" },
      l2Scope: { kind: "CURRENT_ACTOR_SCOPE" }, definition: approvalPolicyDefinition,
      allowSelfApproval: false, requireDistinctReviewers: true, requireRejectReason: true, requireReturnReason: true,
      definitionHash: approvalPolicyDefinitionHash, approvalReference: "QA-SWM-POLICY-APPROVAL",
      sourceSystem: "QA_SWISSMED", sourceReference: "SWM-09", sourceObservedAt: promotionObservedAt,
      sourceReceivedAt: promotionObservedAt, status: "ACTIVE", createdByUserId: adminUser.id,
      signedByUserId: adminUser.id, signedAt: promotionObservedAt, activatedAt: promotionObservedAt,
    },
  })
  const promotionType = await prisma.mtmPharmacyPromotionType.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: "QA_SWM_SELL_OUT" } },
    update: { nameRu: `${QA_MARKER} Продажа`, nameAz: `${QA_MARKER} Satış`, nameEn: `${QA_MARKER} Sell-out`, status: "ACTIVE" },
    create: { organizationId: organization.id, code: "QA_SWM_SELL_OUT", nameRu: `${QA_MARKER} Продажа`, nameAz: `${QA_MARKER} Satış`, nameEn: `${QA_MARKER} Sell-out`, status: "ACTIVE" },
  })
  const promotion = await prisma.mtmPharmacyPromotion.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: "QA-SWM-PROMO" } },
    update: { archivedAt: null },
    create: { organizationId: organization.id, code: "QA-SWM-PROMO", createdByUserId: adminUser.id },
  })
  const versionDefinition = {
    schemaVersion: 1,
    promotionId: promotion.id,
    revision: 1,
    type: { id: promotionType.id, code: promotionType.code },
    copy: {
      ru: { name: `${QA_MARKER} Аптечная акция`, description: "Проверка менеджером" },
      az: { name: `${QA_MARKER} Aptek promosiyası`, description: "Menecer yoxlaması" },
      en: { name: `${QA_MARKER} Pharmacy promotion`, description: "Manager review" },
    },
    period: { startsOn: campaignStartsOn.toISOString().slice(0, 10), endsOn: campaignEndsOn.toISOString().slice(0, 10), timezone: TENANT_TIME_ZONE },
    formula: { id: formula.id, version: formula.version, definitionHash: formula.definitionHash },
    approvalPolicy: { id: approvalPolicy.id, version: approvalPolicy.version, definitionHash: approvalPolicy.definitionHash },
    eligibility: { definition: eligibilityDefinition, definitionHash: eligibilityDefinitionHash },
    source: { system: "QA_SWISSMED", reference: "SWM-09", observedAt: promotionObservedAt.toISOString() },
  }
  const promotionVersion = await prisma.mtmPharmacyPromotionVersion.upsert({
    where: { organizationId_promotionId_revision: { organizationId: organization.id, promotionId: promotion.id, revision: 1 } },
    update: {},
    create: {
      organizationId: organization.id, promotionId: promotion.id, revision: 1, typeId: promotionType.id,
      nameRu: versionDefinition.copy.ru.name, nameAz: versionDefinition.copy.az.name, nameEn: versionDefinition.copy.en.name,
      descriptionRu: versionDefinition.copy.ru.description, descriptionAz: versionDefinition.copy.az.description,
      descriptionEn: versionDefinition.copy.en.description, startsOn: campaignStartsOn, endsOn: campaignEndsOn,
      timezone: TENANT_TIME_ZONE, formulaId: formula.id, approvalPolicyId: approvalPolicy.id,
      eligibilityDefinition, eligibilityDefinitionHash, definitionHash: promotionHash(versionDefinition),
      approvalReference: "QA-SWM-VERSION-APPROVAL", eligibilityApprovalReference: "QA-SWM-ELIGIBILITY-APPROVAL",
      eligibilityApprovedByUserId: adminUser.id, eligibilityApprovedAt: promotionObservedAt,
      sourceSystem: "QA_SWISSMED", sourceReference: "SWM-09", sourceObservedAt: promotionObservedAt,
      sourceReceivedAt: promotionObservedAt, status: "PUBLISHED", createdByUserId: adminUser.id,
      publishedByUserId: adminUser.id, publishedAt: promotionObservedAt,
    },
  })
  const promotionTarget = await prisma.mtmPharmacyPromotionTarget.upsert({
    where: { organizationId_promotionVersionId_customerId_assignedAgentId: { organizationId: organization.id, promotionVersionId: promotionVersion.id, customerId: customers[0].id, assignedAgentId: fieldAgent.id } },
    update: {},
    create: {
      organizationId: organization.id, promotionVersionId: promotionVersion.id, customerId: customers[0].id,
      contactId: contacts[1].id, assignedAgentId: fieldAgent.id, managingManagerId: manager.id,
      planQuantity: "12", unit: "packs", status: "CONNECTED", eligibilityStatus: "ELIGIBLE",
      eligibilitySnapshot: { schemaVersion: 1, evaluatedAt: promotionObservedAt.toISOString(), eligibilityDefinitionHash, status: "ELIGIBLE", reasons: [] },
      customerCodeSnapshot: customers[0].code, customerNameSnapshot: customers[0].name,
      customerAddressSnapshot: customers[0].address, agentNameSnapshot: fieldAgent.name,
      managerNameSnapshot: manager.name, sourceSystem: "QA_SWISSMED", sourceReference: "SWM-09",
      sourceObservedAt: promotionObservedAt, sourceReceivedAt: promotionObservedAt,
      connectedAt: promotionObservedAt, createdByUserId: adminUser.id,
    },
  })
  if (promotionTarget.status !== "CONNECTED" || promotionTarget.eligibilityStatus !== "ELIGIBLE") {
    throw new Error(`FATAL: QA SwissMed promotion target is not executable (${promotionTarget.status}/${promotionTarget.eligibilityStatus})`)
  }
  const calculationInput = {
    targetId: promotionTarget.id, promotionVersionId: promotionVersion.id, planQuantity: "12",
    factQuantity: "10", unit: "packs", formulaId: formula.id, formulaVersion: formula.version,
    formulaHash: formula.definitionHash, sourceObservedAt: promotionObservedAt.toISOString(),
  }
  const calculationHashInput = { definitionHash: formula.definitionHash, factQuantity: "10" }
  const calculationOutputCore = { factPoints: "10.0000", rewardPoints: "5.0000", difference: "5.0000" }
  const calculationOutput = {
    status: "CALCULATED", factQuantity: "10", ...calculationOutputCore,
    inputHash: promotionHash(calculationHashInput),
    calculationHash: promotionHash({ input: calculationHashInput, output: calculationOutputCore }),
  }
  let execution = await prisma.mtmPharmacyPromotionExecution.upsert({
    where: { organizationId_agentId_clientExecutionId: { organizationId: organization.id, agentId: fieldAgent.id, clientExecutionId: "QA-SWM-EXECUTION-REVIEW-01" } },
    update: {},
    create: {
      organizationId: organization.id, targetId: promotionTarget.id, visitId: visit.id, agentId: fieldAgent.id,
      clientExecutionId: "QA-SWM-EXECUTION-REVIEW-01", requestHash: promotionHash({ fixture: "QA-SWM-EXECUTION-REVIEW-01" }),
      planQuantitySnapshot: "12", actualQuantity: "10", unit: "packs", formulaId: formula.id,
      formulaVersion: formula.version, formulaHash: formula.definitionHash, approvalPolicyId: approvalPolicy.id,
      approvalPolicyVersion: approvalPolicy.version, approvalPolicyHash: approvalPolicy.definitionHash,
      calculationInput, calculationOutput, factPointsPreview: "10.0000", rewardPointsPreview: "5.0000",
      differencePointsPreview: "5.0000", sourceSystem: "QA_SWISSMED", sourceReference: "SWM-09",
      sourceObservedAt: promotionObservedAt, sourceReceivedAt: promotionObservedAt,
      status: "DRAFT", l1State: "NOT_READY", l2State: "NOT_READY", version: 1,
    },
  })
  if (execution.status === "DRAFT") {
    execution = await prisma.mtmPharmacyPromotionExecution.update({
      where: { organizationId_id: { organizationId: organization.id, id: execution.id } },
      data: {
        targetId: promotionTarget.id, visitId: visit.id, submittedByAgentId: fieldAgent.id,
        submittedByUserId: agentUser.id, requestHash: promotionHash({ fixture: "QA-SWM-EXECUTION-REVIEW-01" }),
        planQuantitySnapshot: "12", actualQuantity: "10", unit: "packs", formulaId: formula.id,
        formulaVersion: formula.version, formulaHash: formula.definitionHash, approvalPolicyId: approvalPolicy.id,
        approvalPolicyVersion: approvalPolicy.version, approvalPolicyHash: approvalPolicy.definitionHash,
        calculationInput, calculationOutput, factPointsPreview: "10.0000", rewardPointsPreview: "5.0000",
        differencePointsPreview: "5.0000", sourceSystem: "QA_SWISSMED", sourceReference: "SWM-09",
        sourceObservedAt: promotionObservedAt, sourceReceivedAt: promotionObservedAt,
        status: "READY", l1State: "READY", l2State: "NOT_READY", version: execution.version + 1,
        submittedAt: promotionObservedAt, readyAt: promotionObservedAt, closedAt: null,
      },
    })
  }
  if (execution.status !== "READY" || execution.l1State !== "READY" || execution.l2State !== "NOT_READY") {
    throw new Error(`FATAL: QA SwissMed promotion execution is not reviewable (${execution.status}/${execution.l1State}/${execution.l2State})`)
  }
  await prisma.mtmSetting.upsert({
    where: { organizationId_key: { organizationId: organization.id, key: "pharmacyPromotionPostingEnabled" } },
    update: { value: true, description: "Enabled for the explicitly confirmed SwissMed SWM-09 acceptance workflow" },
    create: { organizationId: organization.id, key: "pharmacyPromotionPostingEnabled", value: true, description: "Enabled for the explicitly confirmed SwissMed SWM-09 acceptance workflow" },
  })
  await prisma.mtmPharmacyPromotionEvent.upsert({
    where: { organizationId_sourceKey: { organizationId: organization.id, sourceKey: "qa-swissmed:swm-09:fixture-ready" } },
    update: {},
    create: {
      organizationId: organization.id, targetId: promotionTarget.id, executionId: execution.id,
      eventType: "EXECUTION_SUBMITTED",
      toState: "READY", actorAgentId: manager.id, actorUserId: adminUser.id,
      sourceKey: "qa-swissmed:swm-09:fixture-ready",
      requestHash: promotionHash({ promotionVersionHash: promotionVersion.definitionHash, executionId: execution.id }),
      payload: { marker: QA_MARKER, scenario: "SWM-09", postingEnabled: true },
    },
  })

  const locationSeeds = [
    { id: "QA-SWM-LOC-01", latitude: 40.3924, longitude: 49.8224, recordedAt: at(historyDate, 9, 0) },
    { id: "QA-SWM-LOC-02", latitude: 40.3837, longitude: 49.8745, recordedAt: at(historyDate, 9, 20) },
    { id: "QA-SWM-LOC-03", latitude: 40.3713, longitude: 49.8422, recordedAt: at(historyDate, 9, 40) },
    { id: "QA-SWM-LIVE-01", latitude: 40.3798, longitude: 49.8499, recordedAt: new Date() },
  ]
  for (const location of locationSeeds) {
    await prisma.mtmAgentLocation.upsert({
      where: { organizationId_agentId_clientLocationId: { organizationId: organization.id, agentId: fieldAgent.id, clientLocationId: location.id } },
      update: { latitude: location.latitude, longitude: location.longitude, accuracy: 12, battery: 78, isMoving: location.id !== "QA-SWM-LOC-03", recordedAt: location.recordedAt },
      create: { organizationId: organization.id, agentId: fieldAgent.id, clientLocationId: location.id, latitude: location.latitude, longitude: location.longitude, accuracy: 12, battery: 78, isMoving: location.id !== "QA-SWM-LOC-03", recordedAt: location.recordedAt },
    })
  }

  console.log(JSON.stringify({ organization: { id: organization.id, slug: organization.slug, name: organization.name }, principals: { adminEmail, agentEmail }, counts: { users: 2, agents: 2, customers: customers.length, contacts: contacts.length, routes: 2, routePoints: routePoints.length + guideRoutePoints.length, visits: 1, tasks: 1, promotionExecutions: 1, locations: locationSeeds.length }, ids: { managerId: manager.id, agentId: fieldAgent.id, routeId: route.id, guideRouteId: guideRoute.id, visitId: visit.id, taskId: task.id, promotionExecutionId: execution.id } }))
} finally {
  await prisma.$disconnect()
}
