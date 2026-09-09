/**
 * CLM Slice 4a — Contract amendment.
 *
 * POST /api/v1/contracts/:id/amend
 *
 * Mints a new ContractVersion(source="amendment") against an active contract
 * and updates Contract.renderedBody to the amended text. The prior canonical
 * signed version is left intact; it will be demoted only when the amendment
 * is re-signed (see the sign-completion canonical-swap in the sign route).
 *
 * Allowed states: active/renewing (live contract) and early editable states
 * draft/pending_approval/approved for contracts that do not have a body yet.
 * Rejected states: terminal states -> 409.
 *
 * Body (zod):
 *   {
 *     renderedBody: string   — the amended document text (replaces working body)
 *     changeNote?: string    — what changed (stored as ContractVersion.note)
 *     title?: string         — optionally update the contract title
 *   }
 *
 * Mint CAS: mirrors the Slice-1c generate route.
 *   SELECT MAX(versionNo) … FOR UPDATE-free, backed by @@unique([contractId,versionNo]).
 *   P2002 on the unique → client retries the whole tx (≤3 attempts).
 *
 * FIX D (Slice 4a): auth + write permission + in-flight envelope block.
 *   • withRlsAuth("contracts", "write") — read-only users cannot amend.
 *   • Block when EsignEnvelope in status created|sent|in_progress exists → 409
 *     (prevents mutating the body under an in-flight envelope whose bound body
 *     is already pinned — defense in depth; a bound envelope is already safe, but
 *     we block amend to avoid confusion about which version gets re-sent).
 *
 * FIX E (Slice 4a): amendable-status assertion + contract update moved INSIDE
 *   the $transaction with updateMany CAS (count===0 → rollback → 409). Prevents
 *   a concurrent transition to a terminal state slipping an amendment through.
 *
 * Auth: requireAuth + "contracts" + "write" + superadmin bypass.
 *
 * Response:
 *   200  { success: true, data: { version: ContractVersionRow } }
 *   400  Validation error
 *   401  Unauthorized
 *   403  Module disabled / insufficient role
 *   404  Contract not found / belongs to different org
 *   409  Contract not amendable / active envelope in-flight / CAS exhaust
 *   500  Internal server error
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { createHash } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRlsAuth } from "@/lib/with-rls"
import { countInFlightEnvelopes } from "@/lib/clm/envelope-guards"

// ─── Amendable statuses ───────────────────────────────────────────────────────

/**
 * Statuses that allow amending.
 *
 * "active" is the primary case (live, countersigned contract).
 * "approved" is included conservatively: a contract may reach that state without
 * yet having Contract.status===active. "renewing" remains editable while a
 * renewal flow is open.
 */
// Includes the early stages (draft / pending_approval) so a contract WITHOUT a
// body yet can have its document set/pasted via the amend dialog — closes the
// "no way to add a body to a pending intake-request" gap. Late terminal states
// (expired / renewed / terminated / rejected / cancelled) remain non-amendable.
const AMENDABLE_STATUSES = ["draft", "pending_approval", "approved", "active", "renewing"] as const

// In-flight envelope statuses live in the shared guard module
// (src/lib/clm/envelope-guards.ts) — amend, PUT /body and import-docx all
// block through the same rule.

// ─── Request schema ───────────────────────────────────────────────────────────

const amendSchema = z.object({
  renderedBody: z.string().min(1, "renderedBody is required"),
  changeNote: z.string().max(1000).optional(),
  title: z.string().min(1).max(500).optional(),
})

// ─── POST ─────────────────────────────────────────────────────────────────────

export const POST = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, userId } = auth

  // Module gate (belt-and-suspenders — requireAuth already checks org modules,
  // but we re-check to emit a module-specific error message for clarity).
  if (auth.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const { id: contractId } = await params

  // Parse + validate body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = amendSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { renderedBody, changeNote, title } = parsed.data

  // Load the contract (org-scoped) for the 404 / pre-check
  let contract: {
    id: string
    organizationId: string
    title: string
    status: string
  } | null

  try {
    contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId: orgId },
      select: { id: true, organizationId: true, title: true, status: true },
    })
  } catch (e) {
    console.error("[amend POST] contract lookup failed:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  if (!contract) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Pre-flight state guard (fast path — avoids an unnecessary DB roundtrip
  // when the status is obviously non-amendable before we even start the tx).
  if (!(AMENDABLE_STATUSES as readonly string[]).includes(contract.status)) {
    return NextResponse.json(
      {
        error: `Cannot amend a contract in status "${contract.status}". Terminal statuses (expired, renewed, terminated, rejected, cancelled) cannot be amended.`,
        code: "NOT_AMENDABLE",
      },
      { status: 409 }
    )
  }

  // FIX D: Block amend when there is an in-flight EsignEnvelope.
  // An in-flight envelope was bound to the current body at send time, so
  // mutating the body while it's in flight would confuse re-sends.
  // (Bound envelopes already protect the signed body, but we still block amend
  // for clarity and to prevent surprising re-send behavior.)
  try {
    const inFlightCount = await countInFlightEnvelopes(orgId, contractId)
    if (inFlightCount > 0) {
      return NextResponse.json(
        {
          error: "Cannot amend while a signature is in progress. Void or complete the open envelope first.",
          code: "ENVELOPE_IN_FLIGHT",
        },
        { status: 409 }
      )
    }
  } catch (e) {
    console.error("[amend POST] envelope in-flight check failed:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  // Compute content hash
  const contentHash = createHash("sha256").update(renderedBody).digest("hex")

  // FIX E + original CAS: mint the amendment version under CAS (retry ≤ 3 on P2002).
  // FIX E: the amendable-status assertion is now INSIDE the $transaction via
  //   contract.updateMany({ where: { id, status: { in: AMENDABLE_STATUSES } } })
  //   requiring count===1 (else throw → rollback → 409). This prevents a concurrent
  //   transition to a terminal state from slipping an amendment through the pre-flight
  //   check above.
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const version = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // CAS: read current MAX(versionNo) inside the tx
        const maxResult = await tx.$queryRaw<Array<{ max: number | null }>>`
          SELECT MAX("versionNo") as max
          FROM contract_versions
          WHERE "contractId" = ${contractId}
        `
        const currentMax = maxResult[0]?.max ?? 0
        const nextVersionNo =
          (typeof currentMax === "number"
            ? currentMax
            : Number(currentMax ?? 0)) + 1

        // Mint the amendment ContractVersion
        const newVersion = await tx.contractVersion.create({
          data: {
            organizationId: orgId,
            contractId,
            versionNo: nextVersionNo,
            renderedBody,
            contentHash,
            source: "amendment",
            isCanonicalSigned: false,
            note: changeNote ?? null,
            createdBy: userId ?? "unknown",
          },
        })

        // FIX E: Update the working contract body INSIDE the tx with a CAS where-clause.
        // updateMany({ where: { id, organizationId, status: { in: AMENDABLE_STATUSES } } })
        // returning count===1 means the contract was still in an amendable state
        // when we ran the update. count===0 means a concurrent transition moved it
        // to a terminal state → throw to roll back the tx → caller returns 409.
        const contractUpdate: Record<string, unknown> = { renderedBody }
        if (title !== undefined) contractUpdate.title = title

        const updateResult = await tx.contract.updateMany({
          where: {
            id: contractId,
            organizationId: orgId,
            status: { in: [...AMENDABLE_STATUSES] },
          },
          data: contractUpdate,
        })

        if (updateResult.count !== 1) {
          // Contract was concurrently transitioned to a non-amendable state
          // between our pre-check above and now. Roll back everything.
          throw new AmendConflictError(
            `Cannot amend: contract moved to a non-amendable state concurrently`
          )
        }

        return newVersion
      })

      // Audit log — non-critical
      await prisma.auditLog
        .create({
          data: {
            organizationId: orgId,
            userId: userId ?? undefined,
            action: "update",
            entityType: "contract",
            entityId: contractId,
            entityName: title ?? contract.title,
            oldValue: { status: contract.status },
            newValue: {
              action: "amendment_created",
              versionNo: version.versionNo,
              contentHash,
              changeNote: changeNote ?? null,
            },
          },
        })
        .catch(() => {}) // non-critical

      return NextResponse.json({
        success: true,
        data: {
          version: {
            id: version.id,
            versionNo: version.versionNo,
            source: version.source,
            isCanonicalSigned: version.isCanonicalSigned,
            contentHash: version.contentHash,
            note: version.note,
            createdBy: version.createdBy,
            createdAt: version.createdAt,
          },
        },
      })
    } catch (e) {
      if (e instanceof AmendConflictError) {
        return NextResponse.json(
          {
            error: `Cannot amend a contract that is no longer in an amendable state.`,
            code: "NOT_AMENDABLE",
          },
          { status: 409 }
        )
      }
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        attempt < 3
      ) {
        // Unique constraint on (contractId, versionNo) — retry
        continue
      }
      console.error("[amend POST] $transaction failed:", e)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  }

  // Exhausted retries
  return NextResponse.json(
    { error: "Concurrent write conflict — please retry" },
    { status: 409 }
  )
})

// ─── Internal error class ─────────────────────────────────────────────────────

/** Thrown inside $transaction when a concurrent state transition invalidated the amend.
 *  Caught outside the tx and mapped to 409 (never leaks to the user as a 500). */
class AmendConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AmendConflictError"
  }
}
