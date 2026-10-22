import { z } from "zod"

const identifier = z.string().trim().min(1).max(128)
const label = z.string().trim().min(1).max(240)

export const PHARMACY_IDENTITY_FIELDS = [
  "strength", "form", "packSize", "salesUnit", "manufacturer",
] as const
export type PharmacyIdentityField = typeof PHARMACY_IDENTITY_FIELDS[number]

/** Canonical adapter output, NOT the unverified wire format of Zeytun's API. */
export const pharmacyProductSchema = z.strictObject({
  organizationId: identifier,
  externalId: identifier,
  name: label,
  // Only aliases reviewed by the tenant; never add an LLM guess here.
  approvedAliases: z.array(label).max(30),
  strength: label.nullable(),
  form: label.nullable(),
  packSize: label.nullable(),
  salesUnit: label.nullable(),
  manufacturer: label.nullable(),
  orderMultiple: z.number().int().positive().max(1_000_000),
  active: z.boolean(),
  // Identity risks (e.g. known sound-alike names) require human review in pilot.
  requiresIdentityReview: z.boolean(),
})
export type PharmacyProduct = z.infer<typeof pharmacyProductSchema>

export const pharmacyCatalogSnapshotSchema = z.strictObject({
  organizationId: identifier,
  version: identifier,
  capturedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  // Set by the synchronizer after all pages, including unavailable SKUs, land.
  complete: z.literal(true),
  products: z.array(pharmacyProductSchema).max(50_000),
})

export const pharmacyProductRequestSchema = z.strictObject({
  externalId: identifier.optional(),
  name: label.optional(),
  strength: label.optional(),
  form: label.optional(),
  packSize: label.optional(),
  salesUnit: label.optional(),
  manufacturer: label.optional(),
}).refine((value) => Boolean(value.externalId || value.name))
export type PharmacyProductRequest = z.infer<typeof pharmacyProductRequestSchema>

export const pharmacyDraftRequestSchema = z.strictObject({
  // These bindings must come from an authenticated server session, not the LLM.
  organizationId: identifier,
  callId: identifier,
  counterpartyId: identifier,
  branchId: identifier,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lines: z.array(z.strictObject({
    lineId: identifier,
    product: pharmacyProductRequestSchema,
    // Missing/ambiguous quantities stay unresolved, never default to one.
    quantity: z.number().finite().nullable(),
  })).min(1).max(100),
})

export type PharmacyErrorCode =
  | "invalid_catalog" | "tenant_mismatch" | "catalog_unavailable"
  | "invalid_request" | "invalid_draft"

export class PharmacyOrderError extends Error {
  constructor(readonly code: PharmacyErrorCode) {
    // Never include raw API/customer data or cross-tenant IDs in the error.
    super(code)
    this.name = "PharmacyOrderError"
  }
}

/** Preserve punctuation, units, scripts and accents; no strength conversion. */
export function normalizePharmacyLabel(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase()
}
