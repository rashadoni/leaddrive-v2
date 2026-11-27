/**
 * The pure rules of «Опасные места» (src/lib/clm/contract-safety.ts): what may be deleted,
 * what a change to the terms means. No I/O — the contract card and form read them too.
 */
export const DELETABLE_STATUSES = ["draft", "rejected", "cancelled"] as const
export const REAPPROVAL_STATUSES = ["pending_approval", "approved"] as const
const SIGNED_STATUSES = ["active", "renewing", "expired", "terminated", "renewed"]

export const CONTRACT_NUMBER_INDEX = "contracts_org_number_uniq"

export function deleteRefusal(contract: { status: string; signedAt: Date | string | null }): "CONTRACT_DELETE_LOCKED" | null {
  if (contract.signedAt) return "CONTRACT_DELETE_LOCKED"
  return (DELETABLE_STATUSES as readonly string[]).includes(contract.status) ? null : "CONTRACT_DELETE_LOCKED"
}

export function isSignedContract(contract: { status: string; signedAt: Date | string | null }): boolean {
  return Boolean(contract.signedAt) || SIGNED_STATUSES.includes(contract.status)
}

export function needsReapproval(contract: { status: string; signedAt: Date | string | null }): boolean {
  return !contract.signedAt && (REAPPROVAL_STATUSES as readonly string[]).includes(contract.status)
}

export type ContractTerm = "valueAmount" | "currency" | "startDate" | "endDate"

const dayOf = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return ""
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10)
}
const amountOf = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null
  const n = Number(typeof value === "object" && value && "toString" in value ? String(value) : value)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Which of the terms a patch changes — only the fields it carries. */
export function changedTerms(
  current: { valueAmount: unknown; currency: string | null; startDate: Date | string | null; endDate: Date | string | null },
  patch: { valueAmount?: unknown; currency?: string | null; startDate?: string | null; endDate?: string | null },
): ContractTerm[] {
  const changed: ContractTerm[] = []
  if (patch.valueAmount !== undefined && amountOf(patch.valueAmount) !== amountOf(current.valueAmount)) changed.push("valueAmount")
  if (patch.currency !== undefined && (patch.currency || "") !== (current.currency || "")) changed.push("currency")
  if (patch.startDate !== undefined && dayOf(patch.startDate) !== dayOf(current.startDate)) changed.push("startDate")
  if (patch.endDate !== undefined && dayOf(patch.endDate) !== dayOf(current.endDate)) changed.push("endDate")
  return changed
}
