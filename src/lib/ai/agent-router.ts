import { prisma } from "@/lib/prisma"
import { classifyIntent, type Intent } from "./intent-classifier"

// Intent → agentType mapping
const INTENT_TO_AGENT: Record<Intent, string> = {
  sales_inquiry: "sales",
  support_request: "support",
  billing_question: "support",
  marketing_info: "marketing",
  data_analysis: "analyst",
  general: "general",
}

export async function routeToAgent(orgId: string, message: string, previousAgentId?: string) {
  const { intent, confidence } = await classifyIntent(message)
  const preferredType = INTENT_TO_AGENT[intent]

  // 1. Find specialized agent
  let agent = await prisma.aiAgentConfig.findFirst({
    where: {
      organizationId: orgId,
      isActive: true,
      agentType: preferredType,
    },
    orderBy: { priority: "desc" },
  })

  // 2. Fallback: general agent
  if (!agent) {
    agent = await prisma.aiAgentConfig.findFirst({
      where: { organizationId: orgId, isActive: true, agentType: "general" },
      orderBy: { priority: "desc" },
    })
  }

  // 3. Last-resort fallback: any active agent — but NEVER the omnichannel "inbox" persona.
  //    The inbox agent (e.g. the "Gobustone" social greeting + menu) is customer-facing and
  //    belongs ONLY to generateChannelAiReply; it must not bleed into the internal CRM in-app
  //    chat. Excluding it keeps the per-group-agent boundary (same fix as whatsapp/portal).
  if (!agent) {
    agent = await prisma.aiAgentConfig.findFirst({
      where: { organizationId: orgId, isActive: true, agentType: { not: "inbox" } },
      orderBy: { priority: "desc" },
    })
  }

  return {
    agent,
    intent,
    confidence,
    isHandoff: previousAgentId ? agent?.id !== previousAgentId : false,
  }
}
