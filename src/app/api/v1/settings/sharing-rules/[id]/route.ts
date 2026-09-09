import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const updateRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  ruleType: z.enum(["owner", "role", "team", "all"]).optional(),
  sourceRole: z.string().optional(),
  targetRole: z.string().optional(),
  accessLevel: z.enum(["read", "readwrite"]).optional(),
  isActive: z.boolean().optional(),
})

export const PUT = withRlsAuth("settings", "admin", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await req.json()
  const parsed = updateRuleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const rule = await prisma.sharingRule.updateMany({
      where: { id, organizationId: auth.orgId },
      data: parsed.data,
    })
    if (rule.count === 0) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Sharing rule PUT error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("settings", "admin", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const result = await prisma.sharingRule.deleteMany({
      where: { id, organizationId: auth.orgId },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Sharing rule DELETE error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
