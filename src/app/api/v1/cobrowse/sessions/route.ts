import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { generateJoinToken } from "@/lib/cobrowse/tokens"
import { COBROWSE_STATUSES, type CobrowseStatus } from "@/lib/cobrowse/types"

/**
 * POST /api/v1/cobrowse/sessions
 *
 * T8 Cobrowse — slice-2 agent-create.
 *
 * Authenticated support agent kicks off a cobrowse engagement.
 * Returns the new session row + the customer-facing `joinToken` the
 * agent shares (via link, QR, or support chat). Slice-2b adds the
 * SSE signaling channel that customer/agent connect to once the
 * session reaches `active`.
 *
 * Cross-tenant: every session is org-scoped via session JWT; the
 * `contactId` (if supplied) is verified to belong to the caller's
 * org before persistence.
 */

const bodySchema = z.object({
  /** Optional Contact this session is tied to. NULL for anonymous
   *  public-portal cobrowse. */
  contactId: z.string().min(1).max(60).optional(),
})

export const POST = withRlsAuth("settings", "write", async (req, auth) => {
  let body: unknown
  try { body = await req.json() } catch { body = {} }
  const parsed = bodySchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Verify contact ownership if specified — prevents an agent from
  // attaching a session to a contact in a sibling tenant.
  if (parsed.data.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: parsed.data.contactId, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!contact) {
      return NextResponse.json({ error: "contactId not found in this organization" }, { status: 404 })
    }
  }

  const joinToken = generateJoinToken()

  try {
    const session = await prisma.cobrowseSession.create({
      data: {
        organizationId: auth.orgId,
        agentUserId: auth.userId,
        contactId: parsed.data.contactId ?? null,
        joinToken,
        status: "pending",
      },
      select: {
        id: true,
        organizationId: true,
        agentUserId: true,
        contactId: true,
        status: true,
        joinToken: true,
        startedAt: true,
      },
    })
    return NextResponse.json({ success: true, session }, { status: 201 })
  } catch (e) {
    console.error("[cobrowse/sessions] POST error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/**
 * GET /api/v1/cobrowse/sessions
 *
 * Slice-3c agent dashboard list — replaces the localStorage cache.
 * Lists the caller's org's recent sessions, newest first. Default
 * filter: the calling agent's sessions (so a busy support org isn't
 * spammed with everyone else's). `mine=false` widens to the whole
 * org for managers.
 *
 * Query params:
 *   status — optional CobrowseStatus filter; comma-separated list
 *            (e.g. `status=active,paused`)
 *   limit  — 1-100, default 50
 *   mine   — "true" (default) or "false"
 *
 * Returns minimal session projection — no joinToken in the list
 * payload to keep secrets out of dashboard JSON visible in browser
 * devtools. Agents view + share tokens via the per-id GET route.
 */
export const GET = withRlsAuth("settings", "read", async (req, auth) => {
  const { searchParams } = new URL(req.url)
  const statusParam = searchParams.get("status")
  // Tightened parsing: explicit "false" widens to org-wide, any
  // other value (default, "true", typo) scopes to the caller.
  // Only "false" — exactly — opts out.
  const mineRaw = searchParams.get("mine")
  const wantMine = mineRaw === null ? true : mineRaw !== "false"
  const limitParam = Number(searchParams.get("limit") || "50")
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 50

  // Status filter — parse + validate the comma-separated list.
  let statuses: CobrowseStatus[] | undefined
  if (statusParam) {
    const parts = statusParam.split(",").map((s) => s.trim()).filter(Boolean)
    const invalid = parts.filter((s) => !COBROWSE_STATUSES.includes(s as CobrowseStatus))
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Unknown status values: ${invalid.join(", ")}. Use one of: ${COBROWSE_STATUSES.join(", ")}` },
        { status: 400 },
      )
    }
    statuses = parts as CobrowseStatus[]
  }

  try {
    const rows = await prisma.cobrowseSession.findMany({
      where: {
        organizationId: auth.orgId,
        ...(wantMine ? { agentUserId: auth.userId } : {}),
        ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {}),
      },
      select: {
        id: true,
        agentUserId: true,
        contactId: true,
        status: true,
        startedAt: true,
        endedAt: true,
        updatedAt: true,
        consentGivenAt: true,
        endReason: true,
        // INTENTIONALLY excluded: joinToken — secrets don't belong
        // in list payloads. Per-id GET surfaces it for the active
        // session viewer.
      },
      orderBy: { startedAt: "desc" },
      take: limit,
    })
    return NextResponse.json({ success: true, sessions: rows })
  } catch (e) {
    console.error("[cobrowse/sessions] GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
