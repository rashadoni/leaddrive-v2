import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { buildMobileConfig } from "@/lib/mtm/mobile-config"

/** GET /api/v1/mtm/mobile/config?sinceVersion=... */
export const GET = withMobileRls(async (req, auth) => {
  try {
    const [rows, contactDictionaries] = await Promise.all([
      prisma.mtmSetting.findMany({
        where: {
          organizationId: auth.orgId,
          OR: [
            { key: { startsWith: "dictionary:" } },
            { key: { startsWith: "formula:" } },
          ],
        },
        select: { key: true, value: true, updatedAt: true },
        orderBy: { updatedAt: "asc" },
      }),
      prisma.mtmContactDictionary.findMany({
        where: { organizationId: auth.orgId, status: "ACTIVE" },
        select: {
          id: true,
          kind: true,
          version: true,
          nameRu: true,
          nameAz: true,
          nameEn: true,
          entries: true,
          entriesHash: true,
          approvalReference: true,
          sourceSystem: true,
          sourceReference: true,
          sourceObservedAt: true,
          effectiveFrom: true,
          signedAt: true,
          updatedAt: true,
        },
        orderBy: { kind: "asc" },
      }),
    ])
    const config = buildMobileConfig(rows, contactDictionaries)
    const sinceVersion = new URL(req.url).searchParams.get("sinceVersion")
    if (sinceVersion && sinceVersion === config.version) {
      return NextResponse.json({ success: true, data: { version: config.version, changed: false } })
    }
    return NextResponse.json({ success: true, data: { ...config, changed: true } })
  } catch (error) {
    console.error("[MTM/mobile/config GET]", error)
    return NextResponse.json({ error: "Failed to load mobile config" }, { status: 500 })
  }
})
