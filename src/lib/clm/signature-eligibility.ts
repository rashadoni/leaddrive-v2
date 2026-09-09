import { isContractStatus } from "@/lib/contract-lifecycle/state-machine"
import type { ContractStatus } from "@/lib/contract-lifecycle/types"

const SIGNABLE_CONTRACT_STATUSES = new Set<ContractStatus>(["approved", "active", "renewing"])

export interface ContractSignatureEligibilitySnapshot {
  status: string
  signedAt: Date | null
}

export function getContractSignatureEligibilityError(
  contract: ContractSignatureEligibilitySnapshot,
): string | null {
  if (!isContractStatus(contract.status)) {
    return `Contract has unrecognised status: "${contract.status}"`
  }

  if (contract.status === "approved" && contract.signedAt != null) {
    return "Contract is already signed; status must be active before re-signature"
  }

  if (!SIGNABLE_CONTRACT_STATUSES.has(contract.status)) {
    return `Contract must be approved or active before e-signature (current: "${contract.status}")`
  }

  return null
}
