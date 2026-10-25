/** GET ?voen=…&exclude=<id> — another company of this organization with the same VÖEN, for the form's warning. */
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { normaliseVoen } from "@/lib/companies/az-taxpayer-registry"
import { companyWithVoen } from "@/lib/companies/voen-duplicate"

export const GET = withRlsAuth("companies", "write", async (req, { orgId }) => {
  const params = new URL(req.url).searchParams
  const voen = normaliseVoen(params.get("voen"))
  if (!voen) return NextResponse.json({ error: "VÖEN is ten digits", code: "INVALID_VOEN" }, { status: 400 })
  return NextResponse.json({ success: true, data: { duplicate: await companyWithVoen(orgId, voen, params.get("exclude")) } })
})
