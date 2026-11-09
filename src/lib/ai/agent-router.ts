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

/**
 * The agent types that ARE Da Vinci personas — the ones an intent can ask for.
 * Every other type is a module's own agent with its own job and its own prompt:
 * "inbox" (the omnichannel greeting + menu), "social" (the Social Monitoring
 * group's social-care drafter), "contract" (CLM), "advisor", … They answer
 * customers or do one task; none of them is the CRM assistant for staff.
 */
export const CHAT_AGENT_TYPES: readonly string[] = [...new Set(Object.values(INTENT_TO_AGENT))]

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
 * The intent is read from the question's words (`classifyIntent`), and only
 * when it can change the pick. On prod (2026-11-08) 10 of 13 organisations
 * have no active agent or exactly one — Zeytun among them — and every intent
 * lands on the same agent there. Until 2026-11-09 the intent was a Haiku call
 * that the first word waited 1.1–1.6 s for (src/lib/ai/intent-classifier.ts).
 *
 * The internal chat answers staff only as a Da Vinci persona
 * (`CHAT_AGENT_TYPES`). Until 2026-11-09 only the "inbox" persona was kept
 * out, so in five organisations whose single agent was the Social Monitoring
 * one (Zeytun Pharma among them) every CRM question went to "the official
 * social-care drafting assistant", with its prompt. An organisation with no
 * Da Vinci persona gets `agent: null` — the plain Da Vinci, as most do.
 */
export async function routeToAgent(orgId: string, message: string, previousAgentId?: string) {
  const agents: AgentRow[] = await prisma.aiAgentConfig.findMany({
    where: { organizationId: orgId, isActive: true, agentType: { in: [...CHAT_AGENT_TYPES] } },
    orderBy: { priority: "desc" },
  })

  const intents = Object.keys(INTENT_TO_AGENT) as Intent[]
  const outcomes = new Set(intents.map((intent) => agentFor(intent, agents)?.id ?? null))
  const { intent, confidence } = outcomes.size > 1
    ? classifyIntent(message)
    // Nothing to choose between: no claim about the intent.
    : { intent: "general" as Intent, confidence: 1 }
  const agent = agentFor(intent, agents)

  return {
    agent,
    intent,
    confidence,
    /** Whether there was more than one agent to choose between. */
    classified: outcomes.size > 1,
    isHandoff: previousAgentId ? agent?.id !== previousAgentId : false,
  }
}
