import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

/**
 * A5 — debug view of a single AI interaction ("как сформирован ответ").
 * Admin/manager only: the row carries the customer's message and the raw model
 * output — operator-facing UI shows it via the AI badge drawer (metadata.aiLogId).
 */
export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  const role = session?.role
  if (role !== "admin" && role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const { id } = await params
  const log = await prisma.aiInteractionLog.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true, data: log })
})
