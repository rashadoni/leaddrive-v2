/**
 * Admin gate for MTM org-structure mutations: regions POST, regions/[id]
 * PATCH+DELETE, teams POST, teams/[id] PATCH+DELETE.
 *
 * Regions and teams define every manager's territory, so changing them is an
 * administrator's act. Until the scope audit of 2026-09-14 this gate let every
 * web caller through ("web admin panel: unrestricted") — any web user with MTM
 * write could move a team into their own region and so pull its agents into
 * their scope. Now:
 *
 *   - browser session: web admin/superadmin, or a user whose MTM card
 *     (oldest ACTIVE one, the same card resolveMtmRouteActor picks) is ADMIN;
 *   - mobile JWT: role ADMIN, re-checked in the database (a demotion must take
 *     effect before the 7-day token expires). MANAGER no longer qualifies —
 *     and these paths are web-only for mobile tokens anyway (mtm-web-only.ts);
 *   - API key (no session, no JWT): allowed — keys are created by
 *     administrators and resolve with the admin role everywhere in MTM.
 *
 * Returns null when the caller may proceed, otherwise a 403 to return as is.
 */
import { NextResponse, type NextRequest } from "next/server"
import { getMobileAuth } from "@/lib/mobile-auth"
import { prisma as defaultPrisma } from "@/lib/prisma"
import type { PrismaClient } from "@prisma/client"
import type { AuthResult } from "@/lib/api-auth"

function forbidden() {
  return NextResponse.json(
    { error: "Forbidden", code: "MTM_STRUCTURE_ADMIN_REQUIRED" },
    { status: 403 },
  )
}

export async function assertMtmAdmin(
  req: NextRequest,
  auth: { orgId: string; session: AuthResult | null },
  /**
   * Prisma client to use for the DB re-check. Defaults to the singleton.
   * Callers that wrap operations in a `$transaction` should pass the
   * transaction client here so the check participates in the same tx context.
   */
  db: Pick<PrismaClient, "mtmAgent"> = defaultPrisma,
): Promise<NextResponse | null> {
  const { orgId, session } = auth

  if (session) {
    if (session.role === "superadmin" || session.role === "admin") return null
    const card = await db.mtmAgent.findFirst({
      where: { organizationId: orgId, userId: session.userId, status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { role: true },
    })
    return card?.role === "ADMIN" ? null : forbidden()
  }

  const mobileAuth = getMobileAuth(req)
  if (!mobileAuth) return null // API key: administrator-issued integration

  // Fast-path rejection — no DB round-trip for a non-admin token.
  if (mobileAuth.role !== "ADMIN") return forbidden()

  // DB re-check — confirms the agent still holds the ADMIN role.
  const agent = await db.mtmAgent.findFirst({
    where: {
      id: mobileAuth.agentId,
      organizationId: orgId,
      role: "ADMIN",
      status: "ACTIVE",
    },
    select: { id: true },
  })
  if (!agent) return forbidden()

  return null
}
