import { prisma, logAudit } from "@/lib/prisma"
import type { Role } from "@/lib/permissions"
import { voenInput } from "@/lib/companies/az-taxpayer-registry"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { createContactCommand } from "@/lib/crm-commands/contact/contact"
import type { CrmCommandPostCommitEffect } from "@/lib/crm-commands/execution-context"
import { isSupportedProductCurrency, MAX_PRODUCT_PRICE } from "@/lib/products/pricing"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { SUPPLIER_CATEGORY } from "@/lib/procurement/suppliers"
import { IMPORT_FIELDS, type ImportEntity } from "./entities"
import type { Sheet } from "./spreadsheet"

/**
 * Turning the rows of a customer's spreadsheet into CRM records (task 7.4).
 *
 * - Every row is checked first; with `dryRun` nothing is written and the
 *   screen shows what would happen.
 * - A row that matches what is already there — by VÖEN or name for a company,
 *   e-mail or phone for a contact, code or name for a product, in the CRM or
 *   earlier in the same file — is skipped, never doubled and never overwritten.
 * - An import is a transfer, not activity: contacts are written through the
 *   ordinary contact command (field rights, the plan's limit, the company
 *   check) but its follow-ups — automations, welcome bonuses, notifications,
 *   webhooks — are not fired for hundreds of old contacts. One journal row
 *   names the import.
 */
export interface ImportOutcome {
  total: number
  /** Written — or, with `dryRun`, that would be written. */
  created: number
  duplicateCount: number
  errorCount: number
  /** The first 200 of each, with the spreadsheet row number (the header is row 1). */
  duplicates: { row: number; value: string }[]
  errors: { row: number; message: string }[]
}

const LIST_CAP = 200
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const lower = (value: string) => value.trim().toLowerCase()
const phoneKey = (value: string) => value.replace(/\D/g, "").slice(-9)

function parsePrice(value: string): number | null {
  if (!value.trim()) return 0
  const cleaned = value.replace(/\s/g, "").replace(/(\d),(\d{1,2})$/, "$1.$2").replace(/,/g, "")
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRODUCT_PRICE ? n : null
}

export function validateMapping(entity: ImportEntity, headers: readonly string[], mapping: readonly (string | null)[]): string | null {
  if (mapping.length !== headers.length) return "The mapping does not match the columns"
  const keys = IMPORT_FIELDS[entity].map((field) => field.key)
  const used = mapping.filter((key): key is string => !!key)
  if (used.some((key) => !keys.includes(key))) return "Unknown field"
  if (new Set(used).size !== used.length) return "A field is chosen twice"
  const missing = IMPORT_FIELDS[entity].filter((field) => field.required && !used.includes(field.key))
  if (missing.length > 0) return `Choose the column for: ${missing.map((field) => field.key).join(", ")}`
  return null
}

export async function applyImport(input: {
  orgId: string
  userId: string
  role: Role
  entity: ImportEntity
  sheet: Sheet
  mapping: (string | null)[]
  dryRun: boolean
}): Promise<ImportOutcome> {
  const { orgId, entity, sheet, mapping } = input
  const outcome: ImportOutcome = { total: sheet.rows.length, created: 0, duplicateCount: 0, errorCount: 0, duplicates: [], errors: [] }
  const records = sheet.rows.map((cells) => {
    const record: Record<string, string> = {}
    mapping.forEach((key, i) => { if (key && cells[i]?.trim()) record[key] = cells[i].trim() })
    return record
  })
  const error = (row: number, message: string) => { if (outcome.errors.length < LIST_CAP) outcome.errors.push({ row, message }) }
  const duplicate = (row: number, value: string) => { if (outcome.duplicates.length < LIST_CAP) outcome.duplicates.push({ row, value }) }
  let duplicateCount = 0
  let errorCount = 0

  if (entity === "companies" || entity === "suppliers") {
    const existing: { name: string; voen: string | null }[] = await prisma.company.findMany({ where: { organizationId: orgId }, select: { name: true, voen: true } })
    const names = new Set(existing.map((row) => lower(row.name)))
    const voens = new Set(existing.map((row) => row.voen).filter((v): v is string => !!v))
    const toCreate: { row: number; data: Record<string, unknown> }[] = []
    records.forEach((record, index) => {
      const row = index + 2
      if (!record.name) { errorCount += 1; return error(row, "name") }
      const voen = voenInput(record.voen ?? null)
      if (!voen.ok) { errorCount += 1; return error(row, "voen") }
      if (record.email && !EMAIL.test(record.email)) { errorCount += 1; return error(row, "email") }
      if ((voen.value && voens.has(voen.value)) || names.has(lower(record.name))) { duplicateCount += 1; return duplicate(row, record.name) }
      names.add(lower(record.name))
      if (voen.value) voens.add(voen.value)
      toCreate.push({
        row,
        data: {
          organizationId: orgId,
          name: record.name.slice(0, 200),
          category: entity === "suppliers" ? SUPPLIER_CATEGORY : "client",
          status: "active",
          voen: voen.value ?? null,
          phone: record.phone?.slice(0, 60) ?? null,
          email: record.email?.slice(0, 200) ?? null,
          website: record.website?.slice(0, 300) ?? null,
          address: record.address?.slice(0, 500) ?? null,
          city: record.city?.slice(0, 120) ?? null,
          industry: record.industry?.slice(0, 120) ?? null,
          director: record.director?.slice(0, 200) ?? null,
          description: record.description?.slice(0, 2000) ?? null,
        },
      })
    })
    if (!input.dryRun) {
      for (let i = 0; i < toCreate.length; i += 500) {
        const chunk = toCreate.slice(i, i + 500)
        const result = await prisma.company.createMany({ data: chunk.map((item) => item.data) })
        outcome.created += result.count
      }
    } else {
      outcome.created = toCreate.length
    }
  } else if (entity === "contacts") {
    const [contacts, companies]: [{ email: string | null; phone: string | null }[], { id: string; name: string }[]] = await Promise.all([
      prisma.contact.findMany({ where: { organizationId: orgId }, select: { email: true, phone: true } }),
      prisma.company.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    ])
    const emails = new Set(contacts.map((row) => row.email && lower(row.email)).filter((v): v is string => !!v))
    const phones = new Set(contacts.map((row) => row.phone && phoneKey(row.phone)).filter((v): v is string => !!v && v.length >= 7))
    const companyByName = new Map(companies.map((row) => [lower(row.name), row.id]))
    const toCreate: { row: number; data: Record<string, unknown> }[] = []
    records.forEach((record, index) => {
      const row = index + 2
      if (!record.fullName) { errorCount += 1; return error(row, "fullName") }
      if (record.email && !EMAIL.test(record.email)) { errorCount += 1; return error(row, "email") }
      const phone = record.phone ? phoneKey(record.phone) : ""
      if ((record.email && emails.has(lower(record.email))) || (phone.length >= 7 && phones.has(phone))) { duplicateCount += 1; return duplicate(row, record.fullName) }
      if (record.email) emails.add(lower(record.email))
      if (phone.length >= 7) phones.add(phone)
      const companyId = record.companyName ? companyByName.get(lower(record.companyName)) : undefined
      toCreate.push({
        row,
        data: {
          fullName: record.fullName.slice(0, 200),
          ...(record.email ? { email: record.email } : {}),
          ...(record.phone ? { phone: record.phone } : {}),
          ...(record.position ? { position: record.position.slice(0, 200) } : {}),
          ...(record.category ? { category: record.category.slice(0, 60) } : {}),
          source: record.source?.slice(0, 60) || "import",
          ...(companyId ? { companyId } : {}),
        },
      })
    })
    if (!input.dryRun) {
      const actor = createRestActorContext({ organizationId: orgId, userId: input.userId, role: input.role })
      for (let i = 0; i < toCreate.length; i += 100) {
        const chunk = toCreate.slice(i, i + 100)
        // The follow-ups are collected and dropped on purpose (see the header).
        const effects: CrmCommandPostCommitEffect[] = []
        try {
          await prisma.$transaction(async (tx) => {
            for (const item of chunk) await createContactCommand(actor, item.data, { transaction: tx, postCommitEffects: effects })
          })
          outcome.created += chunk.length
        } catch (failure) {
          // One bad row must not lose the rest of the chunk: write them one by one.
          for (const item of chunk) {
            const single: CrmCommandPostCommitEffect[] = []
            try {
              await prisma.$transaction(async (tx) => { await createContactCommand(actor, item.data, { transaction: tx, postCommitEffects: single }) })
              outcome.created += 1
            } catch (rowFailure) {
              errorCount += 1
              error(item.row, rowFailure instanceof Error ? rowFailure.message : String(failure))
            }
          }
        }
      }
    } else {
      outcome.created = toCreate.length
    }
  } else {
    const existing: { name: string; sku: string | null }[] = await prisma.product.findMany({ where: { organizationId: orgId }, select: { name: true, sku: true } })
    const names = new Set(existing.map((row) => lower(row.name)))
    const skus = new Set(existing.map((row) => row.sku && lower(row.sku)).filter((v): v is string => !!v))
    const toCreate: Record<string, unknown>[] = []
    records.forEach((record, index) => {
      const row = index + 2
      if (!record.name) { errorCount += 1; return error(row, "name") }
      const price = parsePrice(record.price ?? "")
      if (price === null) { errorCount += 1; return error(row, "price") }
      const currency = (record.currency || DEFAULT_CURRENCY).toUpperCase()
      if (!isSupportedProductCurrency(currency)) { errorCount += 1; return error(row, "currency") }
      if ((record.sku && skus.has(lower(record.sku))) || (!record.sku && names.has(lower(record.name)))) { duplicateCount += 1; return duplicate(row, record.name) }
      names.add(lower(record.name))
      if (record.sku) skus.add(lower(record.sku))
      toCreate.push({
        organizationId: orgId,
        name: record.name.slice(0, 300),
        sku: record.sku?.slice(0, 64) ?? null,
        price,
        currency,
        category: record.category?.slice(0, 60) || "product",
        description: record.description?.slice(0, 2000) ?? null,
      })
    })
    if (!input.dryRun) {
      for (let i = 0; i < toCreate.length; i += 500) {
        outcome.created += (await prisma.product.createMany({ data: toCreate.slice(i, i + 500) })).count
      }
    } else {
      outcome.created = toCreate.length
    }
  }

  if (!input.dryRun) {
    logAudit(orgId, "import", entity, orgId, `${entity} import`, { newValue: { rows: outcome.total, created: outcome.created, duplicates: duplicateCount, errors: errorCount }, userId: input.userId })
  }
  return { ...outcome, duplicateCount, errorCount }
}
