import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { KNOWN_AI_MODELS } from "@/lib/ai/budget"

const updateConfigSchema = z.object({
  configName: z.string().min(1).max(255).optional(),
  model: z.string().refine((m) => KNOWN_AI_MODELS.includes(m), { message: "Unsupported model" }).optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
  systemPrompt: z.string().optional(),
  // Approved product facts, kept apart from the behaviour rules above so that
  // editing a price cannot disturb how the assistant behaves.
  knowledgeBase: z.string().max(20000).optional(),
  replyLanguage: z.enum(["az", "ru", "en"]).nullable().optional(),
  toolsEnabled: z.union([z.string(), z.array(z.string())]).optional(),
  escalationEnabled: z.boolean().optional(),
  escalationRules: z.array(z.string()).optional(),
  kbEnabled: z.boolean().optional(),
  kbMaxArticles: z.number().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
  autoLeadEnabled: z.boolean().optional(),
  autoAssignSales: z.boolean().optional(),
  autonomousBacklogEnabled: z.boolean().optional(),
  autonomousLookbackDays: z.number().int().min(1).max(30).optional(),
  autonomousBatchSize: z.number().int().min(1).max(100).optional(),
  // Multi-agent orchestration fields
  agentType: z.enum(["sales", "support", "marketing", "analyst", "contract", "general", "inbox", "social"]).optional(),
  department: z.string().max(100).optional(),
  priority: z.number().int().optional(),
  handoffTargets: z.array(z.string()).optional(),
  intents: z.array(z.string()).optional(),
  greeting: z.string().max(1000).optional(),
  maxToolRounds: z.number().int().optional(),
})

function normalizeToolsEnabled(data: any): any {
  if (typeof data.toolsEnabled === "string") {
    data.toolsEnabled = data.toolsEnabled
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean)
  }
  return data
}

export const GET = withRls(async (
  _req: NextRequest,
  { orgId },
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params

  try {
    const config = await prisma.aiAgentConfig.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!config) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: config })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
})

export const PUT = withRlsAuth("ai", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const { id } = await params
  const body = await req.json()
  const parsed = updateConfigSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const result = await prisma.aiAgentConfig.updateMany({
      where: { id, organizationId: orgId },
      data: normalizeToolsEnabled({ ...parsed.data }),
    })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const updated = await prisma.aiAgentConfig.findFirst({ where: { id, organizationId: orgId } })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// The settings editor uses PATCH because it updates only the Inbox-agent
// controls. Keep PUT for existing API clients and give PATCH identical,
// partial-update semantics.
export const PATCH = PUT

export const DELETE = withRlsAuth("ai", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId } = auth
  const { id } = await params

  try {
    const result = await prisma.aiAgentConfig.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
