import { NextResponse } from "next/server"
import { z } from "zod"
import { categorizeComplaint } from "@/lib/complaint-ai"
import { withRlsAuth } from "@/lib/with-rls"
import { isSupportAiEnabled, SUPPORT_AI_DISABLED_ERROR } from "@/lib/ai/support-feature"

// POST { content, brand?, productCategory? } → { riskLevel, department, complaintType, confidence }
export const POST = withRlsAuth("tickets", "write", async (req, { orgId }) => {
  if (!(await isSupportAiEnabled(orgId))) {
    return NextResponse.json(SUPPORT_AI_DISABLED_ERROR, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = z.object({
    content: z.string().trim().min(1).max(10000),
    brand: z.string().max(200).optional(),
    productCategory: z.string().max(200).optional(),
  }).safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const { content, brand, productCategory } = parsed.data

  const result = await categorizeComplaint(orgId, { content, brand, productCategory })
  if (!result) {
    return NextResponse.json({ error: "AI unavailable or budget exceeded" }, { status: 429 })
  }
  return NextResponse.json({ data: result })
})
