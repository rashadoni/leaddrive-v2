import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  recipient: z.string().trim().max(300).nullable().optional(),
  letterText: z.string().max(50000).nullable().optional(),
  status: z.enum(["draft", "final"]).optional(),
})

export const GET = withRlsAuth("social-legal", "read", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const report = await prisma.socialLegalReport.findFirst({
    where: { id, organizationId: auth.orgId },
    include: {
      cases: {
        include: {
          mention: {
            select: {
              id: true,
              platform: true,
              sourceType: true,
              text: true,
              url: true,
              authorName: true,
              authorHandle: true,
              sentiment: true,
              publishedAt: true,
              createdAt: true,
              evidences: {
                select: { id: true, permalink: true, screenshotUrl: true, capturedAt: true, sourceTrustTier: true },
                orderBy: { capturedAt: "desc" },
                take: 3,
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: report })
})

export const PATCH = withRlsAuth("social-legal", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const report = await prisma.socialLegalReport.findFirst({ where: { id, organizationId: orgId } })
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const { status, ...fields } = parsed.data
  const hasFieldEdits = Object.keys(fields).length > 0
  // A finalized report is frozen: it can only be reopened (status: "draft"),
  // not edited in place.
  if (report.status === "final" && (hasFieldEdits || status === "final")) {
    return NextResponse.json({ error: "Report is finalized — reopen it first" }, { status: 409 })
  }

  const updated = await prisma.socialLegalReport.update({
    where: { id: report.id },
    data: {
      ...(fields.title !== undefined ? { title: fields.title } : {}),
      ...(fields.recipient !== undefined ? { recipient: fields.recipient } : {}),
      ...(fields.letterText !== undefined
        ? { letterText: fields.letterText, letterSource: fields.letterText ? "manual" : "none" }
        : {}),
      ...(status === "final"
        ? { status: "final", finalizedBy: auth.userId || null, finalizedAt: new Date() }
        : {}),
      ...(status === "draft" && report.status === "final"
        ? { status: "draft", finalizedBy: null, finalizedAt: null }
        : {}),
    },
  })

  logAudit(orgId, "social_legal_report_updated", "social_legal_report", report.id, updated.title, {
    newValue: { status: updated.status, edited: Object.keys(parsed.data) },
  })

  return NextResponse.json({ success: true, data: updated })
})

/** Delete a DRAFT report; its cases return to the open pool. */
export const DELETE = withRlsAuth("social-legal", "write", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  const report = await prisma.socialLegalReport.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, status: true, title: true },
  })
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (report.status === "final") {
    return NextResponse.json({ error: "Finalized reports cannot be deleted" }, { status: 409 })
  }

  await prisma.socialLegalCase.updateMany({
    where: { organizationId: orgId, reportId: report.id },
    data: { reportId: null, status: "open" },
  })
  await prisma.socialLegalReport.delete({ where: { id: report.id } })

  logAudit(orgId, "social_legal_report_deleted", "social_legal_report", report.id, report.title)

  return NextResponse.json({ success: true })
})
