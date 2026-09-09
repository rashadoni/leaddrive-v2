import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { compileOrganizationSourceRoutePlans } from "@/lib/social/source-route-plan"

function sanitizeSocialAccount<T extends { accessToken?: string | null }>(account: T) {
  const { accessToken, ...rest } = account
  return { ...rest, connected: Boolean(accessToken), accessToken: accessToken ? "***" : null }
}

const updateSchema = z.object({
  displayName: z.string().max(200).optional(),
  keywords: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
})

export const PUT = withRlsAuth("social", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const existing = await prisma.socialAccount.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const updated = await prisma.socialAccount.update({ where: { id }, data: parsed.data })
  await compileOrganizationSourceRoutePlans(orgId)
  return NextResponse.json({ success: true, data: sanitizeSocialAccount(updated) })
})

export const DELETE = withRlsAuth("social", "delete", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params
  const existing = await prisma.socialAccount.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // Detach persisted route-plan FKs before deleting the connection. A direct
  // delete would be rejected by the tenant-coherent NO ACTION relation.
  await prisma.socialAccount.update({ where: { id }, data: { isActive: false } })
  await compileOrganizationSourceRoutePlans(orgId)
  await prisma.socialAccount.delete({ where: { id } })
  await compileOrganizationSourceRoutePlans(orgId)
  logAudit(orgId, "delete", "social_account", id, `${existing.platform}:${existing.handle}`)
  return NextResponse.json({ success: true })
})
