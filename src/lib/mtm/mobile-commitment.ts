export type MobileCommitmentCreateInput = {
  clientCommitmentId: string
  visitId: string
  productExternalId: string | null
  productName: string
  brandExternalId: string | null
  brandName: string | null
  promisedQuantity: number
  unit: string
  dueAt: Date
  note: string | null
  evidenceClientPhotoId: string | null
}

export type MobileCommitmentOutcome = "FULFILLED" | "PARTIAL" | "NOT_FULFILLED"

export type MobileCommitmentFulfillInput = {
  commitmentId: string
  clientFulfillmentId: string
  outcome: MobileCommitmentOutcome
  actualQuantity: number
  note: string | null
  evidenceClientPhotoId: string | null
}

export type MobileCommitmentStatus = "OPEN" | "OVERDUE" | MobileCommitmentOutcome

type ParseResult<T> = { input: T | null; error: string | null }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requiredString(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length >= min && normalized.length <= max ? normalized : null
}

function optionalString(value: unknown, max: number): string | null | undefined {
  if (value == null || value === "") return null
  if (typeof value !== "string") return undefined
  const normalized = value.trim()
  return normalized.length <= max ? normalized || null : undefined
}

function quantity(value: unknown, allowZero: boolean): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  if ((allowZero ? value < 0 : value <= 0) || value > 1_000_000_000) return null
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) return null
  return value
}

function clientId(value: unknown): string | null {
  return requiredString(value, 8, 128)
}

export function parseMobileCommitmentCreate(
  value: unknown,
  submittedAt: Date,
): ParseResult<MobileCommitmentCreateInput> {
  const data = record(value)
  if (!data) return { input: null, error: "Commitment payload must be an object" }
  const clientCommitmentId = clientId(data.clientCommitmentId)
  const visitId = requiredString(data.visitId, 1, 128)
  const productName = requiredString(data.productName, 1, 200)
  const productExternalId = optionalString(data.productExternalId, 128)
  const brandExternalId = optionalString(data.brandExternalId, 128)
  const brandName = optionalString(data.brandName, 200)
  const promisedQuantity = quantity(data.promisedQuantity, false)
  const unit = requiredString(data.unit ?? "unit", 1, 40)
  const dueAt = typeof data.dueAt === "string" ? new Date(data.dueAt) : new Date(Number.NaN)
  const note = optionalString(data.note, 2_000)
  const evidenceClientPhotoId = optionalString(data.evidenceClientPhotoId, 128)
  if (!clientCommitmentId) return { input: null, error: "clientCommitmentId must be 8..128 characters" }
  if (!visitId) return { input: null, error: "visitId is required" }
  if (!productName) return { input: null, error: "productName must be 1..200 characters" }
  if (productExternalId === undefined || brandExternalId === undefined || brandName === undefined) {
    return { input: null, error: "Invalid product or brand reference" }
  }
  if (promisedQuantity == null) return { input: null, error: "promisedQuantity must be positive with at most 2 decimals" }
  if (!unit) return { input: null, error: "unit must be 1..40 characters" }
  if (Number.isNaN(dueAt.getTime()) || dueAt < submittedAt) {
    return { input: null, error: "dueAt must not be earlier than the client submission time" }
  }
  if (note === undefined) return { input: null, error: "note is too long" }
  if (evidenceClientPhotoId === undefined || (evidenceClientPhotoId && !clientId(evidenceClientPhotoId))) {
    return { input: null, error: "evidenceClientPhotoId must be 8..128 characters" }
  }
  return {
    input: {
      clientCommitmentId,
      visitId,
      productExternalId,
      productName,
      brandExternalId,
      brandName,
      promisedQuantity,
      unit,
      dueAt,
      note,
      evidenceClientPhotoId,
    },
    error: null,
  }
}

export function parseMobileCommitmentFulfill(value: unknown): ParseResult<MobileCommitmentFulfillInput> {
  const data = record(value)
  if (!data) return { input: null, error: "Commitment fulfillment payload must be an object" }
  const commitmentId = requiredString(data.commitmentId, 1, 128)
  const clientFulfillmentId = clientId(data.clientFulfillmentId)
  const outcome = typeof data.outcome === "string" && ["FULFILLED", "PARTIAL", "NOT_FULFILLED"].includes(data.outcome)
    ? data.outcome as MobileCommitmentOutcome
    : null
  const actualQuantity = quantity(data.actualQuantity, true)
  const note = optionalString(data.note, 2_000)
  const evidenceClientPhotoId = optionalString(data.evidenceClientPhotoId, 128)
  if (!commitmentId) return { input: null, error: "commitmentId is required" }
  if (!clientFulfillmentId) return { input: null, error: "clientFulfillmentId must be 8..128 characters" }
  if (!outcome) return { input: null, error: "Invalid commitment outcome" }
  if (actualQuantity == null) return { input: null, error: "actualQuantity must be non-negative with at most 2 decimals" }
  if (note === undefined) return { input: null, error: "note is too long" }
  if (evidenceClientPhotoId === undefined || (evidenceClientPhotoId && !clientId(evidenceClientPhotoId))) {
    return { input: null, error: "evidenceClientPhotoId must be 8..128 characters" }
  }
  return {
    input: {
      commitmentId,
      clientFulfillmentId,
      outcome,
      actualQuantity,
      note,
      evidenceClientPhotoId,
    },
    error: null,
  }
}

export function commitmentOutcomeError(input: {
  promisedQuantity: number
  actualQuantity: number
  outcome: MobileCommitmentOutcome
}): string | null {
  if (input.outcome === "NOT_FULFILLED") {
    return input.actualQuantity === 0 ? null : "NOT_FULFILLED requires actualQuantity=0"
  }
  if (input.outcome === "PARTIAL") {
    return input.actualQuantity > 0 && input.actualQuantity < input.promisedQuantity
      ? null
      : "PARTIAL requires actualQuantity between zero and promisedQuantity"
  }
  return input.actualQuantity >= input.promisedQuantity
    ? null
    : "FULFILLED requires actualQuantity greater than or equal to promisedQuantity"
}

export function mobileCommitmentStatus(input: {
  dueAt: Date | string
  fulfillment: { outcome: MobileCommitmentOutcome } | null
  now?: Date
}): MobileCommitmentStatus {
  if (input.fulfillment) return input.fulfillment.outcome
  const dueAt = input.dueAt instanceof Date ? input.dueAt : new Date(input.dueAt)
  return dueAt.getTime() < (input.now ?? new Date()).getTime() ? "OVERDUE" : "OPEN"
}
