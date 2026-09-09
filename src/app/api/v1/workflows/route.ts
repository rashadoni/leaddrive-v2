import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  entityType: z.string().min(1),
  triggerEvent: z.string().min(1),
  conditions: z.record(z.string(), z.any()).optional().default({}),
  isActive: z.boolean().optional().default(true),
})

export const GET = withRlsAuth("settings", "read", async (_req, { orgId }) => {
  try {
    const workflows = await prisma.workflowRule.findMany({
      where: { organizationId: orgId },
      include: {
        actions: {
          orderBy: { actionOrder: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ success: true, data: workflows })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("settings", "write", async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createWorkflowSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const workflow = await prisma.workflowRule.create({
      data: {
        organizationId: orgId,
        ...parsed.data,
      },
      include: {
        actions: true,
      },
    })
    return NextResponse.json({ success: true, data: workflow }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
