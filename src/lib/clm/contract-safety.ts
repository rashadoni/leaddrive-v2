/**
 * «Опасные места» of a contract (owner 2026-11-26, mock, «Давай»):
 *
 *  - Deleting. A contract could be deleted in any status, and the delete took
 *    its signed versions, its e-sign envelopes with their audit trail and its
 *    performance obligations with it. Now only a contract never signed and
 *    never in force — a draft, a rejected or a cancelled one — is deleted; a
 *    signed one is terminated or cancelled instead.
 *  - Changing what was approved. Amount, currency or dates (the form) or the
 *    text (editor, amendment, .docx) of a contract in approval or approved
 *    changed silently past the approval rules. Now the contract goes back to
 *    draft and through approval again — the form asks first (REAPPROVAL_REQUIRED,
 *    then `confirmReapproval`); its approval round is superseded and an e-sign
 *    invitation still out dies.
 *  - Changing what was signed. Amount, currency and dates of a signed contract
 *    change only by an administrator, written to the audit log old → new.
 *  - The number. One number, one contract, in an organization: a DB unique
 *    index, and a free number picked for the ones the system makes up.
 */
import type { Prisma } from "@prisma/client"
import { voidOpenEnvelopes } from "@/lib/clm/void-open-envelopes"

export {
  CONTRACT_NUMBER_INDEX,
  DELETABLE_STATUSES,
  REAPPROVAL_STATUSES,
  changedTerms,
  deleteRefusal,
  isSignedContract,
  needsReapproval,
  type ContractTerm,
} from "@/lib/clm/contract-safety-rules"
import { CONTRACT_NUMBER_INDEX, needsReapproval } from "@/lib/clm/contract-safety-rules"

/**
 * Inside the caller's transaction: a contract in approval or approved goes back to draft —
 * its approval round superseded, every e-sign invitation still out voided. Returns whether
 * it moved; anything else (a draft, a signed contract) is left as it is.
 */
export async function returnToDraftForReapproval(
  tx: Prisma.TransactionClient,
  input: { orgId: string; contractId: string; reason: string; actorUserId: string | null; at: Date },
): Promise<boolean> {
  const current = await tx.contract.findFirst({
    where: { id: input.contractId, organizationId: input.orgId },
    select: { status: true, signedAt: true },
  })
  if (!current || !needsReapproval(current)) return false
  const moved = await tx.contract.updateMany({
    where: { id: input.contractId, organizationId: input.orgId, status: current.status, signedAt: null },
    data: { status: "draft", currentApprovalStage: null },
  })
  if (moved.count !== 1) return false
  await tx.contractApprovalStage.updateMany({
    where: { contractId: input.contractId, organizationId: input.orgId, status: { in: ["pending", "approved", "rejected", "skipped"] } },
    data: { status: "superseded" },
  })
  await voidOpenEnvelopes(tx, {
    orgId: input.orgId,
    contractId: input.contractId,
    scope: "all",
    reason: input.reason,
    actorUserId: input.actorUserId,
    at: input.at,
  })
  return true
}

/** True for the unique violation on (organizationId, contractNumber). */
export function isContractNumberTaken(error: unknown): boolean {
  if (!error || typeof error !== "object" || (error as { code?: unknown }).code !== "P2002") return false
  const target = (error as { meta?: { target?: unknown } }).meta?.target
  const text = Array.isArray(target) ? target.join(",") : String(target ?? "")
  // Prisma names the index, the columns, or — with a driver adapter — nothing at all.
  return text === "" || text.includes(CONTRACT_NUMBER_INDEX) || text.includes("contractNumber")
}

/**
 * A free contract number based on `base`: `base`, then `base-2`, `base-3`… — for the numbers
 * the system makes up (wizard, intake, a quote's contract, a renewal). The unique index stays
 * the guarantee; this only avoids the refusal.
 */
export async function freeContractNumber(
  db: { contract: { findMany: (args: { where: { organizationId: string; contractNumber: { startsWith: string } }; select: { contractNumber: true } }) => Promise<Array<{ contractNumber: string }>> } },
  orgId: string,
  base: string,
): Promise<string> {
  const taken = new Set(
    (await db.contract.findMany({ where: { organizationId: orgId, contractNumber: { startsWith: base } }, select: { contractNumber: true } }))
      .map((row) => row.contractNumber),
  )
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}
