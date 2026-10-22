import {
  PHARMACY_IDENTITY_FIELDS,
  PharmacyOrderError,
  normalizePharmacyLabel,
  pharmacyCatalogSnapshotSchema,
  pharmacyProductRequestSchema,
  type PharmacyIdentityField,
  type PharmacyProduct,
  type PharmacyProductRequest,
} from "./contracts"

export type PharmacyCandidate = Omit<PharmacyProduct, "organizationId" | "approvedAliases">
type ResolutionBase = {
  catalogVersion: string
  candidates: PharmacyCandidate[]
  // Count BEFORE the five-item presentation limit. Not a confidence score.
  candidateCount: number
}
export type PharmacyResolution = ResolutionBase & (
  | { status: "resolved"; product: PharmacyCandidate }
  | { status: "not_found" }
  | { status: "needs_clarification"; reason: "similar_names" | "missing_attribute" | "ambiguous" | "attribute_conflict"; field?: PharmacyIdentityField | "name" }
  | { status: "needs_review"; reason: "identity_risk" | "incomplete_product" | "inactive_product" }
)

function candidate(product: PharmacyProduct): PharmacyCandidate {
  return {
    externalId: product.externalId, name: product.name,
    strength: product.strength, form: product.form, packSize: product.packSize,
    salesUnit: product.salesUnit, manufacturer: product.manufacturer,
    orderMultiple: product.orderMultiple, active: product.active,
    requiresIdentityReview: product.requiresIdentityReview,
  }
}

function trigrams(text: string): Set<string> {
  const characters = Array.from(`  ${text} `)
  const result = new Set<string>()
  for (let i = 0; i + 2 < characters.length; i++) result.add(characters.slice(i, i + 3).join(""))
  return result
}

/**
 * Offline/pilot index of one complete canonical snapshot. Build once per sync,
 * not once per utterance. No DB, network, price, stock or order side effects.
 * The future synchronizer, not a model/client, is responsible for completeness.
 */
export class PharmacyCatalog {
  readonly version: string
  private readonly organizationId: string
  private readonly capturedAt: number
  private readonly expiresAt: number
  private readonly products = new Map<string, PharmacyProduct>()
  private readonly names = new Map<string, Set<string>>()
  private readonly postings = new Map<string, Set<string>>()
  private readonly termSizes = new Map<string, number>()

  constructor(input: unknown) {
    const parsed = pharmacyCatalogSnapshotSchema.safeParse(input)
    if (!parsed.success) throw new PharmacyOrderError("invalid_catalog")
    const snapshot = parsed.data
    this.organizationId = snapshot.organizationId
    this.version = snapshot.version
    this.capturedAt = Date.parse(snapshot.capturedAt)
    this.expiresAt = Date.parse(snapshot.expiresAt)
    if (this.expiresAt <= this.capturedAt) throw new PharmacyOrderError("invalid_catalog")
    for (const product of snapshot.products) {
      if (product.organizationId !== this.organizationId || this.products.has(product.externalId)) {
        throw new PharmacyOrderError("invalid_catalog")
      }
      this.products.set(product.externalId, product)
      for (const rawName of [product.name, ...product.approvedAliases]) {
        const name = normalizePharmacyLabel(rawName)
        const existing = this.names.get(name)
        if (existing) {
          existing.add(product.externalId)
          continue
        }
        this.names.set(name, new Set([product.externalId]))
        const grams = trigrams(name)
        this.termSizes.set(name, grams.size)
        for (const gram of grams) {
          const terms = this.postings.get(gram) ?? new Set<string>()
          terms.add(name)
          this.postings.set(gram, terms)
        }
      }
    }
  }

  assertUsable(organizationId: string, now: Date): void {
    // Check scope before any search or freshness disclosure.
    if (organizationId !== this.organizationId) throw new PharmacyOrderError("tenant_mismatch")
    const timestamp = now.getTime()
    if (!Number.isFinite(timestamp) || timestamp < this.capturedAt || timestamp >= this.expiresAt) {
      throw new PharmacyOrderError("catalog_unavailable")
    }
  }

  resolve(organizationId: string, input: unknown, now: Date): PharmacyResolution {
    this.assertUsable(organizationId, now)
    const parsed = pharmacyProductRequestSchema.safeParse(input)
    if (!parsed.success) throw new PharmacyOrderError("invalid_request")
    const request = parsed.data
    let pool: PharmacyProduct[]
    if (request.externalId) {
      const product = this.products.get(request.externalId)
      // A bad code must never silently fall back to a similarly named item.
      if (!product) return this.result([], { status: "not_found" })
      pool = [product]
      if (request.name && !this.names.get(normalizePharmacyLabel(request.name))?.has(product.externalId)) {
        return this.result(pool, { status: "needs_clarification", reason: "attribute_conflict", field: "name" })
      }
    } else {
      const name = normalizePharmacyLabel(request.name!)
      const exact = this.names.get(name)
      if (!exact) {
        const suggestions = this.similar(name)
        return suggestions.length
          ? this.result(suggestions, { status: "needs_clarification", reason: "similar_names", field: "name" })
          : this.result([], { status: "not_found" })
      }
      pool = [...exact].map((id) => this.products.get(id)!)
    }

    // Do not filter on stock/activity or history: an unavailable SKU still
    // explains what the customer meant. Unknown metadata cannot exclude it.
    for (const field of PHARMACY_IDENTITY_FIELDS) {
      const value = request[field]
      if (!value) continue
      const matching = pool.filter((product) => product[field] === null
        || normalizePharmacyLabel(product[field]) === normalizePharmacyLabel(value))
      if (!matching.length) {
        return this.result(pool, { status: "needs_clarification", reason: "attribute_conflict", field })
      }
      pool = matching
    }

    if (pool.some((product) => PHARMACY_IDENTITY_FIELDS.some((field) => product[field] === null))) {
      return this.result(pool, { status: "needs_review", reason: "incomplete_product" })
    }
    if (pool.some((product) => product.requiresIdentityReview)) {
      return this.result(pool, { status: "needs_review", reason: "identity_risk" })
    }
    // An explicit catalogue code identifies the complete SKU. A name alone
    // does not establish dose/form/pack/unit, even when only one SKU is found.
    if (!request.externalId) {
      const missing = PHARMACY_IDENTITY_FIELDS.find((field) => field !== "manufacturer" && !request[field])
      if (missing) return this.result(pool, { status: "needs_clarification", reason: "missing_attribute", field: missing })
    }
    if (pool.length > 1) {
      const field = this.distinguishingField(pool, request)
      return this.result(pool, { status: "needs_clarification", reason: "ambiguous", ...(field ? { field } : {}) })
    }
    if (!pool[0].active) return this.result(pool, { status: "needs_review", reason: "inactive_product" })
    return this.result(pool, { status: "resolved", product: candidate(pool[0]) })
  }

  private distinguishingField(pool: PharmacyProduct[], request: PharmacyProductRequest): PharmacyIdentityField | undefined {
    return PHARMACY_IDENTITY_FIELDS.find((field) => !request[field]
      && new Set(pool.map((product) => normalizePharmacyLabel(product[field]!))).size > 1)
  }

  private result(
    pool: PharmacyProduct[],
    decision: Omit<Extract<PharmacyResolution, { status: "resolved" }>, keyof ResolutionBase>
      | Omit<Extract<PharmacyResolution, { status: "not_found" }>, keyof ResolutionBase>
      | Omit<Extract<PharmacyResolution, { status: "needs_clarification" }>, keyof ResolutionBase>
      | Omit<Extract<PharmacyResolution, { status: "needs_review" }>, keyof ResolutionBase>,
  ): PharmacyResolution {
    return { ...decision, catalogVersion: this.version, candidateCount: pool.length, candidates: pool.slice(0, 5).map(candidate) }
  }

  private similar(name: string): PharmacyProduct[] {
    if (Array.from(name).length < 3) return []
    const grams = trigrams(name)
    const counts = new Map<string, number>()
    for (const gram of grams) {
      for (const term of this.postings.get(gram) ?? []) counts.set(term, (counts.get(term) ?? 0) + 1)
    }
    const scores = new Map<string, number>()
    for (const [term, count] of counts) {
      // Discovery only. This threshold is never an identity/approval gate.
      const score = 2 * count / (grams.size + this.termSizes.get(term)!)
      if (score < 0.3) continue
      for (const id of this.names.get(term)!) scores.set(id, Math.max(scores.get(id) ?? 0, score))
    }
    return [...scores].sort(([a, left], [b, right]) => right - left || a.localeCompare(b))
      .map(([id]) => this.products.get(id)!)
  }
}
