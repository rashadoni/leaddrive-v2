import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { markPurchasesOfChangedDeal } from "@/lib/procurement/deal-changes"

/**
 * The journal of changes the customer agreed to (docs/sales-procurement/README.md,
 * task 5.2): the layout, a size, a quantity, a price, a date — before, after,
 * who on the customer's side confirmed it, when and how, the confirmation file.
 * Rows are added, never edited: it is the record of what was agreed. A new row
 * flags the order's open purchases «the deal changed — check it».
 */
type Ctx = { params: Promise<{ id: string }> }

const KINDS = ["layout", "size", "quantity", "price", "deadline", "other"] as const
const CHANNELS = ["email", "whatsapp", "phone", "meeting", "other"] as const

export const GET = withRlsAuth("deals", "read", async (_req, { orgId }, { params }: Ctx) => {
  const { id } = await params
  const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true } })
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const rows = await prisma.dealChangeApproval.findMany({
    where: { dealId: id, organizationId: orgId },
    orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
    include: { file: { select: { id: true, originalName: true, fileName: true } } },
  })
  return NextResponse.json({
    success: true,
    data: rows.map((row: { file: { id: string; originalName: string; fileName: string } | null }) => ({
      ...row,
      file: row.file ? { id: row.file.id, originalName: row.file.originalName, url: `/api/v1/uploads/deal-files/${row.file.fileName}` } : null,
    })),
  })
})

const schema = z.object({
  kind: z.enum(KINDS),
  before: z.string().trim().max(1000).optional().nullable(),
  after: z.string().trim().min(1).max(1000),
  approvedByName: z.string().trim().min(1).max(200),
  approvedAt: z.string().max(40),
  channel: z.enum(CHANNELS),
  note: z.string().trim().max(2000).optional().nullable(),
  fileId: z.string().max(64).optional().nullable(),
}).strict()

export const POST = withRlsAuth("deals", "write", async (req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 })
  const input = parsed.data
  const approvedAt = new Date(input.approvedAt)
  if (Number.isNaN(approvedAt.getTime()) || approvedAt.getTime() > Date.now() + 86_400_000) {
    return NextResponse.json({ error: "Invalid date", code: "INVALID_DATE" }, { status: 400 })
  }
  const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true, name: true } })
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
  if (input.fileId) {
    const file = await prisma.dealFile.findFirst({ where: { id: input.fileId, dealId: id, organizationId: orgId }, select: { id: true } })
    if (!file) return NextResponse.json({ error: "The file is not of this deal", code: "FOREIGN_FILE" }, { status: 400 })
  }
  const row = await prisma.dealChangeApproval.create({
    data: {
      organizationId: orgId,
      dealId: id,
      kind: input.kind,
      before: input.before || null,
      after: input.after,
      approvedByName: input.approvedByName,
      approvedAt,
      channel: input.channel,
      note: input.note || null,
      fileId: input.fileId || null,
      createdBy: userId,
    },
  })
  logAudit(orgId, "change_approved", "deal", id, deal.name, { newValue: { kind: input.kind, before: input.before ?? null, after: input.after, by: input.approvedByName, channel: input.channel }, userId })
  await markPurchasesOfChangedDeal(orgId, userId, id, deal.name, `${input.kind}: ${input.before ? `${input.before} → ` : ""}${input.after}`)
  return NextResponse.json({ success: true, data: row }, { status: 201 })
})
