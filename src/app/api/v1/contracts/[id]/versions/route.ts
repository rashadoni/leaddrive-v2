/**
 * CLM Slice 1d — Contract version history.
 *
 * GET /api/v1/contracts/:id/versions
 *
 * Returns the ordered list of ContractVersion rows for the given contract,
 * newest first (versionNo DESC). The contract must belong to the requesting
 * org (org-scoped); the "contracts" module gate applies (superadmin bypass).
 *
 * Response shapes:
 *   List (default): metadata only — `renderedBody` is NOT returned to avoid
 *     loading all bodies for every page view (DoS-prevention / bandwidth).
 *   Selective (?ids=<id1>,<id2>): returns ONLY the specified version(s)
 *     (max 2) WITH `renderedBody` included — used by the compare dialog to
 *     fetch exactly the two bodies it needs for `computeLineDiff`.
 *
 * Query params:
 *   ?ids=<id1>,<id2>   — comma-separated ContractVersion ids; fetches those
 *                        specific versions WITH renderedBody (≤2 ids accepted).
 *
 * Response:
 *   200  { versions: ContractVersionRow[] }
 *   400  Too many ids requested via ?ids=
 *   401  Unauthorized
 *   403  Module disabled
 *   404  Contract not found (or belongs to a different org)
 *   500  Internal server error
 *
 * ContractVersionRow (list, no renderedBody):
 *   { id, versionNo, source, isCanonicalSigned, contentHash, note,
 *     createdBy, createdAt }
 *
 * ContractVersionRow (?ids= mode, includes renderedBody):
 *   { id, versionNo, source, isCanonicalSigned, contentHash, note,
 *     createdBy, createdAt, renderedBody }
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"

/** Maximum number of version ids allowed in a single ?ids= request (for compare). */
const MAX_IDS_FOR_BODY_FETCH = 2

export const GET = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const { id: contractId } = await params

  try {
    // 1. Verify the contract belongs to this org.
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId: orgId },
      select: { id: true },
    })
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const { searchParams } = new URL(req.url)
    const idsParam = searchParams.get("ids")

    if (idsParam) {
      // ── ?ids= mode: selective fetch WITH renderedBody (for compare dialog) ──
      const ids = idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)

      if (ids.length > MAX_IDS_FOR_BODY_FETCH) {
        return NextResponse.json(
          { error: `At most ${MAX_IDS_FOR_BODY_FETCH} version ids may be requested at once` },
          { status: 400 },
        )
      }

      const versions = await prisma.contractVersion.findMany({
        where: {
          id: { in: ids },
          contractId,
          organizationId: orgId,
        },
        select: {
          id: true,
          versionNo: true,
          source: true,
          isCanonicalSigned: true,
          contentHash: true,
          note: true,
          createdBy: true,
          createdAt: true,
          renderedBody: true, // included for compare
        },
      })

      return NextResponse.json({ versions })
    }

    // ── Default list mode: metadata only (no renderedBody) ────────────────────
    // Omitting renderedBody from the list prevents loading O(versions × bodySize)
    // on every page view — large contracts can be tens of thousands of chars each.
    const versions = await prisma.contractVersion.findMany({
      where: { contractId, organizationId: orgId },
      orderBy: { versionNo: "desc" },
      select: {
        id: true,
        versionNo: true,
        source: true,
        isCanonicalSigned: true,
        contentHash: true,
        note: true,
        createdBy: true,
        createdAt: true,
        // renderedBody intentionally omitted from list — use ?ids= to fetch bodies
      },
    })

    return NextResponse.json({ versions })
  } catch (e) {
    console.error("[contracts/:id/versions GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
