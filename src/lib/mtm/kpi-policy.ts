import { createHash } from "node:crypto"
import { z } from "zod"
import {
  buildExplainableKpi,
  MTM_KPI_FORMULA_VERSION,
} from "@/lib/mtm/explainable-kpi"

const Label = z.string().trim().min(2).max(200)
const IsoDate = z.string().date()
const Sha256 = z.string().regex(/^[a-fA-F0-9]{64}$/)
const SourceName = z.string().trim().min(2).max(120)
const FactBase = z.object({
  agentId: z.string().min(1), agentName: z.string().min(1),
  customerId: z.string().min(1), customerName: z.string().min(1),
  contactId: z.string().nullable(), date: IsoDate,
  visitType: z.enum(["DOUBLE", "INDEPENDENT"]),
  brandIds: z.array(z.string().min(1)).max(100), completed: z.boolean(),
}).strict()
const PlanPoint = FactBase.extend({ routePointId: z.string().min(1) }).strict()
const VisitFact = FactBase.extend({
  visitId: z.string().min(1), routePointId: z.string().nullable(), gpsConfirmed: z.boolean(),
}).strict()
const Ratio = z.object({
  numerator: z.number().int().min(0), denominator: z.number().int().min(0),
  percentage: z.number().min(0).max(100),
}).strict()

export const KpiPolicyDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  formulaVersion: z.literal(MTM_KPI_FORMULA_VERSION),
  rounding: z.object({ mode: z.literal("HALF_UP"), scale: z.literal(1) }).strict(),
  plan: z.object({
    numerator: z.literal("VISITED_ROUTE_POINTS"),
    denominator: z.literal("NON_DRAFT_NON_CANCELLED_ROUTE_POINTS"),
  }).strict(),
  gps: z.object({
    numerator: z.literal("COMPLETED_VISITS_WITH_VALID_CHECK_IN_AND_CHECK_OUT"),
    denominator: z.literal("COMPLETED_VISITS"),
  }).strict(),
  exclusions: z.array(z.enum(["DRAFT_ROUTES", "CANCELLED_ROUTES", "CANCELLED_VISITS", "SOFT_DELETED_RECORDS"]))
    .length(4).superRefine((values, ctx) => {
      if (new Set(values).size !== 4) ctx.addIssue({ code: "custom", message: "Every supported exclusion must occur exactly once" })
    }),
  visitTypeAliases: z.object({
    DOUBLE: z.tuple([z.literal("DOUBLE"), z.literal("JOINT")]),
    INDEPENDENT: z.tuple([z.literal("INDEPENDENT"), z.literal("SELF")]),
  }).strict(),
  reconciliationCases: z.array(z.object({
    name: z.string().trim().min(2).max(120),
    filter: z.object({ visitType: z.enum(["ALL", "DOUBLE", "INDEPENDENT"]), brandId: z.string().nullable() }).strict(),
    planPoints: z.array(PlanPoint).max(2_000),
    visits: z.array(VisitFact).max(2_000),
    expected: z.object({ plan: Ratio, gps: Ratio }).strict(),
  }).strict()).min(1).max(20),
}).strict()

export const KpiPolicyCreateSchema = z.object({
  code: z.string().trim().min(2).max(80).regex(/^[A-Z0-9][A-Z0-9_-]*$/),
  version: z.number().int().positive().max(1_000_000),
  nameRu: Label, nameAz: Label, nameEn: Label,
  definition: KpiPolicyDefinitionSchema,
  sourceSystem: SourceName,
  sourceReference: z.string().trim().max(500).optional(),
  sourceObservedAt: z.string().datetime({ offset: true }),
  effectiveFrom: IsoDate,
  effectiveTo: IsoDate.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo must not precede effectiveFrom" })
  }
})

export const KpiPolicySignSchema = z.object({
  expectedDefinitionHash: Sha256,
  approvalReference: z.string().trim().min(3).max(500),
}).strict()

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonical(nested)]))
}

export function canonicalKpiPolicyJson(value: unknown): string {
  return JSON.stringify(canonical(value))
}

export function kpiPolicyHash(value: unknown): string {
  return createHash("sha256").update(canonicalKpiPolicyJson(value)).digest("hex")
}

export function reconcileKpiPolicyDefinition(value: unknown): { ok: true } | { ok: false; caseName: string } {
  const parsed = KpiPolicyDefinitionSchema.safeParse(value)
  if (!parsed.success) return { ok: false, caseName: "schema" }
  for (const testCase of parsed.data.reconciliationCases) {
    const report = buildExplainableKpi({
      planPoints: testCase.planPoints,
      visits: testCase.visits,
      visitType: testCase.filter.visitType,
      brandId: testCase.filter.brandId,
      generatedAt: new Date("2000-01-01T00:00:00.000Z"),
    })
    if (canonicalKpiPolicyJson({ plan: report.plan, gps: report.gps }) !== canonicalKpiPolicyJson(testCase.expected)) {
      return { ok: false, caseName: testCase.name }
    }
  }
  return { ok: true }
}

export function kpiPolicySignatureIsCoherent(policy: {
  status: string; definition: unknown; definitionHash: string;
  approvalReference: string | null; signedByUserId: string | null;
  signedAt: Date | null; activatedAt: Date | null; retiredAt: Date | null;
}): boolean {
  if (policy.status !== "ACTIVE" && policy.status !== "RETIRED") return false
  const parsed = KpiPolicyDefinitionSchema.safeParse(policy.definition)
  if (!parsed.success || kpiPolicyHash(parsed.data) !== policy.definitionHash.toLowerCase()) return false
  if (!policy.approvalReference?.trim() || !policy.signedByUserId || !policy.signedAt || !policy.activatedAt) return false
  if (policy.status === "ACTIVE" && policy.retiredAt) return false
  if (policy.status === "RETIRED" && !policy.retiredAt) return false
  return reconcileKpiPolicyDefinition(parsed.data).ok
}
