import { createHash } from "node:crypto"
import { performance } from "node:perf_hooks"
import { TextDecoder } from "node:util"
import { z } from "zod"

import { PharmacyOrderError } from "./contracts"
import { PharmacyNameSearch } from "./name-search"
import { assortmentExtras, productSound, type ProductSound } from "./zeytun-assortment-ranking"
import { formKey, innKey, parseSubstituteRequest, sameStrength, strengthOf, SUBSTITUTE_PREFIX } from "./zeytun-substitutes"
import { productLeads, PROMOTIONS_PREFIX, ZeytunPromotions } from "./zeytun-promotions"

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
// The rows are checked one by one while the feed is built (rowSchema), so a
// slice of the work can stop between them; the envelope is checked first.
const responseSchema = z.object({
  code: z.literal(0),
  data: z.object({ goods: z.array(z.unknown()).min(1).max(50_000) }),
})
const contextSchema = z.strictObject({
  organizationId: z.string().trim().min(1).max(128),
  observedAt: z.iso.datetime({ offset: true }),
  source: z.enum(["attachment", "live"]),
})
export type ZeytunBalancesContext = z.infer<typeof contextSchema>
export const zeytunBalanceQuerySchema = z.strictObject({
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
 * The parts of a feed label that name the maker and country, not the product:
 * "Адефа № 30 (Таблетки) (Pharmex Rom Industry Srl) (Румыния)" — the last two
 * groups when there are three or more — and "… \*Sopharma Asc , Bolqarıstan\*".
 * Searched like any word, they weigh less than the name (name-search.ts).
 */
function sourceParts(label: string): string[] {
  const groups = [...label.matchAll(/\(([^()]*)\)/gu)].map((match) => match[1])
  const starred = [...label.matchAll(/\\\*([\s\S]*?)\\\*/gu)].map((match) => match[1])
  return [...(groups.length >= 3 ? groups.slice(-2) : []), ...starred]
}

function makersOf(item: { name: string; nameAz: string | null }) {
  return { name: sourceParts(item.name), nameAz: item.nameAz ? sourceParts(item.nameAz) : [] }
}

/** Work between two yields of a build; a call waiting on the web process waits at most about this. */
const BUILD_SLICE_MS = 15
const DEFERRED = Symbol("deferred")

/**
 * Search-only feed. It deliberately cannot satisfy PharmacyCatalog's complete
 * snapshot contract or authorize a quote, reserve, substitution or order.
 * A replacement is constructed completely before the caller swaps its cache.
 */
export class ZeytunAvailableBalances {
  private context!: ZeytunBalancesContext
  private version!: string
  private byteLength!: number
  private readonly items = new Map<string, ZeytunBalanceCandidate>()
  private readonly codes = new Map<string, Set<string>>()
  private readonly barcodes = new Map<string, Set<string>>()
  private readonly names = new PharmacyNameSearch(true)
  private readonly sounds = new Map<string, ProductSound>()
  /** 1C's active substance (INN) → items, for substitutes only. */
  private readonly substances = new Map<string, Set<string>>()
  /** Items with a "buy N, get M" promotion, for `promotions:` only. */
  private readonly promotions = new ZeytunPromotions()

  constructor(payload: string | Uint8Array, context: ZeytunBalancesContext, deferred?: typeof DEFERRED) {
    if (deferred === DEFERRED) return
    const steps = this.ingest(payload, context)
    while (!steps.next().done) continue
  }

  /**
   * The same feed, built on the thread that answers requests without holding
   * it. 2026-10-28 on prod: Zeytun's 14 MB feed took 3.2 s to build, 2.9 s of
   * it the name index, and for those seconds the web process answered nothing
   * (a 7 s gap in nginx's log during the deploy's line warm-up, 3.5 s for the
   * station's call-lifecycle request). Built a slice at a time, the longest
   * hold is the feed's decode or JSON.parse, each one step: 149 ms there.
   */
  static async build(payload: string | Uint8Array, context: ZeytunBalancesContext, sliceMs = BUILD_SLICE_MS) {
    const feed = new ZeytunAvailableBalances(payload, context, DEFERRED)
    const steps = feed.ingest(payload, context)
    for (let sliceStart = performance.now(); !steps.next().done;) {
      if (performance.now() - sliceStart < sliceMs) continue
      await new Promise<void>((resolve) => setImmediate(resolve))
      sliceStart = performance.now()
    }
    return feed
  }

  /** Builds this feed, yielding after each step: decode, parse, and every row. */
  private *ingest(payload: string | Uint8Array, context: ZeytunBalancesContext): Generator<void, void> {
    const checkedContext = contextSchema.safeParse(context)
    if (!checkedContext.success) throw new PharmacyOrderError("invalid_catalog")
    this.context = checkedContext.data
    this.byteLength = typeof payload === "string" ? Buffer.byteLength(payload, "utf8") : payload.byteLength
    if (this.byteLength === 0 || this.byteLength > ZEYTUN_BALANCES_MAX_BYTES) {
      throw new PharmacyOrderError("invalid_catalog")
    }
    let json: string, data: unknown
    try { json = typeof payload === "string" ? payload : new TextDecoder("utf-8", { fatal: true }).decode(payload) }
    catch { throw new PharmacyOrderError("invalid_catalog") }
    yield
    try { data = JSON.parse(json.replace(/^\uFEFF/, "")) }
    catch { throw new PharmacyOrderError("invalid_catalog") }
    yield
    const parsed = responseSchema.safeParse(data)
    if (!parsed.success) throw new PharmacyOrderError("invalid_catalog")
    this.version = createHash("sha256").update(payload).digest("hex")
    for (const wire of parsed.data.data.goods) {
      const row = rowSchema.safeParse(wire)
      if (!row.success) throw new PharmacyOrderError("invalid_catalog")
      const item = mapRow(row.data)
      // Do not sum repeated rows: their warehouse/lot semantics are unverified.
      if (this.items.has(item.externalId)) throw new PharmacyOrderError("invalid_catalog")
      this.items.set(item.externalId, item)
      this.names.add(item.externalId, item.name, sourceParts(item.name))
      if (item.nameAz) this.names.add(item.externalId, item.nameAz, sourceParts(item.nameAz))
      this.addLookup(this.codes, item.itemCode, item.externalId)
      for (const barcode of item.barcodes) this.addLookup(this.barcodes, barcode.value, item.externalId)
      // Pharmacological names are not aliases: one substance can have many SKUs.
      // They are searched only by an explicit substitute request.
      if (item.pharmacologicalName && innKey(item.pharmacologicalName)) this.addLookup(this.substances, innKey(item.pharmacologicalName), item.externalId)
      this.promotions.add(item, makersOf(item))
      yield
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

  /** Every item by its labels, for the list of sold-out products (zeytun-departed-items.ts). */
  labels(organizationId: string) {
    this.assertScope(organizationId)
    return [...this.items.values()].map((item) => ({ externalId: item.externalId, itemCode: item.itemCode, name: item.name,
      nameAz: item.nameAz, baseUnitAsReported: item.baseUnitAsReported }))
  }

  /**
   * `now` dates a `promotions:` request (Baku day); nothing else reads it.
   * `assortment`: the calling pharmacy's products, most ordered first
   * (zeytun-pharmacy-assortment.ts), for a name search only: those the five
   * lack and the words sound like come as `preferredExtra`
   * (zeytun-assortment-ranking.ts). The five are the same with it or without.
   */
  search(organizationId: string, query: unknown, now = Date.now(),
    options: { assortment?: { ordered: readonly string[] } | null; within?: number; margin?: number } = {}) {
    this.assertScope(organizationId)
    const parsed = zeytunBalanceQuerySchema.safeParse(query)
    if (!parsed.success) throw new PharmacyOrderError("invalid_request")
    const request = parsed.data
    let ids: string[], extra: string[] = []
    if (request.externalId) ids = this.items.has(request.externalId) ? [request.externalId] : []
    else if (request.itemCode) ids = [...(this.codes.get(request.itemCode) ?? [])]
    else if (request.barcode) ids = [...(this.barcodes.get(request.barcode) ?? [])]
    else if (SUBSTITUTE_PREFIX.test(request.text!)) ids = this.substitutes(request.text!)
    else if (PROMOTIONS_PREFIX.test(request.text!)) ids = this.promotions.find(request.text!, now, (filter) => this.closestLeads(filter))
    else {
      if (options.assortment?.ordered.length) {
        const rows = this.names.rank(request.text!)
        ids = rows.map((row) => row.id)
        extra = assortmentExtras(request.text!, rows.slice(0, 5), options.assortment.ordered, (id) => this.soundOf(id), options.within, undefined, options.margin)
      } else ids = this.names.find(request.text!)
    }
    return {
      catalogVersion: this.version, observedAt: this.context.observedAt, source: this.context.source,
      sourceGeneratedAt: null, coverage: "unverified" as const,
      status: ids.length ? "candidates_only" as const : "not_found_in_snapshot" as const,
      candidateCount: ids.length,
      candidates: ids.slice(0, 5).map((id) => structuredClone(this.items.get(id)!)),
      // Only when the pharmacy's list adds something: otherwise the result has no such field.
      ...(extra.length ? { preferredExtra: extra.map((id) => structuredClone(this.items.get(id)!)) } : {}),
      canResolveIdentity: false as const, canSubmitTo1c: false as const,
    }
  }

  /**
   * Items with the same active substance, strength and form as asked
   * (`substitute: INN; strength; form`; every known form when the form is
   * left out). Never a psychotropic, potent or out-of-stock item. Without a
   * substance or a strength it finds nothing.
   */
  private substitutes(text: string): string[] {
    const request = parseSubstituteRequest(text)
    if (!request) return []
    return [...(this.substances.get(request.inn) ?? [])].filter((id) => {
      const item = this.items.get(id)!
      if (item.sourceFlags.psychotropic || item.sourceFlags.potent || item.sourceFlags.defectura) return false
      if (request.form ? formKey(item.category.name) !== request.form : !formKey(item.category.name)) return false
      const strength = strengthOf(item.name) ?? (item.nameAz ? strengthOf(item.nameAz) : null)
      return strength !== null && sameStrength(strength, request.strength)
    })
  }

  /** The name the catalog's product closest to a word goes by, for a misheard `promotions:` filter. */
  private closestLeads(filter: string): Set<string> {
    const top = this.names.find(filter)[0]
    const item = top === undefined ? undefined : this.items.get(top)
    return item ? productLeads(item, makersOf(item)) : new Set()
  }

  /** A product as the pharmacy's list compares it, worked out once per product; null when the catalog lacks it. */
  private soundOf(id: string): ProductSound | null {
    const known = this.sounds.get(id)
    if (known) return known
    const item = this.items.get(id)
    if (!item) return null
    const sound = productSound(item)
    this.sounds.set(id, sound)
    return sound
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
