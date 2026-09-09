import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { buildMtmExcelErrorWorkbook, mtmExcelAttachment, type MtmExcelLocale } from "@/lib/mtm/excel-contract"

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRouteFieldWebRlsAuth("read", async (req, auth, context: RouteContext) => {
  const { id } = await context.params
  const job = await prisma.mtmImportJob.findFirst({ where: { id, organizationId: auth.orgId }, select: { id: true, rowErrors: { orderBy: [{ rowNumber: "asc" }, { columnName: "asc" }] } } })
  if (!job) return NextResponse.json({ error: "Import job not found" }, { status: 404 })
  const requestedLocale = new URL(req.url).searchParams.get("locale")
  const locale: MtmExcelLocale = requestedLocale === "az" || requestedLocale === "ru" ? requestedLocale : "en"
  const buffer = await buildMtmExcelErrorWorkbook(job.rowErrors.map((error: {
    sheetName: string
    rowNumber: number
    columnName: string | null
    errorCode: string
    message: string
    rawValue: unknown
  }) => ({
    sheetName: error.sheetName,
    rowNumber: error.rowNumber,
    columnName: error.columnName,
    errorCode: error.errorCode,
    message: error.message,
    rawValue: error.rawValue,
  })), locale)
  return new NextResponse(buffer as unknown as BodyInit, { headers: mtmExcelAttachment(`mtm-import-${id}-errors.xlsx`) })
})
