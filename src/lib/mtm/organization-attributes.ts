import { createHash } from "node:crypto"
import { z } from "zod"

const Code = z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f]+$/)
const Label = z.string().trim().min(1).max(200)
const Sha256 = z.string().regex(/^[a-fA-F0-9]{64}$/)

export const OrganizationAttributeLabelsSchema = z.object({
  ru: Label,
  az: Label,
  en: Label,
}).strict()

export const OrganizationAttributeRowSchema = z.object({
  organizationCode: Code,
  medicalCategory: z.object({
    code: Code,
    labels: OrganizationAttributeLabelsSchema,
  }).strict().nullable().optional(),
  license: z.object({
    status: z.enum(["LICENSED", "UNLICENSED", "NOT_REQUIRED"]),
    labels: OrganizationAttributeLabelsSchema,
  }).strict().nullable().optional(),
  polygon: z.object({
    code: Code,
    labels: OrganizationAttributeLabelsSchema,
  }).strict().nullable().optional(),
}).strict().superRefine((row, ctx) => {
  if (!row.medicalCategory && !row.license && !row.polygon) {
    ctx.addIssue({ code: "custom", message: "At least one signed attribute is required" })
  }
})

export const OrganizationAttributeRowsSchema = z.array(OrganizationAttributeRowSchema)
  .min(1)
  .max(50_000)
  .superRefine((rows, ctx) => {
    const codes = rows.map((row) => row.organizationCode)
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: "custom", message: "Organization codes must be unique in a package" })
    }
  })

export const OrganizationAttributePackageCreateSchema = z.object({
  version: z.number().int().positive().max(1_000_000),
  rows: OrganizationAttributeRowsSchema,
  sourceSystem: z.string().trim().min(2).max(120),
  sourceReference: z.string().trim().max(500).optional(),
  sourceObservedAt: z.string().datetime({ offset: true }),
  effectiveFrom: z.string().date(),
}).strict()

export const OrganizationAttributePackageActivateSchema = z.object({
  expectedRowsHash: Sha256,
  approvalReference: z.string().trim().min(3).max(500),
}).strict()

export type OrganizationAttributeLabels = z.infer<typeof OrganizationAttributeLabelsSchema>
export type OrganizationAttributeRow = z.infer<typeof OrganizationAttributeRowSchema>

function canonicalLabels(labels: OrganizationAttributeLabels) {
  return { ru: labels.ru, az: labels.az, en: labels.en }
}

export function organizationAttributeRowsHash(rows: OrganizationAttributeRow[]): string {
  const canonical = [...rows]
    .sort((left, right) => left.organizationCode.localeCompare(right.organizationCode))
    .map((row) => ({
      organizationCode: row.organizationCode,
      medicalCategory: row.medicalCategory ? {
        code: row.medicalCategory.code,
        labels: canonicalLabels(row.medicalCategory.labels),
      } : null,
      license: row.license ? {
        status: row.license.status,
        labels: canonicalLabels(row.license.labels),
      } : null,
      polygon: row.polygon ? {
        code: row.polygon.code,
        labels: canonicalLabels(row.polygon.labels),
      } : null,
    }))
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

export function organizationAttributePackageSignatureIsCoherent(pkg: {
  status: string
  approvalReference: string | null
  signedByUserId: string | null
  signedAt: Date | null
  activatedAt: Date | null
  retiredAt: Date | null
}): boolean {
  if (pkg.status === "DRAFT") {
    return !pkg.approvalReference && !pkg.signedByUserId
      && !pkg.signedAt && !pkg.activatedAt && !pkg.retiredAt
  }
  if (pkg.status === "ACTIVE") {
    return Boolean(pkg.approvalReference?.trim() && pkg.signedByUserId
      && pkg.signedAt && pkg.activatedAt && !pkg.retiredAt)
  }
  if (pkg.status === "RETIRED") {
    return Boolean(pkg.approvalReference?.trim() && pkg.signedByUserId
      && pkg.signedAt && pkg.activatedAt && pkg.retiredAt)
  }
  return false
}

export function organizationAttributeDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function localizedOrganizationAttributeLabel(
  labels: unknown,
  locale: string,
): string | null {
  const parsed = OrganizationAttributeLabelsSchema.safeParse(labels)
  if (!parsed.success) return null
  if (locale.startsWith("az")) return parsed.data.az
  if (locale.startsWith("ru")) return parsed.data.ru
  return parsed.data.en
}
