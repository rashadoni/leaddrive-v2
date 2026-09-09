import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { isDateKey } from "@/lib/mtm/mobile-week"
import {
  PHARMACY_PROMOTION_DECIMAL_MAX,
  PHARMACY_PROMOTION_DECIMAL_SCALE,
  normalizePharmacyPromotionDecimal18_4,
} from "@/lib/mtm/pharmacy-promotion-decimal"

export const PHARMACY_PROMOTION_DATE_MODES = [
  "NONE",
  "CREATED_AT",
  "CONNECTED_AT",
  "CLOSED_AT",
] as const

export const PHARMACY_PROMOTION_AMOUNT_MODES = [
  "NONE",
  "FACT_POINTS",
  "REWARD_POINTS",
  "DIFFERENCE",
] as const

export const PHARMACY_PROMOTION_VIEWS = ["registry", "review", "campaigns"] as const
export const PHARMACY_PROMOTION_PAGE_SIZES = [25, 50, 100] as const
export const PHARMACY_PROMOTION_EXECUTION_STATUSES = [
  "DRAFT", "READY", "IN_REVIEW", "APPROVED", "RETURNED", "REJECTED", "REVERSED",
] as const
export const PHARMACY_PROMOTION_TARGET_STATUSES = ["PLANNED", "CONNECTED", "CLOSED", "CANCELLED"] as const
export const PHARMACY_PROMOTION_REVIEW_STATES = ["NOT_READY", "READY", "APPROVED", "REJECTED", "RETURNED"] as const
export const PHARMACY_PROMOTION_VISIT_STATUSES = ["CHECKED_IN", "CHECKED_OUT", "CANCELLED"] as const
export const PHARMACY_PROMOTION_READINESS = ["", "L1", "L2", "BLOCKED"] as const
export const PHARMACY_PROMOTION_SORTS = [
  "createdAt", "connectedAt", "closedAt", "pharmacy", "employee", "factPoints", "rewardPoints", "difference",
] as const

export type PharmacyPromotionDateMode = typeof PHARMACY_PROMOTION_DATE_MODES[number]
export type PharmacyPromotionAmountMode = typeof PHARMACY_PROMOTION_AMOUNT_MODES[number]
export type PharmacyPromotionView = typeof PHARMACY_PROMOTION_VIEWS[number]
export type PharmacyPromotionReviewLevel = "L1" | "L2"
export type PharmacyPromotionReviewDecision = "APPROVED" | "REJECTED" | "RETURNED"

export const PHARMACY_PROMOTION_BLOCKERS = {
  FORMULA_NOT_SIGNED: "MTM_PHARMACY_FORMULA_NOT_SIGNED",
  ELIGIBILITY_NOT_CONFIRMED: "MTM_PHARMACY_ELIGIBILITY_UNKNOWN",
  POLICY_NOT_SIGNED: "MTM_PHARMACY_APPROVAL_POLICY_NOT_SIGNED",
  POSTING_DISABLED: "MTM_PHARMACY_POSTING_DISABLED",
  SOURCE_STALE: "MTM_PHARMACY_SOURCE_STALE",
  EVIDENCE_INCOMPLETE: "MTM_PHARMACY_EVIDENCE_INCOMPLETE",
} as const

export type PharmacyPromotionBlocker = typeof PHARMACY_PROMOTION_BLOCKERS[keyof typeof PHARMACY_PROMOTION_BLOCKERS]

const maxStorageDecimal = new Prisma.Decimal(PHARMACY_PROMOTION_DECIMAL_MAX)

const decimalString = z.union([z.string(), z.number()]).transform((value, context) => {
  try {
    const decimal = new Prisma.Decimal(value)
    if (
      !decimal.isFinite()
      || decimal.isNegative()
      || decimal.greaterThan(maxStorageDecimal)
    ) throw new Error("outside storage range")
    return decimal.toString()
  } catch {
    context.addIssue({
      code: "custom",
      message: `Expected a non-negative decimal no greater than ${PHARMACY_PROMOTION_DECIMAL_MAX}`,
    })
    return z.NEVER
  }
})

export const PharmacyPromotionFormulaDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("LINEAR_V1"),
  factPointsPerUnit: decimalString,
  rewardPointsPerUnit: decimalString,
  scale: z.number().int().min(0).max(4),
  rounding: z.enum(["HALF_UP", "HALF_EVEN", "DOWN"]),
  sourceFreshnessMinutes: z.number().int().positive().max(525_600),
}).strict()

export const PharmacyPromotionEligibilityDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  customerObjectTypes: z.array(z.enum(["PHARMACY", "CLINIC", "DOCTOR", "STORE", "OTHER"])).min(1),
  requireActiveCustomer: z.boolean(),
  requireCompletedVisit: z.boolean(),
  minimumEvidenceCount: z.number().int().min(0).max(100),
}).strict()

export const PharmacyPromotionApprovalPolicyDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  levels: z.tuple([z.literal("L1"), z.literal("L2")]),
  l1Roles: z.array(z.enum(["ADMIN", "MANAGER", "SUPERVISOR", "AGENT"])).min(1),
  l2Roles: z.array(z.enum(["ADMIN", "MANAGER", "SUPERVISOR", "AGENT"])).min(1),
  preventSelfApproval: z.boolean(),
  requireDistinctReviewers: z.boolean(),
  reasonRequiredFor: z.array(z.enum(["REJECTED", "RETURNED"])),
}).strict()

export type PharmacyPromotionFormulaDefinition = z.infer<typeof PharmacyPromotionFormulaDefinitionSchema>
export type PharmacyPromotionEligibilityDefinition = z.infer<typeof PharmacyPromotionEligibilityDefinitionSchema>
export type PharmacyPromotionApprovalPolicyDefinition = z.infer<typeof PharmacyPromotionApprovalPolicyDefinitionSchema>

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Prisma.Decimal) return value.toString()
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    )
  }
  return value
}

export function canonicalPharmacyPromotionJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function pharmacyPromotionHash(value: unknown): string {
  return createHash("sha256").update(canonicalPharmacyPromotionJson(value)).digest("hex")
}

export function pharmacyPromotionSyncScopeKey(input: {
  organizationId: string
  userId: string
  agentId: string | null
}): string {
  return pharmacyPromotionHash({
    organizationId: input.organizationId,
    userId: input.userId,
    agentId: input.agentId,
  })
}

export type PharmacyPromotionSignedDefinition<T> = {
  status: "DRAFT" | "ACTIVE" | "RETIRED"
  definition: unknown
  definitionHash: string
  signedAt: Date | string | null
  approvalReference: string | null
  version: string
  parsed?: T
}

export function validateSignedDefinition<T>(
  input: PharmacyPromotionSignedDefinition<T> | null | undefined,
  schema: z.ZodType<T>,
  blocker: PharmacyPromotionBlocker,
): { ok: true; definition: T } | { ok: false; blocker: PharmacyPromotionBlocker } {
  if (
    !input
    || input.status !== "ACTIVE"
    || !input.signedAt
    || !input.approvalReference?.trim()
    || input.definitionHash !== pharmacyPromotionHash(input.definition)
  ) {
    return { ok: false, blocker }
  }
  const parsed = schema.safeParse(input.definition)
  return parsed.success
    ? { ok: true, definition: parsed.data }
    : { ok: false, blocker }
}

export type PharmacyPromotionEligibilityInput = {
  customerObjectType: "PHARMACY" | "CLINIC" | "DOCTOR" | "STORE" | "OTHER"
  customerActive: boolean
  visitCompleted: boolean
  evidenceCount: number
}

export function evaluatePharmacyPromotionEligibility(
  definition: PharmacyPromotionEligibilityDefinition,
  input: PharmacyPromotionEligibilityInput,
): { status: "ELIGIBLE" } | { status: "INELIGIBLE"; reasons: string[] } {
  const reasons: string[] = []
  if (!definition.customerObjectTypes.includes(input.customerObjectType)) reasons.push("CUSTOMER_TYPE")
  if (definition.requireActiveCustomer && !input.customerActive) reasons.push("CUSTOMER_INACTIVE")
  if (definition.requireCompletedVisit && !input.visitCompleted) reasons.push("VISIT_INCOMPLETE")
  if (input.evidenceCount < definition.minimumEvidenceCount) reasons.push("EVIDENCE_INCOMPLETE")
  return reasons.length === 0 ? { status: "ELIGIBLE" } : { status: "INELIGIBLE", reasons }
}

function decimalRounding(rounding: PharmacyPromotionFormulaDefinition["rounding"]) {
  if (rounding === "HALF_EVEN") return Prisma.Decimal.ROUND_HALF_EVEN
  if (rounding === "DOWN") return Prisma.Decimal.ROUND_DOWN
  return Prisma.Decimal.ROUND_HALF_UP
}

export type PharmacyPromotionCalculation = {
  status: "CALCULATED"
  factQuantity: string
  factPoints: string
  rewardPoints: string
  difference: string
  inputHash: string
  calculationHash: string
}

export function calculatePharmacyPromotionPoints(
  definition: PharmacyPromotionFormulaDefinition,
  factQuantity: string | number | Prisma.Decimal,
): PharmacyPromotionCalculation {
  const parsedDefinition = PharmacyPromotionFormulaDefinitionSchema.safeParse(definition)
  if (!parsedDefinition.success) throw new Error("MTM_PHARMACY_FORMULA_INVALID")
  const canonicalQuantity = normalizePharmacyPromotionDecimal18_4(
    factQuantity instanceof Prisma.Decimal ? factQuantity.toString() : factQuantity,
  )
  if (canonicalQuantity === null) throw new Error("MTM_PHARMACY_FACT_QUANTITY_INVALID")

  const safeDefinition = parsedDefinition.data
  const quantity = new Prisma.Decimal(canonicalQuantity)
  const rounding = decimalRounding(safeDefinition.rounding)
  const factPoints = quantity
    .mul(new Prisma.Decimal(safeDefinition.factPointsPerUnit))
    .toDecimalPlaces(safeDefinition.scale, rounding)
  const rewardPoints = quantity
    .mul(new Prisma.Decimal(safeDefinition.rewardPointsPerUnit))
    .toDecimalPlaces(safeDefinition.scale, rounding)
  const difference = factPoints.minus(rewardPoints).toDecimalPlaces(safeDefinition.scale, rounding)
  if (
    [factPoints, rewardPoints, difference].some((value) => (
      !value.isFinite()
      || value.decimalPlaces() > PHARMACY_PROMOTION_DECIMAL_SCALE
      || value.abs().greaterThan(maxStorageDecimal)
    ))
  ) throw new Error("MTM_PHARMACY_CALCULATION_OUT_OF_RANGE")

  const input = {
    definitionHash: pharmacyPromotionHash(safeDefinition),
    factQuantity: canonicalQuantity,
  }
  const output = {
    factPoints: factPoints.toFixed(safeDefinition.scale),
    rewardPoints: rewardPoints.toFixed(safeDefinition.scale),
    difference: difference.toFixed(safeDefinition.scale),
  }
  return {
    status: "CALCULATED",
    factQuantity: canonicalQuantity,
    ...output,
    inputHash: pharmacyPromotionHash(input),
    calculationHash: pharmacyPromotionHash({ input, output }),
  }
}

export function pharmacyPromotionSourceFreshness(input: {
  observedAt: Date | string | null
  receivedAt?: Date | string | null
  now?: Date
  thresholdMinutes: number
}): { state: "FRESH" | "STALE" | "UNKNOWN"; ageMinutes: number | null } {
  if (!input.observedAt) return { state: "UNKNOWN", ageMinutes: null }
  const observedAt = new Date(input.observedAt)
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : null
  const now = input.now ?? new Date()
  if (Number.isNaN(observedAt.getTime())) return { state: "UNKNOWN", ageMinutes: null }
  if (receivedAt && Number.isNaN(receivedAt.getTime())) return { state: "UNKNOWN", ageMinutes: null }
  const clockToleranceMs = 5 * 60_000
  if (
    observedAt.getTime() > now.getTime() + clockToleranceMs
    || (receivedAt && observedAt.getTime() > receivedAt.getTime() + clockToleranceMs)
  ) {
    return { state: "UNKNOWN", ageMinutes: null }
  }
  const ageMs = Math.max(0, now.getTime() - observedAt.getTime())
  const ageMinutes = Math.floor(ageMs / 60_000)
  return {
    state: ageMs <= input.thresholdMinutes * 60_000 ? "FRESH" : "STALE",
    ageMinutes,
  }
}

export function pharmacyPromotionConfigurationState(input: {
  formula: PharmacyPromotionSignedDefinition<PharmacyPromotionFormulaDefinition> | null
  approvalPolicy: PharmacyPromotionSignedDefinition<PharmacyPromotionApprovalPolicyDefinition> | null
  eligibilityDefinition: unknown
  eligibilityDefinitionHash: string | null
  eligibilityApprovedAt: Date | string | null
  eligibilityApprovalReference: string | null
  postingEnabled: boolean
  /** Existing executions may drain after an auditable campaign retirement. */
  allowRetiredDefinitions?: boolean
}): { ready: true } | { ready: false; blockers: PharmacyPromotionBlocker[] } {
  const blockers = new Set<PharmacyPromotionBlocker>()
  const formula = validateSignedDefinition(
    input.allowRetiredDefinitions && input.formula?.status === "RETIRED"
      ? { ...input.formula, status: "ACTIVE" }
      : input.formula,
    PharmacyPromotionFormulaDefinitionSchema,
    PHARMACY_PROMOTION_BLOCKERS.FORMULA_NOT_SIGNED,
  )
  if (!formula.ok) blockers.add(formula.blocker)
  const policy = validateSignedDefinition(
    input.allowRetiredDefinitions && input.approvalPolicy?.status === "RETIRED"
      ? { ...input.approvalPolicy, status: "ACTIVE" }
      : input.approvalPolicy,
    PharmacyPromotionApprovalPolicyDefinitionSchema,
    PHARMACY_PROMOTION_BLOCKERS.POLICY_NOT_SIGNED,
  )
  if (!policy.ok) blockers.add(policy.blocker)
  if (
    !input.eligibilityApprovedAt
    || !input.eligibilityApprovalReference?.trim()
    || !input.eligibilityDefinitionHash
    || input.eligibilityDefinitionHash !== pharmacyPromotionHash(input.eligibilityDefinition)
    || !PharmacyPromotionEligibilityDefinitionSchema.safeParse(input.eligibilityDefinition).success
  ) {
    blockers.add(PHARMACY_PROMOTION_BLOCKERS.ELIGIBILITY_NOT_CONFIRMED)
  }
  if (!input.postingEnabled) blockers.add(PHARMACY_PROMOTION_BLOCKERS.POSTING_DISABLED)
  return blockers.size === 0 ? { ready: true } : { ready: false, blockers: [...blockers] }
}

export function canReviewPharmacyPromotion(input: {
  actor: MtmRouteActor
  level: PharmacyPromotionReviewLevel
  policy: PharmacyPromotionApprovalPolicyDefinition
  executionAgentId: string
  submittedByAgentId: string | null
  submittedByUserId: string | null
  reviewerUserId: string
  l1ReviewerAgentId?: string | null
  l1ReviewerUserId?: string | null
}): { allowed: true } | { allowed: false; code: string } {
  const roles = input.level === "L1" ? input.policy.l1Roles : input.policy.l2Roles
  if (!roles.includes(input.actor.role)) return { allowed: false, code: "MTM_PHARMACY_REVIEW_ROLE_DENIED" }
  if (
    input.actor.scopedAgentIds !== null
    && !input.actor.scopedAgentIds.includes(input.executionAgentId)
  ) {
    return { allowed: false, code: "MTM_PHARMACY_REVIEW_SCOPE_DENIED" }
  }
  if (
    input.policy.preventSelfApproval
    && (
      input.actor.agentId === input.executionAgentId
      || input.actor.agentId === input.submittedByAgentId
      || input.reviewerUserId === input.submittedByUserId
    )
  ) {
    return { allowed: false, code: "MTM_PHARMACY_SELF_REVIEW_DENIED" }
  }
  if (
    input.level === "L2"
    && input.policy.requireDistinctReviewers
    && (
      (input.actor.agentId && input.actor.agentId === input.l1ReviewerAgentId)
      || input.reviewerUserId === input.l1ReviewerUserId
    )
  ) {
    return { allowed: false, code: "MTM_PHARMACY_DISTINCT_REVIEWER_REQUIRED" }
  }
  return { allowed: true }
}

export function pharmacyPromotionExecutionReadiness(input: {
  configuration: ReturnType<typeof pharmacyPromotionConfigurationState>
  source: ReturnType<typeof pharmacyPromotionSourceFreshness>
  evidenceCount: number
  minimumEvidenceCount: number
}): { ready: true } | { ready: false; blockers: PharmacyPromotionBlocker[] } {
  const blockers = new Set<PharmacyPromotionBlocker>(
    input.configuration.ready ? [] : input.configuration.blockers,
  )
  if (input.source.state !== "FRESH") blockers.add(PHARMACY_PROMOTION_BLOCKERS.SOURCE_STALE)
  if (input.evidenceCount < input.minimumEvidenceCount) {
    blockers.add(PHARMACY_PROMOTION_BLOCKERS.EVIDENCE_INCOMPLETE)
  }
  return blockers.size === 0 ? { ready: true } : { ready: false, blockers: [...blockers] }
}

export function nextPharmacyPromotionReviewState(input: {
  status: string
  l1State: string
  l2State: string
  level: PharmacyPromotionReviewLevel
  decision: PharmacyPromotionReviewDecision
  reason?: string | null
}): { status: string; l1State: string; l2State: string; postsLedger: boolean } {
  if (input.level === "L1" && (input.status !== "READY" || input.l1State !== "READY")) {
    throw new Error("MTM_PHARMACY_L1_NOT_READY")
  }
  if (
    input.level === "L2"
    && (input.status !== "IN_REVIEW" || input.l1State !== "APPROVED" || input.l2State !== "READY")
  ) {
    throw new Error("MTM_PHARMACY_L2_NOT_READY")
  }
  if ((input.decision === "REJECTED" || input.decision === "RETURNED") && !input.reason?.trim()) {
    throw new Error("MTM_PHARMACY_REVIEW_REASON_REQUIRED")
  }
  if (input.decision === "RETURNED") {
    return {
      status: "RETURNED",
      l1State: input.level === "L1" ? "RETURNED" : input.l1State,
      l2State: input.level === "L2" ? "RETURNED" : "NOT_READY",
      postsLedger: false,
    }
  }
  if (input.decision === "REJECTED") {
    return {
      status: "REJECTED",
      l1State: input.level === "L1" ? "REJECTED" : input.l1State,
      l2State: input.level === "L2" ? "REJECTED" : "NOT_READY",
      postsLedger: false,
    }
  }
  if (input.level === "L1") {
    return { status: "IN_REVIEW", l1State: "APPROVED", l2State: "READY", postsLedger: false }
  }
  return { status: "APPROVED", l1State: "APPROVED", l2State: "APPROVED", postsLedger: true }
}

function enumParam<T extends readonly string[]>(
  value: string | null,
  values: T,
  fallback: T[number],
): T[number] {
  return value && (values as readonly string[]).includes(value) ? value as T[number] : fallback
}

function boundedText(value: string | null, max = 120): string {
  return value?.trim().slice(0, max) ?? ""
}

function finiteParam(value: string | null): string {
  if (!value?.trim()) return ""
  try {
    const decimal = new Prisma.Decimal(value.trim())
    return decimal.isFinite() ? decimal.toString() : ""
  } catch {
    return ""
  }
}

export type PharmacyPromotionFilters = {
  q: string
  departmentId: string
  employeeId: string
  promotionId: string
  promotionType: string
  code: string
  executionStatus: string
  controlledVisitStatus: string
  l1Status: string
  l2Status: string
  ready: string
  dateMode: PharmacyPromotionDateMode
  dateFrom: string
  dateTo: string
  amountMode: PharmacyPromotionAmountMode
  amountMin: string
  amountMax: string
  regionId: string
  localityId: string
  territoryId: string
  contactId: string
  managerId: string
  userGroupId: string
  sort: string
  direction: "asc" | "desc"
  page: number
  pageSize: typeof PHARMACY_PROMOTION_PAGE_SIZES[number]
  columns: string
  density: "compact" | "comfortable"
  view: PharmacyPromotionView
}

export function pharmacyPromotionFiltersFromSearchParams(params: URLSearchParams): PharmacyPromotionFilters {
  const pageCandidate = Number.parseInt(params.get("page") ?? "1", 10)
  const pageSizeCandidate = Number.parseInt(params.get("pageSize") ?? "25", 10)
  const dateMode = enumParam(params.get("dateMode"), PHARMACY_PROMOTION_DATE_MODES, "NONE")
  const amountMode = enumParam(params.get("amountMode"), PHARMACY_PROMOTION_AMOUNT_MODES, "NONE")
  const pageSize = PHARMACY_PROMOTION_PAGE_SIZES.includes(pageSizeCandidate as typeof PHARMACY_PROMOTION_PAGE_SIZES[number])
    ? pageSizeCandidate as typeof PHARMACY_PROMOTION_PAGE_SIZES[number]
    : 25
  return {
    q: boundedText(params.get("q"), 100),
    departmentId: boundedText(params.get("departmentId")),
    employeeId: boundedText(params.get("employeeId")),
    promotionId: boundedText(params.get("promotionId")),
    promotionType: boundedText(params.get("promotionType")),
    code: boundedText(params.get("code")),
    executionStatus: boundedText(params.get("executionStatus")),
    controlledVisitStatus: boundedText(params.get("controlledVisitStatus")),
    l1Status: boundedText(params.get("l1Status")),
    l2Status: boundedText(params.get("l2Status")),
    ready: boundedText(params.get("ready")),
    dateMode,
    dateFrom: dateMode === "NONE" ? "" : boundedText(params.get("dateFrom"), 10),
    dateTo: dateMode === "NONE" ? "" : boundedText(params.get("dateTo"), 10),
    amountMode,
    amountMin: amountMode === "NONE" ? "" : finiteParam(params.get("amountMin")),
    amountMax: amountMode === "NONE" ? "" : finiteParam(params.get("amountMax")),
    regionId: boundedText(params.get("regionId")),
    localityId: boundedText(params.get("localityId")),
    territoryId: boundedText(params.get("territoryId")),
    contactId: boundedText(params.get("contactId")),
    managerId: boundedText(params.get("managerId")),
    userGroupId: boundedText(params.get("userGroupId")),
    sort: boundedText(params.get("sort")) || "createdAt",
    direction: params.get("direction") === "asc" ? "asc" : "desc",
    page: Number.isInteger(pageCandidate) && pageCandidate > 0 ? pageCandidate : 1,
    pageSize,
    columns: boundedText(params.get("columns"), 500),
    density: params.get("density") === "compact" ? "compact" : "comfortable",
    view: enumParam(params.get("view"), PHARMACY_PROMOTION_VIEWS, "registry"),
  }
}

export function pharmacyPromotionFilterValidationError(
  filters: PharmacyPromotionFilters,
): { field: string; code: string } | null {
  const checks: Array<[string, string, readonly string[]]> = [
    ["executionStatus", filters.executionStatus, PHARMACY_PROMOTION_EXECUTION_STATUSES],
    ["controlledVisitStatus", filters.controlledVisitStatus, PHARMACY_PROMOTION_VISIT_STATUSES],
    ["l1Status", filters.l1Status, PHARMACY_PROMOTION_REVIEW_STATES],
    ["l2Status", filters.l2Status, PHARMACY_PROMOTION_REVIEW_STATES],
    ["ready", filters.ready, PHARMACY_PROMOTION_READINESS],
    ["sort", filters.sort, PHARMACY_PROMOTION_SORTS],
  ]
  for (const [field, value, allowed] of checks) {
    if (value && !allowed.includes(value)) return { field, code: "MTM_PHARMACY_FILTER_INVALID" }
  }
  if (filters.dateFrom && !isDateKey(filters.dateFrom)) {
    return { field: "dateFrom", code: "MTM_PHARMACY_FILTER_INVALID" }
  }
  if (filters.dateTo && !isDateKey(filters.dateTo)) {
    return { field: "dateTo", code: "MTM_PHARMACY_FILTER_INVALID" }
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return { field: "dateTo", code: "MTM_PHARMACY_FILTER_RANGE_INVALID" }
  }
  if (
    filters.amountMin
    && filters.amountMax
    && new Prisma.Decimal(filters.amountMin).greaterThan(new Prisma.Decimal(filters.amountMax))
  ) {
    return { field: "amountMax", code: "MTM_PHARMACY_FILTER_RANGE_INVALID" }
  }
  return null
}

export function pharmacyPromotionFilterHash(filters: PharmacyPromotionFilters): string {
  return pharmacyPromotionHash({ ...filters, page: undefined })
}

export function reconcilePharmacyPromotionLedger(
  entries: Array<{ delta: string | number | Prisma.Decimal }>,
): string {
  return entries.reduce(
    (total, entry) => total.plus(new Prisma.Decimal(entry.delta)),
    new Prisma.Decimal(0),
  ).toFixed(4)
}
