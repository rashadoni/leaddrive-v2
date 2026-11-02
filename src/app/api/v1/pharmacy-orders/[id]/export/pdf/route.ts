import type { PrismaClient } from "@prisma/client"
import { NextResponse, type NextRequest } from "next/server"

import { contentDispositionAttachment } from "@/lib/export/tabular"
import { phoneOrderPdfFile } from "@/lib/pharmacy-orders/manager-notice"
import { phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

type Context = { params: Promise<{ id: string }> }

/** The order as the PDF the pharmacy gets in WhatsApp, to download and forward by hand. */
export const GET = withRlsAuth("deals", "read", async (_req: NextRequest, auth, { params }: Context) => {
  if (!(await phoneOrdersEnabled(auth.orgId))) return NextResponse.json({ error: "not_found" }, { status: 404 })
  const file = await phoneOrderPdfFile(prisma as unknown as PrismaClient, auth.orgId, (await params).id)
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return new NextResponse(file.bytes, { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": contentDispositionAttachment(file.filename),
    "Cache-Control": "no-store",
  } })
})
