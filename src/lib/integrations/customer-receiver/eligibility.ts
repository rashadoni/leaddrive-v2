import { contractAssert, identifier } from "./contract"
import { validateBinding, type ReceiverBinding } from "./delivery"

/** No implicit "export all" default; the business owner must select a rule. */
export type DealExportRule =
  | { mode: "disabled" }
  | { mode: "all_deals" }
  | { mode: "pipeline_stages"; pipelineId: string; stages: readonly string[] }

export interface DealExportCandidate {
  organizationId: string
  companyId: string | null
  pipelineId: string | null
  stage: string
}

/** Call with a server-owned rule and a tenant-scoped database result. */
export function evaluateDealExport(
  binding: ReceiverBinding,
  rule: DealExportRule,
  candidate: DealExportCandidate,
): "eligible" | "disabled" | "missing_customer" | "outside_rule" {
  // Tenant identity is checked even when the connector is disabled.
  contractAssert(identifier(candidate.organizationId) === identifier(binding.organizationId))
  if (!binding.enabled || rule.mode === "disabled") return "disabled"
  validateBinding(binding, candidate.organizationId)
  if (candidate.companyId === null) return "missing_customer"
  identifier(candidate.companyId)
  if (rule.mode === "all_deals") return "eligible"
  contractAssert(rule.mode === "pipeline_stages")
  identifier(rule.pipelineId)
  contractAssert(rule.stages.length > 0 && rule.stages.length <= 100)
  contractAssert(rule.stages.every((stage) => typeof stage === "string" && stage.trim().length > 0 && stage.length <= 128))
  return candidate.pipelineId === rule.pipelineId && rule.stages.includes(candidate.stage) ? "eligible" : "outside_rule"
}

/**
 * Convert a lossless CRM Decimal string to the proposed 2-place wire profile.
 * No floating-point conversion or rounding. CRM currently stores four places;
 * nonzero third/fourth decimals require a different approved receiving profile.
 */
export function receiverAmount(decimal: string): string {
  contractAssert(typeof decimal === "string" && /^(0|[1-9]\d{0,15})(?:\.\d{1,4})?$/.test(decimal))
  const [integer, fraction = ""] = decimal.split(".")
  contractAssert(!/[1-9]/.test(fraction.slice(2)))
  return `${integer}.${fraction.padEnd(2, "0").slice(0, 2)}`
}
