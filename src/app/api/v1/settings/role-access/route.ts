import { NextResponse } from "next/server"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin, type Role } from "@/lib/permissions"
import { prisma, logAudit } from "@/lib/prisma"
import { cleanRoleAccess, readRoleAccess } from "@/lib/role-access"
import { rememberRoleAccess } from "@/lib/role-access-server"

/**
 * The organization's own rights for its roles (lib/role-access.ts): read and
 * replaced as a whole by an admin from «Rollar və İcazələr». Only the
 * differences from the built-in rights are sent and kept.
 */
export const GET = withRlsSessionAuth(async (_req, auth) => {
  if (!isAdmin(auth.role as Role)) return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const org = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  return NextResponse.json({ data: { roleAccess: readRoleAccess(org.settings) } })
})

export const PUT = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role as Role)) return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object" || !("roleAccess" in body)) {
    return NextResponse.json({ error: "roleAccess is required" }, { status: 400 })
  }
  // A cell that may not be changed (admin, Settings, Users…) is refused, not
  // quietly dropped: the screen must not show a save that did not happen.
  const { map, rejected } = cleanRoleAccess((body as { roleAccess: unknown }).roleAccess)
  if (rejected.length > 0) {
    return NextResponse.json({ error: "These rights cannot be changed", rejected }, { status: 400 })
  }
  const before = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  if (!before) return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  // Atomic JSON key update: concurrent saves of other organization settings survive.
  const count = await prisma.$executeRaw`
    UPDATE organizations
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{roleAccess}', ${JSON.stringify(map)}::jsonb, true)
    WHERE id = ${auth.orgId}
  `
  if (count !== 1) return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  rememberRoleAccess(auth.orgId, { roleAccess: map })
  await logAudit(auth.orgId, "update", "organization", auth.orgId, "role access", {
    userId: auth.userId, oldValue: { roleAccess: readRoleAccess(before.settings) }, newValue: { roleAccess: map },
  })
  return NextResponse.json({ data: { roleAccess: map } })
})
