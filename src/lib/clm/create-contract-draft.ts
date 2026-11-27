/**
 * A new draft contract and its first version, in the caller's transaction —
 * the one way a contract is born from a template, shared by
 * `POST /api/v1/contract-templates/:id/generate` and the contract wizard
 * (`POST /api/v1/contracts/wizard`). Version 1 pins the text with its SHA-256,
 * as every later version does.
 */
import { freeContractNumber } from "@/lib/clm/contract-safety"
import crypto from "crypto"
import type { Prisma } from "@prisma/client"

/** CONTRACT-<YYYYMMDDHHmmss>-<4 random hex chars>. */
export function generateContractNumber(now: Date = new Date()): string {
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("")
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase()
  return `CONTRACT-${ts}-${suffix}`
}

export function contentHashOf(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex")
}

export interface ContractDraftInput {
  organizationId: string
  userId?: string | null
  contractNumber: string
  /** The system made the number up: take the next free one if it is taken (contract-safety.ts).
   *  A number a person typed is refused instead (the unique index, CONTRACT_NUMBER_TAKEN). */
  numberGenerated?: boolean
  title: string
  type: string
  renderedBody: string
  templateId?: string | null
  templateVersion?: number | null
  companyId?: string | null
  dealId?: string | null
  contactId?: string | null
  startDate?: Date
  endDate?: Date
  valueAmount?: number
  currency?: string
}

export async function createContractDraft(tx: Prisma.TransactionClient, input: ContractDraftInput) {
  const contractNumber = input.numberGenerated
    ? await freeContractNumber(tx, input.organizationId, input.contractNumber)
    : input.contractNumber
  const contract = await tx.contract.create({
    data: {
      organizationId: input.organizationId,
      contractNumber,
      title: input.title,
      type: input.type,
      status: "draft",
      renderedBody: input.renderedBody,
      ...(input.templateId ? { templateId: input.templateId, templateVersion: input.templateVersion ?? undefined } : {}),
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.dealId ? { dealId: input.dealId } : {}),
      ...(input.contactId ? { contactId: input.contactId } : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.endDate ? { endDate: input.endDate } : {}),
      ...(input.valueAmount !== undefined ? { valueAmount: input.valueAmount } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.userId ? { createdBy: input.userId } : {}),
    },
    include: {
      company: { select: { id: true, name: true } },
      deal: { select: { id: true, name: true } },
      contact: { select: { id: true, fullName: true } },
    },
  })
  await tx.contractVersion.create({
    data: {
      organizationId: input.organizationId,
      contractId: contract.id,
      versionNo: 1,
      renderedBody: input.renderedBody,
      contentHash: contentHashOf(input.renderedBody),
      source: "draft",
      ...(input.userId ? { createdBy: input.userId } : {}),
    },
  })
  return contract
}
