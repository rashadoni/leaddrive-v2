import { NextResponse } from "next/server"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import {
  buildMtmExcelTemplate,
  isMtmExcelImportType,
  mtmExcelAttachment,
  type MtmExcelLocale,
} from "@/lib/mtm/excel-contract"

type RouteContext = { params: Promise<{ type: string }> }

export const GET = withRouteFieldWebRlsAuth<RouteContext>("read", async (req, _auth, context) => {
  const { type: rawType } = await context.params
  const type = rawType.toUpperCase()
  if (!isMtmExcelImportType(type)) return NextResponse.json({ error: "Unsupported template type" }, { status: 404 })
  const requestedLocale = new URL(req.url).searchParams.get("locale")
  const locale: MtmExcelLocale = requestedLocale === "az" || requestedLocale === "ru" ? requestedLocale : "en"
  const workbook = buildMtmExcelTemplate(type, locale)
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: mtmExcelAttachment(`mtm-${type.toLowerCase()}-template-v1.xlsx`),
  })
})
