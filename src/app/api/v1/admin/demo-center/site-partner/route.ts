import { NextRequest, NextResponse } from "next/server"
import { isDemoPartnerSite, normalizePartnerEmail, setSitePartnerEmail } from "@/lib/demo-center/site-partner"
import { requireSuperAdmin } from "@/lib/superadmin-guard"

/**
 * Who hears about each demo request from a partner's site
 * (src/lib/demo-center/site-partner.ts). Superadmin only. An empty email clears it.
 */
export async function PUT(request: NextRequest) {
  const actor = await requireSuperAdmin(request)
  if (actor instanceof NextResponse) return actor

  const body = (await request.json().catch(() => null)) as { site?: unknown; email?: unknown } | null
  if (!isDemoPartnerSite(body?.site)) {
    return NextResponse.json({ success: false, code: "unknown_site" }, { status: 400 })
  }
  const raw = typeof body?.email === "string" ? body.email.trim() : ""
  const email = raw === "" ? null : normalizePartnerEmail(raw)
  if (raw !== "" && !email) {
    return NextResponse.json({ success: false, code: "invalid_email" }, { status: 400 })
  }

  const result = await setSitePartnerEmail(body.site, email)
  if (result === "unavailable") {
    return NextResponse.json({ success: false, code: "no_sales_organization" }, { status: 409 })
  }
  console.info("[demo-center] site partner email", { site: body.site, result, actorId: actor.userId })
  return NextResponse.json({ success: true, site: body.site, email })
}
