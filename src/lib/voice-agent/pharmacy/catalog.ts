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
import { PharmacyNameSearch } from "./name-search"

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
  private readonly search = new PharmacyNameSearch()

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
        this.search.add(product.externalId, rawName)
        const name = normalizePharmacyLabel(rawName)
        const existing = this.names.get(name)
        if (existing) {
          existing.add(product.externalId)
          continue
        }
        this.names.set(name, new Set([product.externalId]))
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
    return this.search.find(name).map((id) => this.products.get(id)!)
  }
}
