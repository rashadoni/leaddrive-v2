import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * Manage the suppression list for a survey. List + manual add (for handling
 * complaints by phone/email outside the public unsubscribe link).
 *
 * Survey-scoped: only rows where surveyId === id OR surveyId IS NULL (org-wide).
 */
export const GET = withRlsAuth("campaigns", "read", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const rows = await prisma.surveyUnsubscribe.findMany({
    where: { organizationId: orgId, OR: [{ surveyId: id }, { surveyId: null }] },
    orderBy: { createdAt: "desc" },
    take: 500,
  })
  return NextResponse.json({ success: true, data: { unsubscribes: rows } })
})

const addSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(3).max(50).optional(),
  scope: z.enum(["survey", "org"]).default("survey"),
}).refine(d => d.email || d.phone, { message: "email or phone required" })

export const POST = withRlsAuth("campaigns", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const body = await req.json()
  const parsed = addSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const surveyId = parsed.data.scope === "org" ? null : id
  const created = await prisma.surveyUnsubscribe.create({
    data: {
      organizationId: orgId,
      surveyId,
      email: parsed.data.email?.toLowerCase() || null,
      phone: parsed.data.phone || null,
    },
  })
  return NextResponse.json({ success: true, data: created })
})

export const DELETE = withRlsAuth("campaigns", "write", async (req, auth, _ctx) => {
  const orgId = auth.orgId
  const url = new URL(req.url)
  const rowId = url.searchParams.get("rowId")
  if (!rowId) return NextResponse.json({ error: "rowId required" }, { status: 400 })

  const existing = await prisma.surveyUnsubscribe.findFirst({ where: { id: rowId, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await prisma.surveyUnsubscribe.delete({ where: { id: rowId } })
  return NextResponse.json({ success: true })
})
