/**
 * M4-5 — Two-phase admin gate for MTM mutation endpoints.
 *
 * Extracts the repeated role-check pattern shared by all 5 MTM mutation
 * handlers (regions POST, regions/[id] PATCH+DELETE, teams POST,
 * teams/[id] PATCH+DELETE) into a single reusable helper.
 *
 * Phase 1 — Fast-path (no DB): rejects JWT callers whose role is not in
 *   MTM_ADMIN_ROLES immediately without a DB query.
 * Phase 2 — DB re-check: verifies the agent still holds an admin role in
 *   the database, closing the stale-JWT window (JWT TTL = 7 days).
 *
 * Returns:
 *   null          → caller is allowed to proceed.
 *   NextResponse  → 403 Forbidden; caller must return this response immediately.
 *
 * Web admin-panel callers (no mobile JWT) are always allowed (null).
 */
import { NextResponse, type NextRequest } from "next/server"
import { getMobileAuth } from "@/lib/mobile-auth"
import { isMtmAdminRole, MTM_ADMIN_ROLES, type MtmAgentRoleString } from "@/lib/mtm/territory-scope"
import { prisma as defaultPrisma } from "@/lib/prisma"
import type { PrismaClient } from "@prisma/client"

/**
 * Mutable copy of MTM_ADMIN_ROLES for Prisma's `role: { in: [...] }` param.
 * Typed as MtmAgentRoleString[] (not string[]) so it stays assignable to
 * Prisma's generated MtmAgentRole enum expectation.
 * Lifted to module scope to avoid reallocating a new array on every call.
 */
const ADMIN_ROLES_IN: MtmAgentRoleString[] = [...MTM_ADMIN_ROLES]

export async function assertMtmAdmin(
  req: NextRequest,
  orgId: string,
  /**
   * Prisma client to use for the DB re-check. Defaults to the singleton.
   * Callers that wrap operations in a `$transaction` should pass the
   * transaction client here so the check participates in the same tx context.
   */
  db: Pick<PrismaClient, "mtmAgent"> = defaultPrisma,
): Promise<NextResponse | null> {
  const mobileAuth = getMobileAuth(req)
  if (!mobileAuth) return null // web admin panel: no JWT → unrestricted

  // Phase 1: fast-path rejection — no DB round-trip for clearly non-admin roles
  if (!isMtmAdminRole(mobileAuth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Phase 2: DB re-check — confirms the agent still holds an admin role.
  // Necessary because JWTs have a 7-day TTL (see getMobileAuth); a demotion
  // must take effect immediately rather than persisting until token expiry.
  const agent = await db.mtmAgent.findFirst({
    where: {
      id: mobileAuth.agentId,
      organizationId: orgId,
      role: { in: ADMIN_ROLES_IN },
    },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  return null // both checks pass — caller may proceed
}
