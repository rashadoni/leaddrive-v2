import { NextResponse } from "next/server"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin, type Role } from "@/lib/permissions"
import { prisma, logAudit } from "@/lib/prisma"
import { customerPhonePrivacyEnabled } from "@/lib/customer-phone-privacy"

export const GET = withRlsSessionAuth(async (_req, auth) => {
  if (!isAdmin(auth.role as Role)) return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const org = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  return NextResponse.json({ data: { enabled: customerPhonePrivacyEnabled(org.settings) } })
})

export const PATCH = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role as Role)) return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 })
  // Atomic JSON key update: concurrent saves of other organization settings survive.
  const count = await prisma.$executeRaw`
    UPDATE organizations
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{hideCustomerPhoneForOperators}', ${JSON.stringify(body.enabled)}::jsonb, true)
    WHERE id = ${auth.orgId}
  `
  if (count !== 1) return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  await logAudit(auth.orgId, "update", "organization", auth.orgId, "customer phone privacy", {
    userId: auth.userId, newValue: { hideCustomerPhoneForOperators: body.enabled },
  })
  return NextResponse.json({ data: { enabled: body.enabled } })
})
