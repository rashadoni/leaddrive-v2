import { z } from "zod"
import { GovernedDoctorScoringDefinitionSchema } from "@/lib/mtm/professional-glossary"

// Reusable primitives
const optionalString = z.string().trim().min(1).max(500).optional().nullable()
const longString = z.string().max(2000).optional().nullable()
// Coerce string-encoded numbers (common from form encoding / legacy clients) before range check.
const latitude = z.coerce.number().finite().gte(-90).lte(90)
const longitude = z.coerce.number().finite().gte(-180).lte(180)
// Web forms post untouched inputs as "". Coercing "" to 0 is how customers
// ended up at (0, 0) in the Gulf of Guinea (field UX audit 2026-09-05, M-02),
// so an empty string is "unknown" here, exactly like null.
const emptyStringAsNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value)
const latitudeField = z.preprocess(emptyStringAsNull, latitude.optional().nullable())
const longitudeField = z.preprocess(emptyStringAsNull, longitude.optional().nullable())

/**
 * A coordinate pair is either fully known or fully unknown. Sending one axis
 * alone is a client bug, not a partial update: the server would otherwise
 * store a half pair that no map can draw. `null`/absent on both axes clears
 * the pair; the (0, 0) pair is treated as unknown by
 * `normalizeMtmCoordinates` before any write.
 */
function validateCoordinatePair(
  value: { latitude?: number | null; longitude?: number | null },
  ctx: z.RefinementCtx,
) {
  if ((value.latitude == null) !== (value.longitude == null)) {
    ctx.addIssue({ code: "custom", path: ["latitude"], message: "Latitude and longitude must be provided together" })
  }
}

const cuid = z.string().min(1).max(128)
const isoDate = z.union([z.string().datetime({ offset: true }), z.string().date()])
const geoPolygon = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(
    z.array(z.tuple([longitude, latitude])).min(4).max(10_000),
  ).min(1).max(100),
}).optional().nullable()

// ─── Agents ────────────────────────────────────────────────────────────────
export const MtmAgentRole = z.enum(["ADMIN", "MANAGER", "SUPERVISOR", "AGENT"])
export const MtmAgentStatus = z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"])

export const AgentCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  externalCode: z.string().trim().min(1).max(128).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  phone: optionalString,
  password: z.string().min(1).max(72).optional(),
  role: MtmAgentRole.optional(),
  canPlanOwnRoutes: z.boolean().optional(),
  canSelfPublishRoutes: z.boolean().optional(),
  managerId: cuid.optional().nullable(),
  userId: cuid.optional().nullable(),
})
export const AgentUpdateSchema = AgentCreateSchema.partial().extend({
  status: MtmAgentStatus.optional(),
})

// ─── Customers ─────────────────────────────────────────────────────────────
export const MtmCustomerCategory = z.enum(["A", "B", "C", "D"])
export const MtmCustomerStatus = z.enum(["ACTIVE", "INACTIVE", "PROSPECT"])
export const MtmCustomerObjectType = z.enum(["PHARMACY", "CLINIC", "DOCTOR", "STORE", "OTHER"])

const CustomerCreateBaseSchema = z.object({
  code: optionalString,
  name: z.string().trim().min(1).max(200),
  objectType: MtmCustomerObjectType.optional(),
  category: MtmCustomerCategory.optional(),
  status: MtmCustomerStatus.optional(),
  address: optionalString,
  region: optionalString,
  administrativeDistrict: optionalString,
  locality: optionalString,
  cityDistrict: optionalString,
  city: optionalString,
  district: optionalString,
  specialization: optionalString,
  organizationKind: optionalString,
  territoryCode: optionalString,
  polygon: geoPolygon,
  managingManagerId: cuid.optional().nullable(),
  latitude: latitudeField,
  longitude: longitudeField,
  phone: optionalString,
  contactPerson: optionalString,
  notes: longString,
  geofenceRadius: z.number().int().positive().max(50_000).optional().nullable(), // F-22
})
export const CustomerCreateSchema = CustomerCreateBaseSchema.superRefine(validateCoordinatePair)
export const CustomerUpdateSchema = CustomerCreateBaseSchema.partial().superRefine(validateCoordinatePair)

export const CustomerDepartmentCreateSchema = z.object({
  code: z.string().trim().min(1).max(128).optional().nullable(),
  name: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(200).optional().nullable(),
  phone: z.string().trim().min(1).max(100).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable(),
  address: z.string().trim().min(1).max(500).optional().nullable(),
  contactPerson: z.string().trim().min(1).max(200).optional().nullable(),
  sourceSystem: z.string().trim().min(2).max(200),
  sourceReference: z.string().trim().min(1).max(500).optional().nullable(),
  sourceObservedAt: z.string().datetime({ offset: true }),
})

export const CustomerCoordinateVerificationSchema = z.object({
  status: z.enum(["VERIFIED", "REJECTED"]),
  accuracyMeters: z.coerce.number().finite().gte(0).lte(100_000).optional().nullable(),
  sourceSystem: z.string().trim().min(2).max(200),
  sourceReference: z.string().trim().min(1).max(500).optional().nullable(),
  sourceObservedAt: z.string().datetime({ offset: true }),
  decisionReason: z.string().trim().min(3).max(1000).optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.status === "REJECTED" && !value.decisionReason) {
    ctx.addIssue({ code: "custom", path: ["decisionReason"], message: "decisionReason is required when coordinates are rejected" })
  }
})

const OrganizationBulkAssignmentBaseSchema = z.object({
  organizationIds: z.array(cuid).min(1).max(500),
  mode: z.enum(["ASSIGN", "UNASSIGN"]),
  targetAgentId: cuid.optional().nullable(),
  effectiveFrom: z.string().date(),
  reason: z.string().trim().min(3).max(500),
}).superRefine((value, ctx) => {
  if (value.mode === "ASSIGN" && !value.targetAgentId) {
    ctx.addIssue({ code: "custom", path: ["targetAgentId"], message: "targetAgentId is required for ASSIGN" })
  }
  if (value.mode === "UNASSIGN" && value.targetAgentId) {
    ctx.addIssue({ code: "custom", path: ["targetAgentId"], message: "targetAgentId must be empty for UNASSIGN" })
  }
})

export const OrganizationBulkAssignmentPreviewSchema = OrganizationBulkAssignmentBaseSchema
export const OrganizationBulkAssignmentExecuteSchema = OrganizationBulkAssignmentBaseSchema.and(z.object({
  previewToken: z.string().length(64),
  idempotencyKey: z.string().trim().min(8).max(128),
}))

const ContactBulkAssignmentBaseSchema = z.object({
  contactIds: z.array(cuid).min(1).max(500).transform((ids) => [...new Set(ids)]),
  mode: z.enum(["ASSIGN", "UNASSIGN"]),
  targetAgentId: cuid.optional().nullable(),
  effectiveFrom: z.string().date(),
  reason: z.string().trim().min(3).max(500),
}).superRefine((value, ctx) => {
  if (value.mode === "ASSIGN" && !value.targetAgentId) {
    ctx.addIssue({ code: "custom", path: ["targetAgentId"], message: "targetAgentId is required for ASSIGN" })
  }
  if (value.mode === "UNASSIGN" && value.targetAgentId) {
    ctx.addIssue({ code: "custom", path: ["targetAgentId"], message: "targetAgentId must be empty for UNASSIGN" })
  }
})

export const ContactBulkAssignmentPreviewSchema = ContactBulkAssignmentBaseSchema
export const ContactBulkAssignmentExecuteSchema = ContactBulkAssignmentBaseSchema.and(z.object({
  previewToken: z.string().length(64),
  idempotencyKey: z.string().trim().min(8).max(128),
}))

export const OrganizationSavedViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filters: z.record(z.string(), z.unknown()).default({}),
  columns: z.array(z.string().trim().min(1).max(64)).min(1).max(24),
  isDefault: z.boolean().default(false),
})
export const ContactSavedViewSchema = OrganizationSavedViewSchema

// ─── Contacts, workplaces, field assignments, potential ─────────────────
export const MtmContactType = z.enum(["DOCTOR", "PHARMACIST", "OTHER"])
export const MtmContactStatus = z.enum(["ACTIVE", "INACTIVE", "PROSPECT", "DUPLICATE", "MERGED"])
export const MtmEntityAssignmentRole = z.enum(["PRIMARY", "SECONDARY", "OBSERVER"])

export const MtmContactVerificationStatus = z.enum(["UNVERIFIED", "VERIFIED", "REJECTED"])
export const MtmContactConsentStatus = z.enum(["UNKNOWN", "GRANTED", "REVOKED"])
export const MtmContactPreference = z.enum(["PHONE", "EMAIL", "WHATSAPP", "VIBER", "TELEGRAM", "DO_NOT_CONTACT"])

export const ContactCreateSchema = z.object({
  externalCode: optionalString,
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  middleName: optionalString,
  displayName: optionalString,
  type: MtmContactType.optional(),
  specialtyCode: optionalString,
  specialtyName: optionalString,
  qualificationCategory: optionalString,
  profile: optionalString,
  category: MtmCustomerCategory.optional(),
  status: MtmContactStatus.optional(),
  birthDate: z.string().date().optional().nullable(),
  gender: z.string().trim().min(1).max(50).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  phone: optionalString,
  messengerPhone: optionalString,
  workPhone: optionalString,
  homePhone: optionalString,
  mobilePhone: optionalString,
  viberPhone: optionalString,
  whatsappPhone: optionalString,
  telegramPhone: optionalString,
  postalCode: optionalString,
  addressRegion: optionalString,
  addressLocality: optionalString,
  addressDistrict: optionalString,
  addressStreet: optionalString,
  productCategory: optionalString,
  verificationStatus: MtmContactVerificationStatus.optional(),
  consentStatus: MtmContactConsentStatus.optional(),
  contactPreference: MtmContactPreference.optional().nullable(),
  source: z.string().trim().min(1).max(120).optional(),
  duplicateOfContactId: cuid.optional().nullable(),
  notes: longString,
})
export const ContactUpdateSchema = ContactCreateSchema.partial()
export const ContactDirectUpdateSchema = ContactUpdateSchema.extend({
  expectedContactUpdatedAt: z.string().datetime({ offset: true }).optional(),
})

export const ContactWorkplaceUpsertSchema = z.object({
  id: cuid.optional(),
  customerId: cuid,
  jobTitle: optionalString,
  department: optionalString,
  room: optionalString,
  phone: optionalString,
  isPrimary: z.boolean().optional(),
  startedOn: z.string().date().optional().nullable(),
  endedOn: z.string().date().optional().nullable(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
}).superRefine((value, ctx) => {
  if (value.startedOn && value.endedOn && value.startedOn > value.endedOn) {
    ctx.addIssue({ code: "custom", path: ["endedOn"], message: "endedOn must not precede startedOn" })
  }
})

const ContactChangeBaseSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  reason: z.string().trim().min(3).max(1000),
  expectedContactUpdatedAt: z.string().datetime({ offset: true }),
})

const ContactDictionaryEntryCodeSchema = z.string().trim().min(1).max(80)
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/)
const ContactDictionaryMultiSelectionSchema = z.object({
  dictionaryId: cuid,
  codes: z.array(ContactDictionaryEntryCodeSchema).max(50)
    .transform((codes) => [...new Set(codes)]),
}).strict().nullable()

export const ContactDictionaryAssignmentSetSchema = z.object({
  expectedStateHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(3).max(1000),
  psychotype: z.object({
    dictionaryId: cuid,
    code: ContactDictionaryEntryCodeSchema,
  }).strict().nullable(),
  productCategories: ContactDictionaryMultiSelectionSchema,
  brandCategories: ContactDictionaryMultiSelectionSchema,
}).strict()

export const ContactDictionaryAssignmentDirectSchema = ContactDictionaryAssignmentSetSchema.extend({
  expectedContactUpdatedAt: z.string().datetime({ offset: true }).optional(),
})

export const ContactChangeRequestSchema = z.discriminatedUnion("kind", [
  ContactChangeBaseSchema.extend({
    kind: z.literal("CONTACT_UPDATE"),
    payload: ContactUpdateSchema.refine((value) => Object.keys(value).length > 0, "At least one contact field is required"),
  }),
  ContactChangeBaseSchema.extend({
    kind: z.literal("WORKPLACE_UPSERT"),
    payload: ContactWorkplaceUpsertSchema,
  }),
  ContactChangeBaseSchema.extend({
    kind: z.literal("WORKPLACE_END"),
    payload: z.object({
      workplaceId: cuid,
      endedOn: z.string().date(),
      expectedWorkplaceUpdatedAt: z.string().datetime({ offset: true }).optional(),
    }),
  }),
  ContactChangeBaseSchema.extend({
    kind: z.literal("DUPLICATE_REPORT"),
    payload: z.object({ targetContactId: cuid }),
  }),
  ContactChangeBaseSchema.extend({
    kind: z.literal("DICTIONARY_ASSIGNMENTS"),
    payload: ContactDictionaryAssignmentSetSchema,
  }),
])

export const ContactChangeDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "NEEDS_INFO"]),
  comment: z.string().trim().min(1).max(2000),
})

export const FieldAssignmentUpsertSchema = z.object({
  subjectType: z.enum(["ORGANIZATION", "CONTACT"]),
  subjectId: cuid,
  agentId: cuid,
  role: MtmEntityAssignmentRole.optional(),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().optional().nullable(),
  reason: z.string().trim().max(1000).optional().nullable(),
  // Route planning uses this compare-and-set guard after searching the free
  // organization catalogue. It prevents a stale mobile result from silently
  // transferring a customer that another manager has since assigned.
  requireUnassigned: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.effectiveFrom && value.effectiveTo && value.effectiveFrom >= value.effectiveTo) {
    ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo must be later than effectiveFrom" })
  }
  if (value.requireUnassigned && value.subjectType !== "ORGANIZATION") {
    ctx.addIssue({ code: "custom", path: ["requireUnassigned"], message: "requireUnassigned is only supported for organizations" })
  }
})

export const FieldAssignmentEndSchema = z.object({
  effectiveTo: z.string().date(),
  reason: z.string().trim().max(1000).optional().nullable(),
})

const ContactTransferBaseSchema = z.object({
  contactIds: z.array(cuid).min(1).max(200).transform((ids) => [...new Set(ids)]),
  sourceAgentId: cuid,
  targetAgentId: cuid,
  effectiveFrom: z.string().date(),
})

export const ContactTransferPreviewSchema = ContactTransferBaseSchema

export const ContactTransferExecuteSchema = ContactTransferBaseSchema.extend({
  previewToken: z.string().trim().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().trim().min(8).max(100),
  reason: z.string().trim().min(3).max(1000),
})

export const FieldPotentialUpsertSchema = z.object({
  id: cuid.optional(),
  subjectType: z.enum(["ORGANIZATION", "CONTACT"]),
  subjectId: cuid,
  brandExternalId: optionalString,
  productExternalId: optionalString,
  category: MtmCustomerCategory.optional().nullable(),
  potentialValue: z.coerce.number().finite().nonnegative().max(1_000_000_000),
  coverageValue: z.coerce.number().finite().nonnegative().max(1_000_000_000).optional(),
  periodStart: z.string().date().optional().nullable(),
  periodEnd: z.string().date().optional().nullable(),
  formulaVersion: optionalString,
}).superRefine((value, ctx) => {
  if (!value.brandExternalId && !value.productExternalId) {
    ctx.addIssue({ code: "custom", path: ["brandExternalId"], message: "A brand or product reference is required" })
  }
  if (value.periodStart && value.periodEnd && value.periodStart > value.periodEnd) {
    ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "periodEnd must not precede periodStart" })
  }
})

// GAP-005 append-only mobile workflow. The older generic upsert contract above
// remains for backward compatibility; new agent/manager writes use this
// idempotent envelope and keep brand/product display snapshots locally in MTM.
export const BrandPotentialCreateSchema = z.object({
  clientPotentialId: z.string().trim().min(8).max(100),
  agentId: cuid.optional().nullable(),
  brandExternalId: z.string().trim().min(1).max(200),
  brandName: z.string().trim().min(1).max(200),
  productExternalId: optionalString,
  productName: optionalString,
  category: MtmCustomerCategory.optional().nullable(),
  categoryLabel: optionalString,
  potentialValue: z.coerce.number().finite().nonnegative().max(1_000_000_000),
  coverageValue: z.coerce.number().finite().nonnegative().max(1_000_000_000),
  periodStart: z.string().date(),
  periodEnd: z.string().date().optional().nullable(),
  source: z.string().trim().min(1).max(120),
  formulaVersion: optionalString,
  provenance: z.record(z.string(), z.unknown()).optional().default({}),
  evidenceVisitIds: z.array(cuid).max(20).optional().default([]).transform((ids) => [...new Set(ids)]),
  supersedesPotentialId: cuid.optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.periodEnd && value.periodStart > value.periodEnd) {
    ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "periodEnd must not precede periodStart" })
  }
})

export const BrandPotentialDecisionSchema = z.object({
  decision: z.enum(["VERIFIED", "REJECTED"]),
  comment: z.string().trim().min(2).max(2000),
})

export const BrandPotentialEndSchema = z.object({
  periodEnd: z.string().date(),
  reason: z.string().trim().min(2).max(2000),
})

// ─── Pharma doctor scoring (GAP-004) ────────────────────────────────────
export const DoctorScoringFormulaCreateSchema = z.object({
  version: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  definition: GovernedDoctorScoringDefinitionSchema,
}).strict()

export const DoctorAssessmentCreateSchema = z.object({
  clientAssessmentId: z.string().trim().min(8).max(128),
  formulaId: cuid,
  office: optionalString,
  patientsPerMonth: z.coerce.number().int().nonnegative().max(1_000_000).optional().nullable(),
  bedCount: z.coerce.number().int().nonnegative().max(1_000_000).optional().nullable(),
  isKol: z.boolean().optional(),
  kolLevel: optionalString,
  profile: optionalString,
  psychotype: optionalString,
  granularCategory: optionalString,
  actualScore: z.coerce.number().finite().nonnegative().max(1_000_000_000).optional().nullable(),
  targetScore: z.coerce.number().finite().nonnegative().max(1_000_000_000).optional().nullable(),
  periodStart: z.string().date(),
  periodEnd: z.string().date().optional().nullable(),
  source: z.string().trim().min(1).max(120),
  provenance: z.record(z.string(), z.unknown()),
}).superRefine((value, ctx) => {
  if (value.periodEnd && value.periodStart > value.periodEnd) {
    ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "periodEnd must not precede periodStart" })
  }
  if (!value.isKol && value.kolLevel) {
    ctx.addIssue({ code: "custom", path: ["kolLevel"], message: "kolLevel requires isKol" })
  }
})

export const DoctorAssessmentDecisionSchema = z.object({
  decision: z.enum(["VERIFIED", "REJECTED"]),
  comment: z.string().trim().min(1).max(2000),
})

// ─── Work calendar ────────────────────────────────────────────────────────
export const MtmWorkCalendarDayKind = z.enum([
  "WORKING_DAY",
  "WEEKEND",
  "PUBLIC_HOLIDAY",
  "COMPANY_HOLIDAY",
  "EXCEPTION_WORKDAY",
  "MOVED_WORKDAY",
  "MOVED_DAY_OFF",
])

export const WorkCalendarDayUpsertSchema = z.object({
  id: cuid.optional(),
  date: z.string().date(),
  kind: MtmWorkCalendarDayKind,
  name: optionalString,
  teamId: cuid.optional().nullable(),
  agentId: cuid.optional().nullable(),
  movedToDate: z.string().date().optional().nullable(),
  routePlanningAllowed: z.boolean().optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.teamId && value.agentId) {
    ctx.addIssue({
      code: "custom",
      path: ["agentId"],
      message: "A calendar override may target a team or an agent, not both",
    })
  }
  if ((value.kind === "MOVED_WORKDAY" || value.kind === "MOVED_DAY_OFF") && !value.movedToDate) {
    ctx.addIssue({
      code: "custom",
      path: ["movedToDate"],
      message: "movedToDate is required for a moved calendar day",
    })
  }
})

// ─── Routes ────────────────────────────────────────────────────────────────
export const MtmRouteStatus = z.enum(["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
export const MtmRouteAssignmentRole = z.enum(["PRIMARY", "PARTICIPANT", "OBSERVER"])

const RoutePointInput = z.object({
  customerId: cuid,
  contactId: cuid.optional().nullable(),
  plannedTime: isoDate.optional().nullable(),
})
const RouteAssignmentInput = z.object({
  agentId: cuid,
  role: MtmRouteAssignmentRole,
})

function validateRouteOwnership(
  value: { agentId?: string; assignments?: Array<{ agentId: string; role: string }> },
  ctx: z.RefinementCtx,
  ownerRequired: boolean,
) {
  const assignments = value.assignments ?? []
  if (!ownerRequired && value.agentId === undefined && value.assignments === undefined) return
  const uniqueAgents = new Set(assignments.map((assignment) => assignment.agentId))
  if (uniqueAgents.size !== assignments.length) {
    ctx.addIssue({ code: "custom", path: ["assignments"], message: "Each agent may be assigned only once" })
  }

  const primaries = assignments.filter((assignment) => assignment.role === "PRIMARY")
  if (!value.agentId && primaries.length !== 1) {
    ctx.addIssue({ code: "custom", path: ["assignments"], message: "Exactly one PRIMARY assignment is required" })
  }
  if (primaries.length > 1) {
    ctx.addIssue({ code: "custom", path: ["assignments"], message: "Only one PRIMARY assignment is allowed" })
  }
  if (value.agentId && primaries.length === 1 && primaries[0].agentId !== value.agentId) {
    ctx.addIssue({ code: "custom", path: ["agentId"], message: "agentId must match the PRIMARY assignment" })
  }
}

function validateRoutePoints(
  value: { points?: Array<{ customerId: string; contactId?: string | null }> },
  ctx: z.RefinementCtx,
) {
  const subjects = value.points?.map((point) => point.contactId
    ? `contact:${point.contactId}`
    : `customer:${point.customerId}`) ?? []
  if (new Set(subjects).size !== subjects.length) {
    ctx.addIssue({ code: "custom", path: ["points"], message: "A customer or contact may appear only once in a route" })
  }
}

export const RouteCreateSchema = z.object({
  agentId: cuid.optional(),
  assignments: z.array(RouteAssignmentInput).min(1).max(50).optional(),
  date: isoDate,
  status: z.enum(["DRAFT", "PLANNED"]).optional(),
  name: optionalString,
  notes: longString,
  points: z.array(RoutePointInput).max(200).optional(),
}).superRefine((value, ctx) => {
  validateRouteOwnership(value, ctx, true)
  validateRoutePoints(value, ctx)
})
export const RouteUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  agentId: cuid.optional(),
  assignments: z.array(RouteAssignmentInput).min(1).max(50).optional(),
  date: isoDate.optional(),
  name: optionalString,
  status: MtmRouteStatus.optional(),
  notes: longString,
  points: z.array(RoutePointInput).max(200).optional(),
}).superRefine((value, ctx) => {
  validateRouteOwnership(value, ctx, false)
  validateRoutePoints(value, ctx)
})

export const RoutePublishSchema = z.object({
  expectedVersion: z.number().int().positive(),
  overrideReason: z.string().trim().min(3).max(1000).optional(),
})

// Route Field's new mobile command transport is deliberately narrower than
// the legacy web-compatible route endpoints. The authenticated mobile agent
// is the only owner; callers cannot submit agent IDs, assignments, names,
// notes, or manager override reasons in this grammar.
const MobileRouteCommandOperationId = z.string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/, "operationId must be an opaque transport-safe ID")
const MobileRoutePointInput = z.object({
  customerId: cuid,
  contactId: cuid.optional().nullable(),
  plannedTime: isoDate.optional().nullable(),
}).strict()
const MobileRouteCommandPoints = z.array(MobileRoutePointInput).max(200).superRefine((points, ctx) => {
  const subjects = points.map((point) => point.contactId
    ? `contact:${point.contactId}`
    : `customer:${point.customerId}`)
  if (new Set(subjects).size !== subjects.length) {
    ctx.addIssue({ code: "custom", message: "A customer or contact may appear only once in a route" })
  }
})

export const MtmMobileRouteCommandSchema = z.discriminatedUnion("command", [
  z.object({
    operationId: MobileRouteCommandOperationId,
    command: z.literal("CREATE_DRAFT"),
    payload: z.object({
      // A route day is a tenant-local calendar key, never an offset-bearing
      // timestamp that could silently cross a day boundary after parsing.
      date: z.string().date(),
      points: MobileRouteCommandPoints,
    }).strict(),
  }).strict(),
  z.object({
    operationId: MobileRouteCommandOperationId,
    command: z.literal("UPDATE_DRAFT"),
    routeId: cuid,
    payload: z.object({
      expectedVersion: z.number().int().positive(),
      points: MobileRouteCommandPoints,
    }).strict(),
  }).strict(),
  z.object({
    operationId: MobileRouteCommandOperationId,
    command: z.literal("PUBLISH"),
    routeId: cuid,
    payload: z.object({
      expectedVersion: z.number().int().positive(),
    }).strict(),
  }).strict(),
  z.object({
    operationId: MobileRouteCommandOperationId,
    command: z.literal("START"),
    routeId: cuid,
    payload: z.object({
      // Route execution is an explicit optimistic-concurrency transition.
      // The server supplies the factual start time; a device timestamp must
      // never be able to backdate a route.
      expectedVersion: z.number().int().positive(),
    }).strict(),
  }).strict(),
])

export type MtmMobileRouteCommandInput = z.infer<typeof MtmMobileRouteCommandSchema>

export const RouteChangeRequestSchema = z.object({
  changeType: z.enum(["REMOVE_STOP", "ADD_STOP", "CONFLICT_OVERRIDE"]),
  routePointId: cuid.optional(),
  reason: z.string().trim().min(3).max(1000),
  payload: z.record(z.string(), z.unknown()).optional(),
}).superRefine((value, ctx) => {
  if (value.changeType === "REMOVE_STOP" && !value.routePointId) {
    ctx.addIssue({ code: "custom", path: ["routePointId"], message: "routePointId is required" })
  }
  if (value.changeType === "ADD_STOP" && typeof value.payload?.customerId !== "string") {
    ctx.addIssue({ code: "custom", path: ["payload", "customerId"], message: "customerId is required" })
  }
  if (
    value.changeType === "REMOVE_STOP" &&
    value.payload?.reasonCode !== undefined &&
    ![
      "CUSTOMER_REQUEST",
      "CUSTOMER_UNAVAILABLE",
      "AGENT_ILLNESS",
      "ROUTE_CONFLICT",
      "WEATHER",
      "TRANSPORT",
      "DUPLICATE_PLAN",
      "OTHER",
    ].includes(String(value.payload.reasonCode))
  ) {
    ctx.addIssue({ code: "custom", path: ["payload", "reasonCode"], message: "Unsupported cancellation reason" })
  }
})

export const RouteChangeDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "NEEDS_INFO", "RESCHEDULE"]),
  comment: z.string().trim().max(1000).optional(),
  rescheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).superRefine((value, ctx) => {
  if (["REJECTED", "NEEDS_INFO"].includes(value.decision) && !value.comment) {
    ctx.addIssue({ code: "custom", path: ["comment"], message: "A comment is required" })
  }
  if (value.decision === "RESCHEDULE" && !value.rescheduleDate) {
    ctx.addIssue({ code: "custom", path: ["rescheduleDate"], message: "rescheduleDate is required" })
  }
})

export const MtmVisitPotential = z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"])

const CustomerCreateRequestBaseSchema = z.object({
  routeId: cuid.optional().nullable(),
  objectType: MtmCustomerObjectType,
  externalCode: optionalString,
  name: z.string().trim().min(2).max(200),
  address: optionalString,
  city: optionalString,
  district: optionalString,
  latitude: latitudeField,
  longitude: longitudeField,
  contactPerson: optionalString,
  phone: optionalString,
  category: MtmCustomerCategory.optional().nullable(),
  potential: MtmVisitPotential.default("UNKNOWN"),
  territoryCode: optionalString,
  photoUrl: z.string().url().max(2000).optional().nullable(),
  reason: z.string().trim().min(3).max(1000),
  agentComment: longString,
})

export const CustomerCreateRequestSchema = CustomerCreateRequestBaseSchema.superRefine(validateCoordinatePair)

export const CustomerCreateRequestUpdateSchema = CustomerCreateRequestBaseSchema.partial().extend({
  agentComment: z.string().trim().min(3).max(5000),
}).superRefine(validateCoordinatePair)

export const CustomerCreateRequestDecisionSchema = RouteChangeDecisionSchema

// ─── Visits ────────────────────────────────────────────────────────────────
export const MtmVisitStatus = z.enum(["CHECKED_IN", "CHECKED_OUT", "CANCELLED"])

export const VisitCreateSchema = z.object({
  agentId: cuid,
  customerId: cuid,
  contactId: cuid.optional().nullable(),
  routeId: cuid.optional().nullable(),
  routePointId: cuid.optional().nullable(),
  visitType: z.string().trim().min(1).max(50).optional(),
  latitude: latitudeField,
  longitude: longitudeField,
  notes: longString,
  force: z.boolean().optional(),
})
export const VisitUpdateSchema = z.object({
  agentId: cuid.optional(),
  customerId: cuid.optional(),
  contactId: cuid.optional().nullable(),
  status: MtmVisitStatus.optional(),
  latitude: latitudeField,
  longitude: longitudeField,
  notes: longString,
  checkOutAt: isoDate.optional(),
})

export const MtmVisitActionKey = z.enum(["PHOTO", "PRESENTATION", "STOCK_CHECK", "VISIT_NOTE", "CHECKLIST", "FEEDBACK", "NEXT_ACTION"])
export const MtmRequirementMode = z.enum(["REQUIRED", "OPTIONAL", "HIDDEN"])

const VisitPolicyActionInput = z.object({
  actionKey: MtmVisitActionKey,
  mode: MtmRequirementMode,
  minCount: z.number().int().min(1).max(100).default(1),
  conditions: z.object({
    customerCategories: z.array(MtmCustomerCategory).min(1).optional(),
    objectTypes: z.array(z.enum(["PHARMACY", "CLINIC", "DOCTOR", "STORE", "OTHER"])).min(1).optional(),
  }).optional().nullable(),
  allowWaiver: z.boolean().default(false),
})

const VisitPolicyBaseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  teamId: cuid.optional().nullable(),
  visitType: z.string().trim().min(1).max(50).default("DEFAULT"),
  priority: z.number().int().min(0).max(10_000).default(100),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.optional().nullable(),
  isActive: z.boolean().default(true),
  actions: z.array(VisitPolicyActionInput).max(7),
})

function validateVisitPolicy(
  value: { effectiveFrom?: string; effectiveTo?: string | null; actions?: Array<{ actionKey: string }> },
  ctx: z.RefinementCtx,
) {
  if (value.effectiveFrom && value.effectiveTo && new Date(value.effectiveTo) < new Date(value.effectiveFrom)) {
    ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo must not precede effectiveFrom" })
  }
  const keys = value.actions?.map((action) => action.actionKey) ?? []
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: "custom", path: ["actions"], message: "Each action may be configured once" })
  }
}

export const VisitPolicyCreateSchema = VisitPolicyBaseSchema.superRefine(validateVisitPolicy)
export const VisitPolicyUpdateSchema = VisitPolicyBaseSchema.partial().superRefine(validateVisitPolicy)
export const VisitPolicyPreviewSchema = z.object({
  agentId: cuid,
  customerId: cuid,
  visitType: z.string().trim().min(1).max(50).optional(),
  at: isoDate.optional(),
})

export const VisitActionResultSchema = z.object({
  id: cuid.optional(),
  actionKey: MtmVisitActionKey,
  status: z.enum(["COMPLETED", "WAIVED"]).default("COMPLETED"),
  evidence: z.record(z.string(), z.unknown()).optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.status === "WAIVED") {
    const reason = value.evidence?.reason
    if (typeof reason !== "string" || !reason.trim()) {
      ctx.addIssue({ code: "custom", path: ["evidence", "reason"], message: "A waiver reason is required" })
    }
  }
})

export const VisitResultSchema = z.object({
  outcome: z.enum(["SUCCESSFUL", "PARTIAL", "NO_CONTACT", "RESCHEDULE"]),
  potential: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).default("UNKNOWN"),
  discussedTopics: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  feedback: z.string().trim().max(2000).optional().nullable(),
  finalNote: z.string().trim().max(5000).optional().nullable(),
  nextAction: z.object({
    title: z.string().trim().min(1).max(200),
    dueDate: isoDate,
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  }).optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.outcome === "RESCHEDULE" && !value.nextAction) {
    ctx.addIssue({ code: "custom", path: ["nextAction"], message: "A rescheduled visit requires a next action" })
  }
})

// ─── Tasks ─────────────────────────────────────────────────────────────────
export const MtmTaskPriority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"])
export const MtmTaskStatus = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "OVERDUE"])
export const MtmTaskRecurrenceRule = z.enum(["DAILY", "WEEKLY", "MONTHLY"])
export const MtmTaskEditScope = z.enum(["THIS", "THIS_AND_FUTURE"])

const TaskAuthoringFields = z.object({
  agentId: cuid,
  customerId: cuid.optional().nullable(),
  visitId: cuid.optional().nullable(),
  taskGroupCode: z.string().trim().min(1).max(80).regex(/^[A-Z0-9][A-Z0-9_-]*$/).optional().nullable(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000).optional().nullable(),
  priority: MtmTaskPriority.optional(),
  scheduledStartAt: isoDate.optional().nullable(),
  dueDate: isoDate.optional().nullable(),
  recurrenceRule: MtmTaskRecurrenceRule.optional().nullable(),
  recurrenceInterval: z.number().int().min(1).max(365).optional().nullable(),
  recurrenceUntil: isoDate.optional().nullable(),
  recurrenceTimezone: z.string().trim().min(1).max(64).optional().nullable(),
})

export const TaskCreateSchema = TaskAuthoringFields.superRefine((value, ctx) => {
  if (
    !value.recurrenceRule
    && (value.recurrenceInterval != null || value.recurrenceUntil != null || value.recurrenceTimezone != null)
  ) {
    ctx.addIssue({ code: "custom", path: ["recurrenceRule"], message: "recurrenceRule is required with recurrence settings" })
  }
  if (value.recurrenceRule && !value.scheduledStartAt && !value.dueDate) {
    ctx.addIssue({ code: "custom", path: ["dueDate"], message: "scheduledStartAt or dueDate is required for recurrence" })
  }
})
export const TaskUpdateSchema = TaskAuthoringFields.partial().extend({
  expectedVersion: z.number().int().min(1).optional(),
  editScope: MtmTaskEditScope.optional().default("THIS"),
  status: MtmTaskStatus.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  // Mobile sends `result` (completion notes) when an agent marks a task COMPLETED;
  // see MTMobileApp/src/screens/tasks/TasksScreen.tsx → api.updateTask.
  // Without this field declared, Zod silently strips it (default `.object()` is strip)
  // and the agent's notes never reach the DB.
  result: z.string().trim().max(5_000).optional().nullable(),
}).superRefine((value, ctx) => {
  if (
    value.recurrenceRule === null
    && (value.recurrenceInterval != null || value.recurrenceUntil != null || value.recurrenceTimezone != null)
  ) {
    ctx.addIssue({ code: "custom", path: ["recurrenceRule"], message: "Clearing recurrence cannot set recurrence settings" })
  }
})

export const TaskReviewSchema = z.object({
  action: z.enum(["ACCEPT", "RETURN"]),
  reason: z.string().trim().min(1).max(1_000).optional().nullable(),
  comment: z.string().trim().min(1).max(1_000).optional().nullable(),
  expectedVersion: z.number().int().min(1),
}).superRefine((value, ctx) => {
  if (value.action === "RETURN" && !value.reason && !value.comment) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "A return reason is required" })
  }
})

export const TaskDuplicateSchema = z.object({
  targetDueDate: isoDate,
  targetScheduledStartAt: isoDate.optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(128),
  expectedVersion: z.number().int().min(1),
})

export const TaskCommentSchema = z.object({
  clientEventId: z.string().trim().min(8).max(128),
  comment: z.string().trim().min(1).max(2_000),
})

export const TaskBulkReassignSchema = z.object({
  taskIds: z.array(cuid).min(1).max(200).transform((ids) => [...new Set(ids)]),
  agentId: cuid,
  expectedVersions: z.record(cuid, z.number().int().min(1)),
})

// ─── Alerts (read-mostly; only PATCH dismiss matters for validation) ──────
export const AlertUpdateSchema = z.object({
  isResolved: z.boolean(),
  resolvedBy: cuid.optional().nullable(),
})

// ─── Photos PATCH (review workflow) ───────────────────────────────────────
export const MtmPhotoStatus = z.enum(["PENDING", "APPROVED", "REJECTED"])
export const PhotoReviewSchema = z.object({
  status: MtmPhotoStatus.optional(),
  reviewNote: longString,
  reviewedBy: cuid.optional().nullable(),
})

// ─── Settings PUT ─────────────────────────────────────────────────────────
// Accept arbitrary key/value pairs. The handler upserts each entry by key.
// We constrain known keys but allow extras for backward compat with the
// existing org-customizable shape.
export const SettingsUpdateSchema = z.record(z.string().min(1).max(100), z.unknown())

// A transient, user-triggered provider call. `sourceFingerprint` binds the
// caller to the exact route/order it reviewed; the server re-derives it under
// tenant RLS before a request can leave the process.
export const MtmRouteTravelPreviewSchema = z.object({
  schemaVersion: z.literal(1),
  expectedVersion: z.number().int().min(1),
  sourceFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict()

// ─── Helpers ──────────────────────────────────────────────────────────────
/**
 * Try to parse a request body against a schema. Returns either {data} or a
 * NextResponse-ready error payload (400) describing what failed.
 */
import { NextResponse } from "next/server"
export function parseBody<T>(schema: z.ZodType<T>, body: unknown):
  | { ok: true; data: T }
  | { ok: false; response: NextResponse } {
  const result = schema.safeParse(body)
  if (result.success) return { ok: true, data: result.data }
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "Validation failed",
        details: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 }
    ),
  }
}
