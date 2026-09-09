import { z } from "zod"
import type { CanonicalJsonValue } from "./canonical-json"
import type { EventClassification } from "./envelope"

const IDENTIFIER = /^[^\s:]+$/
const CURRENCY = /^[A-Z]{3}$/
const MONEY = /^-?(?:0|[1-9][0-9]{0,13})\.[0-9]{4}$/
const NON_NEGATIVE_MONEY = /^(?:0|[1-9][0-9]{0,13})\.[0-9]{4}$/
const POSITIVE_MONEY = /^(?:0|[1-9][0-9]{0,13})\.[0-9]{4}$/

const identifier = z.string().min(1).max(191).regex(IDENTIFIER)
const currency = z.string().regex(CURRENCY)
const money = z.string().regex(MONEY)
const nonNegativeMoney = z.string().regex(NON_NEGATIVE_MONEY)
const positiveMoney = z.string().regex(POSITIVE_MONEY).refine((value) => value !== "0.0000", {
  message: "money amount must be positive",
})
const changedField = z.enum(["name", "description", "targetAmount", "currency", "color", "isActive"])
const changedFields = z.array(changedField).min(1).refine(
  (values) => new Set(values).size === values.length,
  { message: "changedFields must be unique" },
)
const nullableDescription = z.string().max(1000).nullable().optional()
const nullableTarget = nonNegativeMoney.nullable().optional()
const nullableColor = z.string().max(20).nullable().optional()

function fixedMoney(value: string): bigint | null {
  if (!MONEY.test(value)) return null
  const negative = value.startsWith("-")
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction] = unsigned.split(".")
  const scaled = BigInt(whole) * 10_000n + BigInt(fraction)
  return negative ? -scaled : scaled
}

const fundOpenedData = z.strictObject({
  fundId: identifier,
  currency,
  openingBalance: nonNegativeMoney,
  storedBalance: nonNegativeMoney.optional(),
  signedLegacyTransactionTotal: money.optional(),
  legacyTransactionCount: z.number().int().nonnegative().optional(),
  targetAmount: nullableTarget,
  name: z.string().min(1).max(200).optional(),
  description: nullableDescription,
  color: nullableColor,
  isActive: z.boolean().optional(),
  legacyBootstrap: z.boolean().optional(),
  legacyCompatibilityWrite: z.boolean().optional(),
}).superRefine((data, context) => {
  if (data.legacyBootstrap === true) {
    for (const field of ["storedBalance", "signedLegacyTransactionTotal", "legacyTransactionCount"] as const) {
      if (data[field] === undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required for a legacy bootstrap opening`,
        })
      }
    }
  }

  if (data.storedBalance !== undefined && data.signedLegacyTransactionTotal !== undefined) {
    const opening = fixedMoney(data.openingBalance)
    const signedLegacyTotal = fixedMoney(data.signedLegacyTransactionTotal)
    const stored = fixedMoney(data.storedBalance)
    if (opening !== null && signedLegacyTotal !== null && stored !== null
        && opening + signedLegacyTotal !== stored) {
      context.addIssue({
        code: "custom",
        path: ["openingBalance"],
        message: "openingBalance plus signed legacy total must equal storedBalance",
      })
    }
  }
})

const creditTransactionTypes = new Set(["deposit", "transfer_in", "auto_allocation"])
const fundTransactionRecordedData = z.strictObject({
  fundId: identifier,
  transactionId: identifier,
  transactionType: z.enum(["deposit", "withdrawal", "transfer_in", "transfer_out", "auto_allocation"]),
  amount: positiveMoney,
  signedDelta: money,
  resultingBalance: nonNegativeMoney.optional(),
  currency,
  relatedType: z.string().min(1).max(100).optional(),
  relatedId: identifier.optional(),
  legacyBootstrap: z.boolean().optional(),
  legacyCompatibilityWrite: z.boolean().optional(),
}).superRefine((data, context) => {
  const amount = fixedMoney(data.amount)
  const signedDelta = fixedMoney(data.signedDelta)
  if (amount === null || signedDelta === null) return
  const expectedDelta = creditTransactionTypes.has(data.transactionType) ? amount : -amount
  if (signedDelta !== expectedDelta) {
    context.addIssue({
      code: "custom",
      path: ["signedDelta"],
      message: "signedDelta must match transactionType and amount",
    })
  }
})

const fundMetadataUpdatedData = z.strictObject({
  fundId: identifier,
  changedFields,
  name: z.string().min(1).max(200),
  description: nullableDescription,
  targetAmount: nullableTarget,
  currency,
  color: nullableColor,
  isActive: z.boolean(),
  legacyCompatibilityWrite: z.boolean().optional(),
})

const fundArchivedData = z.strictObject({
  fundId: identifier,
  reason: z.string().min(1).max(200).optional(),
  changedFields: changedFields.optional(),
  name: z.string().min(1).max(200).optional(),
  description: nullableDescription,
  targetAmount: nullableTarget,
  currency: currency.optional(),
  color: nullableColor,
  isActive: z.literal(false).optional(),
  legacyCompatibilityWrite: z.boolean().optional(),
}).superRefine((data, context) => {
  if (data.reason === undefined && data.isActive !== false) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "an archived event requires a reason or isActive=false",
    })
  }
})

const fundReactivatedData = z.strictObject({
  fundId: identifier,
  changedFields: changedFields.refine((values) => values.includes("isActive"), {
    message: "reactivation changedFields must include isActive",
  }),
  name: z.string().min(1).max(200),
  description: nullableDescription,
  targetAmount: nullableTarget,
  currency,
  color: nullableColor,
  isActive: z.literal(true),
  legacyCompatibilityWrite: z.boolean().optional(),
})

export const FUND_EVENT_CONTRACTS = {
  "finance.fund-opened.v1": {
    dataSchema: "urn:leaddrive:schema:finance.fund-opened:v1",
    data: fundOpenedData,
  },
  "finance.fund-transaction-recorded.v1": {
    dataSchema: "urn:leaddrive:schema:finance.fund-transaction-recorded:v1",
    data: fundTransactionRecordedData,
  },
  "finance.fund-metadata-updated.v1": {
    dataSchema: "urn:leaddrive:schema:finance.fund-metadata-updated:v1",
    data: fundMetadataUpdatedData,
  },
  "finance.fund-archived.v1": {
    dataSchema: "urn:leaddrive:schema:finance.fund-archived:v1",
    data: fundArchivedData,
  },
  "finance.fund-reactivated.v1": {
    dataSchema: "urn:leaddrive:schema:finance.fund-reactivated:v1",
    data: fundReactivatedData,
  },
} as const

export type FundEventType = keyof typeof FUND_EVENT_CONTRACTS

export interface EventContractInput {
  domain: string
  aggregateType: string
  aggregateId: string
  eventType: string
  dataSchema: string
  classification: EventClassification
  data: Record<string, CanonicalJsonValue>
}

export class EventContractValidationError extends TypeError {
  readonly code = "EVENT_CONTRACT_INVALID"

  constructor(message: string) {
    super(message)
    this.name = "EventContractValidationError"
  }
}

const contractBySchema = new Map<string, string>(
  Object.entries(FUND_EVENT_CONTRACTS).map(([eventType, contract]) => [contract.dataSchema, eventType]),
)

/**
 * Enforces every implemented Fund contract before the aggregate head is
 * touched. Unknown domains retain the generic foundation path, but a caller
 * cannot claim the Finance Fund namespace until its exact pair is registered.
 */
export function assertEventContract(input: EventContractInput): void {
  const contract = FUND_EVENT_CONTRACTS[input.eventType as FundEventType]
  const eventClaimsFund = input.eventType.startsWith("finance.fund-")
  const schemaClaimsFund = input.dataSchema.startsWith("urn:leaddrive:schema:finance.fund-")
  const aggregateClaimsFund = input.aggregateType === "fund"

  if (!contract) {
    if (aggregateClaimsFund || eventClaimsFund || schemaClaimsFund || contractBySchema.has(input.dataSchema)) {
      throw new EventContractValidationError(
        `unregistered Finance Fund event contract: ${input.eventType} / ${input.dataSchema}`,
      )
    }
    return
  }

  if (contract.dataSchema !== input.dataSchema || contractBySchema.get(input.dataSchema) !== input.eventType) {
    throw new EventContractValidationError(
      `Finance Fund eventType/dataSchema mismatch: ${input.eventType} / ${input.dataSchema}`,
    )
  }
  if (input.domain !== "finance" || input.aggregateType !== "fund" || input.classification !== "confidential") {
    throw new EventContractValidationError(
      `Finance Fund envelope contract mismatch for ${input.eventType}`,
    )
  }

  const result = contract.data.safeParse(input.data)
  if (!result.success) {
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "data"))]
    throw new EventContractValidationError(
      `Finance Fund payload contract rejected ${input.eventType} at: ${paths.join(", ")}`,
    )
  }
  if (result.data.fundId !== input.aggregateId) {
    throw new EventContractValidationError(
      `Finance Fund payload aggregate identity mismatch for ${input.eventType}`,
    )
  }
}
