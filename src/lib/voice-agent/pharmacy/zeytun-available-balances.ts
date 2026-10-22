import { createHash } from "node:crypto"
import { TextDecoder } from "node:util"
import { z } from "zod"

import { PharmacyOrderError } from "./contracts"
import { PharmacyNameSearch } from "./name-search"

export const ZEYTUN_BALANCES_MAX_BYTES = 25 * 1024 * 1024
const text = z.string().trim().max(512)
const guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform((value) => value.toLowerCase())
const productGuid = guid.refine((value) => value !== "00000000-0000-0000-0000-000000000000")
function decimal(scale: number) {
  return z.number().finite().nonnegative().max(1_000_000_000)
    .refine((value) => Number(value.toFixed(scale)) === value)
    // Preserve the observed decimal value; never do price arithmetic in floats.
    .transform((value) => value.toFixed(scale).replace(/\.?0+$/, ""))
}
const reference = z.object({ Наименование: text, Guid: guid })
const rowSchema = z.object({
  Номенклатура: z.object({
    Наименование: text.min(1), НаименованиеАз: text,
    Guid: productGuid, Номер: text.min(1),
    БазоваяЕдиницаИзмерения: text.min(1),
    КолУпак: z.number().int().positive().max(1_000_000),
    Психотропное: z.boolean(), Сильнодействующее: z.boolean(), Дефектура: z.boolean(),
    РеферентныйПрепарат: z.boolean(), РекламнаяАкция: z.boolean(),
    ДействительноС: z.string().regex(/^\d{8}$/), ДействительноДо: z.string().regex(/^\d{8}$/),
    Купи: z.number().int().nonnegative().max(1_000_000),
    Получи: z.number().int().nonnegative().max(1_000_000),
    ВидНоменклатуры: reference, ОтделениеСклада: reference,
    ФармакологическиеНаименования: reference,
    МассивШтрихкодов: z.array(z.object({ ТипШтрихкода: text, Штрихкод: text })).max(100),
  }),
  Количество: decimal(6), Цена: decimal(4), РеферентЦена: decimal(4).optional(),
})
const responseSchema = z.object({
  code: z.literal(0),
  data: z.object({ goods: z.array(rowSchema).min(1).max(50_000) }),
})
const contextSchema = z.strictObject({
  organizationId: z.string().trim().min(1).max(128),
  observedAt: z.iso.datetime({ offset: true }),
  source: z.enum(["attachment", "live"]),
})
export type ZeytunBalancesContext = z.infer<typeof contextSchema>
const querySchema = z.strictObject({
  text: text.min(1).max(240).optional(),
  externalId: productGuid.optional(),
  itemCode: text.min(1).optional(),
  barcode: text.min(1).optional(),
}).refine((value) => Object.values(value).filter((item) => item !== undefined).length === 1)

type WireRow = z.infer<typeof rowSchema>
function mapRow(row: WireRow) {
  const item = row.Номенклатура
  return {
    externalId: item.Guid, itemCode: item.Номер,
    name: item.Наименование, nameAz: item.НаименованиеАз || null,
    baseUnitAsReported: item.БазоваяЕдиницаИзмерения,
    packQuantityAsReported: item.КолУпак,
    quantityAsReported: row.Количество,
    priceAsReported: row.Цена,
    referencePriceAsReported: row.РеферентЦена ?? null,
    currency: null,
    category: { id: item.ВидНоменклатуры.Guid, name: item.ВидНоменклатуры.Наименование },
    warehouseSection: { id: item.ОтделениеСклада.Guid, name: item.ОтделениеСклада.Наименование },
    pharmacologicalName: item.ФармакологическиеНаименования.Наименование || null,
    // The supplied export contains empty barcode slots. Keep the SKU, but
    // never index an empty code or pretend that it identifies a product.
    barcodes: item.МассивШтрихкодов.filter((entry) => entry.Штрихкод.length > 0)
      .map((entry) => ({ type: entry.ТипШтрихкода, value: entry.Штрихкод })),
    omittedEmptyBarcodeCount: item.МассивШтрихкодов.filter((entry) => !entry.Штрихкод).length,
    sourceFlags: {
      psychotropic: item.Психотропное, potent: item.Сильнодействующее,
      defectura: item.Дефектура, referenceProduct: item.РеферентныйПрепарат,
    },
    promotionAsReported: {
      enabled: item.РекламнаяАкция, buy: item.Купи, get: item.Получи,
      // Sentinel/format are preserved; these dates do not date the stock feed.
      validFromRaw: item.ДействительноС, validToRaw: item.ДействительноДо,
    },
    // Full names and categories are discovery labels, not verified identity slots.
    identityVerified: false as const,
    quantityUnitVerified: false as const,
    customerPriceVerified: false as const,
    requiresOperatorReview: true as const,
  }
}
export type ZeytunBalanceCandidate = ReturnType<typeof mapRow>

/**
 * Search-only feed. It deliberately cannot satisfy PharmacyCatalog's complete
 * snapshot contract or authorize a quote, reserve, substitution or order.
 * A replacement is constructed completely before the caller swaps its cache.
 */
export class ZeytunAvailableBalances {
  private readonly context: ZeytunBalancesContext
  private readonly version: string
  private readonly byteLength: number
  private readonly items = new Map<string, ZeytunBalanceCandidate>()
  private readonly codes = new Map<string, Set<string>>()
  private readonly barcodes = new Map<string, Set<string>>()
  private readonly names = new PharmacyNameSearch(true)

  constructor(payload: string | Uint8Array, context: ZeytunBalancesContext) {
    const checkedContext = contextSchema.safeParse(context)
    if (!checkedContext.success) throw new PharmacyOrderError("invalid_catalog")
    this.context = checkedContext.data
    this.byteLength = typeof payload === "string" ? Buffer.byteLength(payload, "utf8") : payload.byteLength
    if (this.byteLength === 0 || this.byteLength > ZEYTUN_BALANCES_MAX_BYTES) {
      throw new PharmacyOrderError("invalid_catalog")
    }
    let data: unknown
    try {
      const json = typeof payload === "string" ? payload : new TextDecoder("utf-8", { fatal: true }).decode(payload)
      data = JSON.parse(json.replace(/^\uFEFF/, ""))
    } catch {
      throw new PharmacyOrderError("invalid_catalog")
    }
    const parsed = responseSchema.safeParse(data)
    if (!parsed.success) throw new PharmacyOrderError("invalid_catalog")
    this.version = createHash("sha256").update(payload).digest("hex")
    for (const row of parsed.data.data.goods) {
      const item = mapRow(row)
      // Do not sum repeated rows: their warehouse/lot semantics are unverified.
      if (this.items.has(item.externalId)) throw new PharmacyOrderError("invalid_catalog")
      this.items.set(item.externalId, item)
      this.names.add(item.externalId, item.name)
      if (item.nameAz) this.names.add(item.externalId, item.nameAz)
      this.addLookup(this.codes, item.itemCode, item.externalId)
      for (const barcode of item.barcodes) this.addLookup(this.barcodes, barcode.value, item.externalId)
      // Pharmacological names are not aliases: one substance can have many SKUs.
    }
  }

  summary(organizationId: string) {
    this.assertScope(organizationId)
    const items = [...this.items.values()]
    return {
      version: this.version, ...this.context, byteLength: this.byteLength, itemCount: items.length,
      missingAzNameCount: items.filter((item) => !item.nameAz).length,
      fractionalQuantityCount: items.filter((item) => item.quantityAsReported.includes(".")).length,
      zeroPriceCount: items.filter((item) => item.priceAsReported === "0").length,
      flaggedRestrictionCount: items.filter((item) => item.sourceFlags.psychotropic || item.sourceFlags.potent).length,
      omittedEmptyBarcodeCount: items.reduce((sum, item) => sum + item.omittedEmptyBarcodeCount, 0),
      coverage: "unverified" as const, sourceGeneratedAt: null,
      canSubmitTo1c: false as const,
    }
  }

  search(organizationId: string, query: unknown) {
    this.assertScope(organizationId)
    const parsed = querySchema.safeParse(query)
    if (!parsed.success) throw new PharmacyOrderError("invalid_request")
    const request = parsed.data
    let ids: string[]
    if (request.externalId) ids = this.items.has(request.externalId) ? [request.externalId] : []
    else if (request.itemCode) ids = [...(this.codes.get(request.itemCode) ?? [])]
    else if (request.barcode) ids = [...(this.barcodes.get(request.barcode) ?? [])]
    else ids = this.names.find(request.text!)
    return {
      catalogVersion: this.version, observedAt: this.context.observedAt, source: this.context.source,
      sourceGeneratedAt: null, coverage: "unverified" as const,
      status: ids.length ? "candidates_only" as const : "not_found_in_snapshot" as const,
      candidateCount: ids.length,
      candidates: ids.slice(0, 5).map((id) => structuredClone(this.items.get(id)!)),
      canResolveIdentity: false as const, canSubmitTo1c: false as const,
    }
  }

  private assertScope(organizationId: string): void {
    if (organizationId !== this.context.organizationId) throw new PharmacyOrderError("tenant_mismatch")
  }

  private addLookup(index: Map<string, Set<string>>, key: string, id: string): void {
    const values = index.get(key) ?? new Set<string>()
    values.add(id)
    index.set(key, values)
  }
}
