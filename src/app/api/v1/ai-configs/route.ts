import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { KNOWN_AI_MODELS } from "@/lib/ai/budget"
import { withRls, withRlsAuth } from "@/lib/with-rls"

const createConfigSchema = z.object({
  configName: z.string().min(1).max(255),
  model: z.string().refine((m) => KNOWN_AI_MODELS.includes(m), { message: "Unsupported model" }).optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
  systemPrompt: z.string().optional(),
  // Approved product facts, kept apart from the behaviour rules above so that
  // editing a price cannot disturb how the assistant behaves.
  knowledgeBase: z.string().max(20000).optional(),
  // "az" | "ru" | "en", or null to follow whatever the customer wrote.
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

export const GET = withRls(async (_req: NextRequest, { orgId }) => {
  try {
    const configs = await prisma.aiAgentConfig.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({ success: true, data: { configs } })
  } catch (e) {
    console.error("[ai-configs GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("ai", "write", async (req, auth) => {
  const { orgId } = auth

  const body = await req.json()
  const parsed = createConfigSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const data = normalizeToolsEnabled(parsed.data)
    // The inbox agent is a per-org SINGLETON (the auto-reply engine reads exactly one
    // active agentType="inbox"). Upsert on (orgId, "inbox") so a re-save / second tab /
    // failed id-capture / direct API call can never create duplicate inbox agents that
    // the engine would then pick between non-deterministically.
    if (data.agentType === "inbox") {
      // Filter intentionally omits isActive — the singleton is per (org, agentType),
      // NOT per active-flag; we reuse the existing inbox row whatever its isActive is
      // (Prisma update with the spread `data` only touches the fields actually sent).
      const existing = await prisma.aiAgentConfig.findFirst({
        where: { organizationId: orgId, agentType: "inbox" },
        select: { id: true },
      })
      if (existing) {
        const updated = await prisma.aiAgentConfig.update({ where: { id: existing.id }, data })
        return NextResponse.json({ success: true, data: updated }, { status: 200 })
      }
    }
    const config = await prisma.aiAgentConfig.create({
      data: {
        organizationId: orgId,
        ...data,
      },
    })
    return NextResponse.json({ success: true, data: config }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
