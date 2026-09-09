import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmExcelAccess } from "@/lib/mtm/excel-permissions"
import { buildMtmExcelExport, isMtmExcelExportType } from "@/lib/mtm/excel-export"
import { mtmExcelAttachment } from "@/lib/mtm/excel-contract"
import { getMtmSettings } from "@/lib/mtm-settings"

type RouteContext = { params: Promise<{ type: string }> }

export const GET = withRouteFieldWebRlsAuth("read", async (req, auth, context: RouteContext) => {
  const access = await resolveMtmExcelAccess(prisma, auth)
  if (!access.actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const rawType = (await context.params).type.toUpperCase()
  if (!isMtmExcelExportType(rawType)) return NextResponse.json({ error: "Unsupported export type" }, { status: 404 })
  const search = new URL(req.url).searchParams
  const from = search.get("from") ?? ""
  const to = search.get("to") ?? ""
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return NextResponse.json({ error: "Date filters must use YYYY-MM-DD" }, { status: 400 })
  }
  const settings = await getMtmSettings(auth.orgId)
  const workbook = await buildMtmExcelExport({ db: prisma, organizationId: auth.orgId, actor: access.actor, type: rawType, from, to, timezone: settings.timezone })
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const suffix = new Date().toISOString().slice(0, 10)
  return new NextResponse(buffer as unknown as BodyInit, { headers: mtmExcelAttachment(`mtm-${rawType.toLowerCase()}-${suffix}.xlsx`) })
})
