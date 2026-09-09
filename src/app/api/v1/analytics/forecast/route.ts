import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { generateRevenueForecast } from "@/lib/ai/predictive"

export const GET = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const months = parseInt(req.nextUrl.searchParams.get("months") || "6")

  try {
    const forecast = await generateRevenueForecast(orgId, months)
    return NextResponse.json({ success: true, data: forecast })
  } catch (e: any) {
    console.error("Forecast error:", e)
    return NextResponse.json({ error: "Failed to generate forecast" }, { status: 500 })
  }
})
