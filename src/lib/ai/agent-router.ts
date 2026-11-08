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

type AgentRow = NonNullable<Awaited<ReturnType<typeof prisma.aiAgentConfig.findFirst>>>

/** The agent an intent lands on: its specialist, else a general agent, else any. */
function agentFor(intent: Intent, agents: readonly AgentRow[]): AgentRow | null {
  const preferredType = INTENT_TO_AGENT[intent]
  return agents.find((agent) => agent.agentType === preferredType)
    ?? agents.find((agent) => agent.agentType === "general")
    ?? agents[0]
    ?? null
}

/**
 * Picks the org's agent for a chat message.
 *
 * The intent classifier is a model call (Haiku) in front of every Da Vinci
 * answer, so it runs only when its answer can change the pick. On prod
 * (2026-11-08) 10 of 13 organisations have no active agent or exactly one —
 * Zeytun among them — and every intent lands on the same agent there; asking
 * the model first only delayed the answer's first word.
 *
 * The internal chat NEVER gets the omnichannel "inbox" persona (e.g. the
 * Gobustone social greeting + menu): it is customer-facing and belongs only
 * to generateChannelAiReply.
 */
export async function routeToAgent(orgId: string, message: string, previousAgentId?: string) {
  const agents: AgentRow[] = await prisma.aiAgentConfig.findMany({
    where: { organizationId: orgId, isActive: true, agentType: { not: "inbox" } },
    orderBy: { priority: "desc" },
  })

  const intents = Object.keys(INTENT_TO_AGENT) as Intent[]
  const outcomes = new Set(intents.map((intent) => agentFor(intent, agents)?.id ?? null))
  const { intent, confidence } = outcomes.size > 1
    ? await classifyIntent(message)
    // Nothing to choose between: no model call, and no claim about the intent.
    : { intent: "general" as Intent, confidence: 1 }
  const agent = agentFor(intent, agents)

  return {
    agent,
    intent,
    confidence,
    isHandoff: previousAgentId ? agent?.id !== previousAgentId : false,
  }
}
