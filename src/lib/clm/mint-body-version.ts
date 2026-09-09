/**
 * Contract Editor — shared body-version mint (Slice 1, Step 6).
 *
 * The SHA-binding-critical "mint a new ContractVersion from rich HTML" path,
 * extracted from `PUT /contracts/:id/body` so the `.docx` import route
 * (`POST /contracts/:id/import-docx`) mints versions through the SAME code —
 * one source of truth for `contentHash = sha256(serializeContractBody(html))`.
 * Drift between two copies of this logic would mean a contract imported from
 * .docx could hash differently than the same body typed in the editor.
 *
 * Behaviour (identical to the original inline body-route mint):
 *   - derive renderedBody = serializeContractBody(cleanHtml)
 *   - contentHash = sha256(renderedBody)
 *   - CAS mint: read MAX(versionNo), create version+1, then updateMany the
 *     contract row guarded on an editable status (only one concurrent write wins)
 *   - retry ≤3 on P2002 (unique(contractId, versionNo) race)
 *   - throw BodyVersionConflict("…", "NOT_EDITABLE") when the contract left an
 *     editable state mid-tx, or ("…", "VERSION_CONFLICT") when retries exhaust
 *
 * Callers MUST have already: authenticated, gated the module, loaded the
 * contract, and confirmed its status is editable. This helper does the mint
 * only — it does not re-authorize.
 */
import { createHash } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { serializeContractBody } from "@/lib/clm/serialize-body"

/** Statuses whose body may be edited.
 * Terminal states expired/renewed/terminated/rejected/cancelled cannot be edited. */
export const EDITABLE_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "active",
  "renewing",
] as const

export type BodyVersionConflictCode = "NOT_EDITABLE" | "VERSION_CONFLICT"

/** Thrown on a concurrent-edit conflict. `code` distinguishes the two 409 paths
 *  the body route surfaces: a NOT_EDITABLE state-machine race vs an exhausted
 *  versionNo CAS retry. */
export class BodyVersionConflict extends Error {
  readonly code: BodyVersionConflictCode
  constructor(message: string, code: BodyVersionConflictCode) {
    super(message)
    this.name = "BodyVersionConflict"
    this.code = code
  }
}

export interface MintBodyVersionResult {
  versionNo: number
  contentHash: string
  renderedBody: string
}

export async function mintBodyVersion(opts: {
  orgId: string
  contractId: string
  /** Already sanitized HTML (caller runs sanitizeContractBody). */
  cleanHtml: string
  /** ContractVersion.source — "editor" | "import" | … */
  source: string
  createdBy: string
  editableStatuses?: readonly string[]
}): Promise<MintBodyVersionResult> {
  const { orgId, contractId, cleanHtml, source, createdBy } = opts
  const editableStatuses = opts.editableStatuses ?? EDITABLE_STATUSES

  const renderedBody = serializeContractBody(cleanHtml)
  const contentHash = createHash("sha256").update(renderedBody).digest("hex")

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const version = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const maxResult = await tx.$queryRaw<Array<{ max: number | null }>>`
          SELECT MAX("versionNo") as max
          FROM contract_versions
          WHERE "contractId" = ${contractId}
        `
        const currentMax = maxResult[0]?.max
        const nextVersionNo =
          (typeof currentMax === "number" ? currentMax : Number(currentMax ?? 0)) + 1

        const newVersion = await tx.contractVersion.create({
          data: {
            organizationId: orgId,
            contractId,
            versionNo: nextVersionNo,
            renderedBody,
            bodyHtml: cleanHtml, // rich snapshot alongside the hashed renderedBody
            contentHash,
            source,
            isCanonicalSigned: false,
            note: null,
            createdBy,
          },
        })

        // CAS: only update if the contract is still in an editable state.
        const updated = await tx.contract.updateMany({
          where: { id: contractId, organizationId: orgId, status: { in: [...editableStatuses] } },
          data: { bodyHtml: cleanHtml, renderedBody },
        })
        if (updated.count !== 1) {
          throw new BodyVersionConflict(
            "Contract moved to a non-editable state concurrently",
            "NOT_EDITABLE",
          )
        }

        return newVersion
      })

      return { versionNo: version.versionNo, contentHash, renderedBody }
    } catch (e) {
      if (e instanceof BodyVersionConflict) throw e
      // P2002 = unique(contractId, versionNo) race → retry the CAS; once retries
      // are exhausted, surface a ret[ry]able 409 rather than the raw Prisma error.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        if (attempt < 3) continue
        throw new BodyVersionConflict("Version conflict — please retry", "VERSION_CONFLICT")
      }
      throw e
    }
  }

  // Unreachable (the loop either returns or throws), but keeps the function's
  // return type total for the type checker.
  throw new BodyVersionConflict("Version conflict — please retry", "VERSION_CONFLICT")
}
