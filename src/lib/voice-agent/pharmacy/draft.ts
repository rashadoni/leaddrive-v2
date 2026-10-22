import { createHash } from "node:crypto"

import { PharmacyCatalog } from "./catalog"
import { PharmacyOrderError, pharmacyDraftRequestSchema } from "./contracts"

/**
 * Review preview only. The caller must authenticate the call/customer bindings.
 * No persistence, confirmation proof, quote, reservation or 1C submission here.
 */
export function buildPharmacyOrderDraft(catalog: PharmacyCatalog, input: unknown, now: Date) {
  const parsed = pharmacyDraftRequestSchema.safeParse(input)
  if (!parsed.success) throw new PharmacyOrderError("invalid_draft")
  const request = parsed.data
  catalog.assertUsable(request.organizationId, now)
  if (new Set(request.lines.map((line) => line.lineId)).size !== request.lines.length) {
    throw new PharmacyOrderError("invalid_draft")
  }

  const lines = request.lines.map((line) => {
    const resolution = catalog.resolve(request.organizationId, line.product, now)
    let quantityIssue: "quantity_required" | "invalid_quantity" | "order_multiple" | null = null
    if (line.quantity === null) quantityIssue = "quantity_required"
    else if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > 1_000_000) quantityIssue = "invalid_quantity"
    else if (resolution.status === "resolved" && line.quantity % resolution.product.orderMultiple !== 0) quantityIssue = "order_multiple"
    return {
      lineId: line.lineId,
      requestedProduct: line.product,
      quantity: line.quantity,
      quantityIssue,
      resolution,
    }
  })

  const preview = {
    organizationId: request.organizationId,
    callId: request.callId,
    counterpartyId: request.counterpartyId,
    branchId: request.branchId,
    revision: request.revision,
    catalogVersion: catalog.version,
    status: lines.every((line) => line.resolution.status === "resolved" && line.quantityIssue === null)
      ? "awaiting_operator_review" as const : "collecting" as const,
    lines,
    pricing: "not_checked" as const,
    availability: "not_checked" as const,
    canSubmitTo1c: false as const,
  }
  return {
    ...preview,
    // A fingerprint for comparing revisions, NOT authorization or proof of consent.
    contentHash: createHash("sha256").update(JSON.stringify(preview)).digest("hex"),
  }
}
