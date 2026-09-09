import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { generateInvoiceNumber } from "@/lib/invoice-number"

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const number = await generateInvoiceNumber(orgId)
    return NextResponse.json({ success: true, data: { number } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
