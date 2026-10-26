/**
 * Electronic invoices (e-qaimə) as the LeadDrive Chrome extension hands them
 * over after reading them from new.e-taxes.gov.az in an accountant's browser.
 *
 * The extension sends what the portal said, line by line. What this module
 * decides, so that no client has to be trusted with it:
 *   - which side the counterparty is on (we are the buyer of an incoming
 *     invoice and the seller of an outgoing one, and the signed-in company must
 *     be that side);
 *   - the totals, summed here from the lines. The portal's `vat18` is the base
 *     taxed at 18 %, not the tax: the tax is 18 % of it. Amounts keep the six
 *     decimals the portal writes (222.711876), so nothing is rounded on the way
 *     in.
 */
import { Prisma } from "@prisma/client"
import { z } from "zod"

export const E_QAIME_DIRECTIONS = ["inbox", "outbox"] as const
export type EQaimeDirection = (typeof E_QAIME_DIRECTIONS)[number]

/** Up to this many invoices per request: one request stays well under a second of work. */
export const E_QAIME_IMPORT_BATCH = 50
/** A portal PDF is tens of kilobytes; this leaves room for a long one. */
export const E_QAIME_PDF_MAX_BYTES = 5 * 1024 * 1024

const VOEN = /^\d{10}$/
const SERIAL = /^[A-Z]{2}[0-9A-Z]{6,20}$/

/** A number as the portal writes it: a JSON number or a numeric string. */
const amount = z.union([z.number().finite(), z.string().trim().regex(/^-?\d+(\.\d+)?$/)])
const optionalAmount = amount.nullish()

const party = z.object({
  voen: z.string().trim().max(20).nullish(),
  name: z.string().trim().max(500).default(""),
})

const lineSchema = z.object({
  name: z.string().trim().max(1000).default(""),
  code: z.string().trim().max(32).nullish(),
  /** "good" or "service", as the portal's product group says. */
  productType: z.string().trim().max(20).nullish(),
  unit: z.string().trim().max(50).nullish(),
  quantity: optionalAmount,
  price: optionalAmount,
  /** The line's amount before taxes. */
  cost: amount,
  /** The base taxed at 18 % (not the tax). */
  vat18: optionalAmount,
  vat0: optionalAmount,
  vatFree: optionalAmount,
  exempt: optionalAmount,
  excise: optionalAmount,
  exciseRate: optionalAmount,
  roadTax: optionalAmount,
  sourceSerial: z.string().trim().max(32).nullish(),
})

export const eQaimeInvoiceSchema = z.object({
  portalId: z.string().trim().min(1).max(100),
  priorSystem: z.boolean().default(false),
  sourceSystem: z.string().trim().max(40).nullish(),
  direction: z.enum(E_QAIME_DIRECTIONS),
  serialNumber: z.string().trim().toUpperCase().regex(SERIAL),
  kind: z.string().trim().max(60).nullish(),
  docType: z.string().trim().max(40).nullish(),
  status: z.string().trim().min(1).max(60),
  issuedAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/)),
  sender: party,
  receiver: party,
  comment: z.string().max(4000).nullish(),
  comment2: z.string().max(4000).nullish(),
  sourceSerials: z.array(z.string().trim().max(32)).max(50).default([]),
  items: z.array(lineSchema).max(1000),
})

export const eQaimeImportSchema = z.object({
  /** The company signed in to the portal, from the portal's own pass. */
  own: z.object({
    voen: z.string().trim().regex(VOEN),
    name: z.string().trim().min(1).max(500),
  }),
  invoices: z.array(eQaimeInvoiceSchema).min(1).max(E_QAIME_IMPORT_BATCH),
})

export type EQaimeInvoiceInput = z.infer<typeof eQaimeInvoiceSchema>
export type EQaimeImportInput = z.infer<typeof eQaimeImportSchema>
export type EQaimeLine = z.infer<typeof lineSchema>

const dec = (value: unknown): Prisma.Decimal =>
  value === null || value === undefined || value === "" ? new Prisma.Decimal(0) : new Prisma.Decimal(String(value))

export interface EQaimeTotals {
  net: Prisma.Decimal
  vat: Prisma.Decimal
  excise: Prisma.Decimal
  roadTax: Prisma.Decimal
  total: Prisma.Decimal
}

/** The invoice's sums, from its lines. VAT is 18 % of each line's 18 % base. */
export function eQaimeTotals(items: readonly EQaimeLine[]): EQaimeTotals {
  let net = new Prisma.Decimal(0)
  let vat = new Prisma.Decimal(0)
  let excise = new Prisma.Decimal(0)
  let roadTax = new Prisma.Decimal(0)
  for (const line of items) {
    net = net.plus(dec(line.cost))
    vat = vat.plus(dec(line.vat18).times("0.18"))
    excise = excise.plus(dec(line.excise))
    roadTax = roadTax.plus(dec(line.roadTax))
  }
  const round = (d: Prisma.Decimal) => d.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
  return {
    net: round(net),
    vat: round(vat),
    excise: round(excise),
    roadTax: round(roadTax),
    total: round(net.plus(vat).plus(excise).plus(roadTax)),
  }
}

/**
 * The other side of the invoice, or why it cannot be filed under this company:
 * an incoming invoice must be addressed to it, an outgoing one issued by it.
 */
export function eQaimeCounterparty(
  invoice: Pick<EQaimeInvoiceInput, "direction" | "sender" | "receiver">,
  ownVoen: string,
): { ok: true; voen: string | null; name: string } | { ok: false } {
  const ours = invoice.direction === "inbox" ? invoice.receiver : invoice.sender
  const theirs = invoice.direction === "inbox" ? invoice.sender : invoice.receiver
  if ((ours.voen ?? "").trim() !== ownVoen) return { ok: false }
  const voen = (theirs.voen ?? "").trim()
  return { ok: true, voen: VOEN.test(voen) ? voen : null, name: theirs.name.trim() }
}

/** The lines as stored: the fields above, numbers kept as the strings they were. */
export function storedLines(items: readonly EQaimeLine[]): Prisma.InputJsonValue {
  return items.map((line) => {
    const out: Record<string, string | null> = {}
    for (const [key, value] of Object.entries(line)) {
      out[key] = value === null || value === undefined ? null : String(value)
    }
    return out
  })
}

/** Rows for the screen: amounts as strings, so six decimals survive JSON. */
export function eQaimeRow(row: {
  id: string
  direction: string
  serialNumber: string
  kind: string | null
  docType: string | null
  status: string
  issuedAt: Date
  ownVoen: string
  ownName: string
  counterpartyVoen: string | null
  counterpartyName: string
  counterpartyCompanyId: string | null
  counterpartyCompany?: { id: string; name: string } | null
  netAmount: Prisma.Decimal
  vatAmount: Prisma.Decimal
  exciseAmount: Prisma.Decimal
  roadTaxAmount: Prisma.Decimal
  totalAmount: Prisma.Decimal
  sourceSerials: string[]
  pdfFile: string | null
  portalSyncedAt: Date
}) {
  return {
    id: row.id,
    direction: row.direction,
    serialNumber: row.serialNumber,
    kind: row.kind,
    docType: row.docType,
    status: row.status,
    issuedAt: row.issuedAt.toISOString(),
    ownVoen: row.ownVoen,
    ownName: row.ownName,
    counterpartyVoen: row.counterpartyVoen,
    counterpartyName: row.counterpartyName,
    company: row.counterpartyCompany ? { id: row.counterpartyCompany.id, name: row.counterpartyCompany.name } : null,
    netAmount: row.netAmount.toString(),
    vatAmount: row.vatAmount.toString(),
    exciseAmount: row.exciseAmount.toString(),
    roadTaxAmount: row.roadTaxAmount.toString(),
    totalAmount: row.totalAmount.toString(),
    sourceSerials: row.sourceSerials,
    hasPdf: Boolean(row.pdfFile),
    portalSyncedAt: row.portalSyncedAt.toISOString(),
  }
}

/** `YYYY-MM-DD` → the start of that day, UTC; anything else → null. */
export function dayStart(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** The filter the list, the tiles and the Excel file share. */
export function eQaimeWhere(orgId: string, params: URLSearchParams): Prisma.EQaimeInvoiceWhereInput {
  const from = dayStart(params.get("from"))
  const toDay = dayStart(params.get("to"))
  const to = toDay ? new Date(toDay.getTime() + 24 * 60 * 60 * 1000) : null
  const q = (params.get("q") ?? "").trim().slice(0, 100)
  const status = (params.get("status") ?? "").trim().slice(0, 60)
  const ownVoen = (params.get("own") ?? "").trim()
  return {
    organizationId: orgId,
    ...(from || to ? { issuedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(status ? { status } : {}),
    ...(VOEN.test(ownVoen) ? { ownVoen } : {}),
    ...(q
      ? {
          OR: [
            { counterpartyName: { contains: q, mode: "insensitive" as const } },
            { counterpartyVoen: { contains: q } },
            { serialNumber: { contains: q.toUpperCase() } },
          ],
        }
      : {}),
  }
}
