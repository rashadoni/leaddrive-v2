import { createHash } from "node:crypto"
import { z } from "zod"

const PolicyCode = z.string().trim().min(2).max(80).regex(/^[A-Z0-9][A-Z0-9_-]*$/)
const PolicyLabel = z.string().trim().min(2).max(200)
const SourceName = z.string().trim().min(2).max(120)
const IsoDate = z.string().date()
const Sha256 = z.string().regex(/^[a-fA-F0-9]{64}$/)
const DecimalText = z.string().max(100).regex(/^-?\d+(?:\.\d{1,4})?$/)
const CoverageValueText = DecimalText.refine((value) => !value.startsWith("-"), "Coverage values cannot be negative")
const JsonRule = z.record(z.string(), z.unknown()).refine(
  (value) => Object.keys(value).length > 0,
  "A declarative rule is required",
)

export const CoverageMetricBindingSchema = z.object({
  source: z.enum(["FIELD_POTENTIAL", "ROUTE_VISIT_FACT", "EXTERNAL_SOURCE", "CONSTANT"]),
  unit: z.enum(["COUNT", "VALUE"]),
  rule: JsonRule,
}).strict()

export const CoveragePolicyGroupSchema = z.object({
  key: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/),
  order: z.number().int().min(0).max(10_000),
  subjectType: z.enum(["DOCTOR", "PHARMACY"]),
  labels: z.object({
    ru: PolicyLabel,
    az: PolicyLabel,
    en: PolicyLabel,
  }).strict(),
  population: z.object({
    source: z.enum(["CONTACT", "CUSTOMER"]),
    filter: JsonRule,
  }).strict(),
  metrics: z.object({
    requiredCoverage: CoverageMetricBindingSchema,
    actualMoi: CoverageMetricBindingSchema,
    target: CoverageMetricBindingSchema,
    actualCoverage: CoverageMetricBindingSchema,
    uncoveredMoi: CoverageMetricBindingSchema,
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.subjectType === "DOCTOR" && value.population.source !== "CONTACT") {
    ctx.addIssue({ code: "custom", path: ["population", "source"], message: "Doctor groups must use the contact population" })
  }
  if (value.subjectType === "PHARMACY" && value.population.source !== "CUSTOMER") {
    ctx.addIssue({ code: "custom", path: ["population", "source"], message: "Pharmacy groups must use the customer population" })
  }
})

export const CoveragePolicyDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  timezone: z.string().trim().min(3).max(100),
  rounding: z.object({
    mode: z.enum(["HALF_UP", "HALF_EVEN", "DOWN", "UP"]),
    scale: z.number().int().min(0).max(4),
  }).strict(),
  groups: z.array(CoveragePolicyGroupSchema).min(1).max(100),
  reconciliation: z.object({
    kpiFormulaVersion: z.string().trim().min(1).max(100),
    tolerance: DecimalText,
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const groupKeys = value.groups.map((group) => group.key)
  if (new Set(groupKeys).size !== groupKeys.length) {
    ctx.addIssue({ code: "custom", path: ["groups"], message: "Coverage group keys must be unique" })
  }
  const orders = value.groups.map((group) => group.order)
  if (new Set(orders).size !== orders.length) {
    ctx.addIssue({ code: "custom", path: ["groups"], message: "Coverage group order values must be unique" })
  }
})

export const CoveragePolicyCreateSchema = z.object({
  code: PolicyCode,
  version: z.number().int().positive().max(1_000_000),
  nameRu: PolicyLabel,
  nameAz: PolicyLabel,
  nameEn: PolicyLabel,
  definition: CoveragePolicyDefinitionSchema,
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

export const CoveragePolicySignSchema = z.object({
  expectedDefinitionHash: Sha256,
  approvalReference: z.string().trim().min(3).max(500),
}).strict()

export const CoverageSnapshotTotalsSchema = z.object({
  groups: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    labels: z.object({
      ru: PolicyLabel,
      az: PolicyLabel,
      en: PolicyLabel,
    }).strict().optional(),
    order: z.number().int().min(0),
    subjectType: z.enum(["DOCTOR", "PHARMACY"]),
    populationCount: z.number().int().min(0),
    requiredCoverage: CoverageValueText,
    actualMoi: CoverageValueText,
    target: CoverageValueText,
    actualCoverage: CoverageValueText,
    uncoveredMoi: CoverageValueText,
  }).strict()).max(100),
  overall: z.object({
    populationCount: z.number().int().min(0),
    requiredCoverage: CoverageValueText,
    actualMoi: CoverageValueText,
    target: CoverageValueText,
    actualCoverage: CoverageValueText,
    uncoveredMoi: CoverageValueText,
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const keys = value.groups.map((group) => group.key)
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: "custom", path: ["groups"], message: "Coverage total group keys must be unique" })
  }
  const orders = value.groups.map((group) => group.order)
  if (new Set(orders).size !== orders.length) {
    ctx.addIssue({ code: "custom", path: ["groups"], message: "Coverage total group order values must be unique" })
  }
})

export const CoverageSnapshotCompletenessSchema = z.object({
  schemaVersion: z.literal(1),
  complete: z.boolean(),
  expectedRows: z.number().int().min(0),
  persistedRows: z.number().int().min(0),
  missingSources: z.array(z.string().trim().min(1).max(120)).max(100),
  warnings: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
}).strict()

const CoverageSnapshotEvidence = z.record(z.string(), z.unknown()).refine(
  (value) => Object.keys(value).length > 0,
  "Snapshot evidence is required",
)

export const CoverageSnapshotExplanationSchema = z.object({
  summary: z.object({
    ru: PolicyLabel,
    az: PolicyLabel,
    en: PolicyLabel,
  }).strict(),
}).catchall(z.unknown())

export const CoverageSnapshotImportRowSchema = z.object({
  subjectType: z.enum(["DOCTOR", "PHARMACY"]),
  subjectId: z.string().trim().min(1).max(200),
  subjectName: z.string().trim().min(1).max(500),
  customerId: z.string().trim().min(1).max(200).optional(),
  customerName: z.string().trim().min(1).max(500).optional(),
  groupKey: z.string().trim().min(1).max(80),
  categoryCode: z.string().trim().min(1).max(120).optional(),
  categoryLabel: z.string().trim().min(1).max(300).optional(),
  specialtyCode: z.string().trim().min(1).max(120).optional(),
  specialtyName: z.string().trim().min(1).max(300).optional(),
  requiredCoverage: CoverageValueText,
  actualMoi: CoverageValueText,
  target: CoverageValueText,
  actualCoverage: CoverageValueText,
  uncoveredMoi: CoverageValueText,
  explanation: CoverageSnapshotExplanationSchema,
  planningContext: CoverageSnapshotEvidence,
  sourceEvidence: CoverageSnapshotEvidence,
}).strict()

export const CoverageSnapshotImportSchema = z.object({
  policyId: z.string().trim().min(1).max(200),
  expectedDefinitionHash: Sha256,
  agentId: z.string().trim().min(1).max(200),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  sourceCutoffAt: z.string().datetime({ offset: true }),
  sourceFreshnessAt: z.string().datetime({ offset: true }).optional(),
  sourceBatchReference: z.string().trim().min(1).max(500),
  rows: z.array(CoverageSnapshotImportRowSchema).min(1).max(10_000),
}).strict().superRefine((value, ctx) => {
  if (value.periodEnd < value.periodStart) {
    ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "periodEnd must not precede periodStart" })
  }
  if (
    value.sourceFreshnessAt
    && new Date(value.sourceFreshnessAt).getTime() > new Date(value.sourceCutoffAt).getTime()
  ) {
    ctx.addIssue({ code: "custom", path: ["sourceFreshnessAt"], message: "sourceFreshnessAt cannot follow sourceCutoffAt" })
  }
  const subjectKeys = value.rows.map((row) => `${row.subjectType}:${row.subjectId}`)
  if (new Set(subjectKeys).size !== subjectKeys.length) {
    ctx.addIssue({ code: "custom", path: ["rows"], message: "Snapshot subjects must be unique" })
  }
  value.rows.forEach((row, index) => {
    if (row.subjectType === "PHARMACY" && row.customerId && row.customerId !== row.subjectId) {
      ctx.addIssue({
        code: "custom",
        path: ["rows", index, "customerId"],
        message: "Pharmacy subjectId and customerId must match",
      })
    }
  })
})

export function coverageSnapshotIsComplete(value: unknown): boolean {
  const parsed = CoverageSnapshotCompletenessSchema.safeParse(value)
  return parsed.success
    && parsed.data.complete
    && parsed.data.expectedRows === parsed.data.persistedRows
    && parsed.data.missingSources.length === 0
}

const TOTAL_METRICS = [
  "requiredCoverage",
  "actualMoi",
  "target",
  "actualCoverage",
  "uncoveredMoi",
] as const

function decimalScale4(value: string): bigint {
  const negative = value.startsWith("-")
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".")
  const scaled = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"))
  return negative ? -scaled : scaled
}

export function coverageSnapshotTotalsReconcile(value: unknown): boolean {
  const parsed = CoverageSnapshotTotalsSchema.safeParse(value)
  if (!parsed.success) return false
  const populationCount = parsed.data.groups.reduce((sum, group) => sum + group.populationCount, 0)
  if (populationCount !== parsed.data.overall.populationCount) return false
  return TOTAL_METRICS.every((metric) => (
    parsed.data.groups.reduce((sum, group) => sum + decimalScale4(group[metric]), 0n)
      === decimalScale4(parsed.data.overall[metric])
  ))
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(canonicalValue)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  )
}

export function canonicalCoveragePolicyJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function coveragePolicyHash(value: unknown): string {
  return createHash("sha256").update(canonicalCoveragePolicyJson(value)).digest("hex")
}

export function coveragePolicySignatureIsCoherent(policy: {
  status: string
  definition: unknown
  definitionHash: string
  approvalReference: string | null
  signedByUserId: string | null
  signedAt: Date | null
  activatedAt: Date | null
  retiredAt: Date | null
}): boolean {
  const definition = CoveragePolicyDefinitionSchema.safeParse(policy.definition)
  if (!definition.success || policy.definitionHash !== coveragePolicyHash(definition.data)) return false
  if (!policy.approvalReference?.trim() || !policy.signedByUserId || !policy.signedAt || !policy.activatedAt) return false
  return policy.status === "ACTIVE" ? policy.retiredAt === null : policy.status === "RETIRED" && policy.retiredAt !== null
}
