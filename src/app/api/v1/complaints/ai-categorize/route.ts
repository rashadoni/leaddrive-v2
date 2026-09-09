import { NextResponse } from "next/server"
import { categorizeComplaint } from "@/lib/complaint-ai"
import { withRls } from "@/lib/with-rls"
import { isSupportAiEnabled, SUPPORT_AI_DISABLED_ERROR } from "@/lib/ai/support-feature"

// POST { content, brand?, productCategory? } → { riskLevel, department, complaintType, confidence }
export const POST = withRls(async (req, { orgId }) => {
  if (!(await isSupportAiEnabled(orgId))) {
    return NextResponse.json(SUPPORT_AI_DISABLED_ERROR, { status: 403 })
  }

  const body = await req.json()
  const { content, brand, productCategory } = body as {
    content?: string
    brand?: string
    productCategory?: string
  }
  if (!content) return NextResponse.json({ error: "Content required" }, { status: 400 })

  const result = await categorizeComplaint(orgId, { content, brand, productCategory })
  if (!result) {
    return NextResponse.json({ error: "AI unavailable or budget exceeded" }, { status: 429 })
  }
  return NextResponse.json({ data: result })
})
