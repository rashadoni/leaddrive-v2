import { createHash } from "node:crypto"
import { z } from "zod"

const DictionaryLabel = z.string().trim().min(1).max(200)
const DictionaryCode = z.string().trim().min(1).max(80).regex(/^[A-Z0-9][A-Z0-9_-]*$/)
const Sha256 = z.string().regex(/^[a-fA-F0-9]{64}$/)

export const ContactDictionaryKindSchema = z.enum([
  "PSYCHOTYPE",
  "PRODUCT_CATEGORY",
  "BRAND_CATEGORY",
  "TASK_GROUP",
])

export const ContactDictionaryEntrySchema = z.object({
  code: DictionaryCode,
  order: z.number().int().min(0).max(100_000),
  labels: z.object({
    ru: DictionaryLabel,
    az: DictionaryLabel,
    en: DictionaryLabel,
  }).strict(),
  description: z.object({
    ru: z.string().trim().max(500),
    az: z.string().trim().max(500),
    en: z.string().trim().max(500),
  }).strict().optional(),
}).strict()

export const ContactDictionaryEntriesSchema = z.array(ContactDictionaryEntrySchema)
  .min(1)
  .max(500)
  .superRefine((entries, ctx) => {
    const codes = entries.map((entry) => entry.code)
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: "custom", message: "Dictionary entry codes must be unique" })
    }
    const orders = entries.map((entry) => entry.order)
    if (new Set(orders).size !== orders.length) {
      ctx.addIssue({ code: "custom", message: "Dictionary entry order values must be unique" })
    }
  })

export const ContactDictionaryCreateSchema = z.object({
  kind: ContactDictionaryKindSchema,
  version: z.number().int().positive().max(1_000_000),
  nameRu: DictionaryLabel,
  nameAz: DictionaryLabel,
  nameEn: DictionaryLabel,
  entries: ContactDictionaryEntriesSchema,
  sourceSystem: z.string().trim().min(2).max(120),
  sourceReference: z.string().trim().max(500).optional(),
  sourceObservedAt: z.string().datetime({ offset: true }),
  effectiveFrom: z.string().date(),
}).strict()

export const ContactDictionaryActivateSchema = z.object({
  expectedEntriesHash: Sha256,
  approvalReference: z.string().trim().min(3).max(500),
}).strict()

export type ContactDictionaryEntry = z.infer<typeof ContactDictionaryEntrySchema>

export function contactDictionaryHash(entries: ContactDictionaryEntry[]): string {
  const canonical = [...entries]
    .sort((left, right) => left.order - right.order || left.code.localeCompare(right.code))
    .map((entry) => ({
      code: entry.code,
      order: entry.order,
      labels: { ru: entry.labels.ru, az: entry.labels.az, en: entry.labels.en },
      ...(entry.description ? { description: {
        ru: entry.description.ru,
        az: entry.description.az,
        en: entry.description.en,
      } } : {}),
    }))
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

export function contactDictionarySignatureIsCoherent(dictionary: {
  status: string
  approvalReference: string | null
  signedByUserId: string | null
  signedAt: Date | null
  activatedAt: Date | null
  retiredAt: Date | null
}): boolean {
  if (dictionary.status === "DRAFT") {
    return !dictionary.approvalReference && !dictionary.signedByUserId
      && !dictionary.signedAt && !dictionary.activatedAt && !dictionary.retiredAt
  }
  if (dictionary.status === "ACTIVE") {
    return Boolean(dictionary.approvalReference && dictionary.signedByUserId
      && dictionary.signedAt && dictionary.activatedAt && !dictionary.retiredAt)
  }
  if (dictionary.status === "RETIRED") {
    return Boolean(dictionary.approvalReference && dictionary.signedByUserId
      && dictionary.signedAt && dictionary.activatedAt && dictionary.retiredAt)
  }
  return false
}
