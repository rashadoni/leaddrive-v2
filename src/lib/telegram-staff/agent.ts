/**
 * One employee message → one reply. The model (the same Claude as Da Vinci,
 * under the organization's AI budget) reads through the voice assistant's read
 * tools — already scoped to the user's role, hidden modules and division — and
 * may only PROPOSE a lead or a task; the write happens on the employee's press
 * (actions.ts). Nothing from src/lib/ai/tools.ts is reachable from here.
 */
import type Anthropic from "@anthropic-ai/sdk"
import { prisma } from "@/lib/prisma"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { checkAiBudget, resolveAiModel } from "@/lib/ai/budget"
import { voiceTools } from "@/lib/ai/voice/realtime-tool-contract"
import { VOICE_TOOL_NAMES, type VoiceToolName } from "@/lib/ai/voice/read-tools"
import { executeVoiceReadTool } from "@/lib/ai/voice/execute-read-tool"
import type { StaffActor } from "./actor"
import { isProposeTool, PROPOSE_TOOLS, proposeAction } from "./actions"

const MAX_ROUNDS = 5
const MAX_TURNS_KEPT = 8
const RESULT_CHARS = 8_000

export type Turn = { role: "user" | "assistant"; text: string }

export interface AgentReply {
  text: string
  actionId?: string
  /** Whether the AI budget refused the message before any model call. */
  budgetExhausted?: boolean
}

const READ_TOOL_NAMES = new Set<string>(VOICE_TOOL_NAMES)

function readTools(): Anthropic.Tool[] {
  return voiceTools(undefined, "az", false)
    .filter((tool) => READ_TOOL_NAMES.has(tool.name))
    .map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters as Anthropic.Tool.InputSchema }))
}

function systemPrompt(actor: StaffActor, now: Date): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" }).format(now)
  return [
    "You are the CRM assistant in a Telegram chat with one employee of a company that uses LeadDrive CRM.",
    `The employee is ${actor.name || "an employee"} (role: ${actor.role}). Today is ${today}, Asia/Baku time.`,
    // Owner 2026-10-25: «пусть говорит всегда по умолчанию на азербайджанском».
    "Always answer in Azerbaijani, even when the employee writes in Russian or English; switch only if they explicitly ask you to speak another language. Plain text only: no Markdown, no tables. Be short — a few lines, lists of at most 10 items.",
    "Use the tools for every fact about the CRM; never invent names, amounts, dates or ids, and never show internal ids.",
    "If a tool answers NOT_PERMITTED, MODULE_NOT_ENABLED or similar, say plainly that this is not available to the employee.",
    "You cannot change anything yourself. To create a lead or a task, call propose_create_lead or propose_create_task; the employee then confirms with a button. Never claim something was created. After a proposal, write one short sentence — the card with the buttons already shows the details, do not repeat them.",
    "Phone numbers: the country is Azerbaijan (+994) unless the employee writes another country code; never ask for the country. Pass them exactly as written. If the tool answers PHONE_NEEDS_CODE or PHONE_INVALID, ask the employee for the missing code or the full number, listing the codes the tool gives.",
    "You cannot send messages to customers, delete or edit records.",
  ].join("\n")
}

export function trimTurns(turns: Turn[]): Turn[] {
  return turns.slice(-MAX_TURNS_KEPT).map((turn) => ({ role: turn.role, text: turn.text.slice(0, 1500) }))
}

export async function runStaffAgent(input: {
  actor: StaffActor
  linkId: string
  text: string
  history: Turn[]
  now?: Date
  client?: Pick<Anthropic, "messages">
}): Promise<AgentReply> {
  const { actor, linkId } = input
  const now = input.now ?? new Date()
  const budget = await checkAiBudget(actor.orgId)
  if (!budget.allowed) return { text: "", budgetExhausted: true }

  const client = input.client ?? getAnthropicClient()
  const model = resolveAiModel(undefined)
  const tools: Anthropic.Tool[] = [...readTools(), ...PROPOSE_TOOLS.map((tool) => ({ ...tool, input_schema: tool.input_schema as Anthropic.Tool.InputSchema }))]
  const messages: Anthropic.MessageParam[] = [
    ...trimTurns(input.history).map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user", content: input.text.slice(0, 2000) },
  ]
  const started = Date.now()
  let inputTokens = 0
  let outputTokens = 0
  const toolsCalled: string[] = []
  let actionId: string | undefined
  let reply = ""

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await client.messages.create({ model, max_tokens: 1024, system: systemPrompt(actor, now), tools, messages })
    inputTokens += response.usage?.input_tokens ?? 0
    outputTokens += response.usage?.output_tokens ?? 0
    reply = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text).join("\n").trim()
    const calls = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
    if (response.stop_reason !== "tool_use" || calls.length === 0) break

    messages.push({ role: "assistant", content: response.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const call of calls) {
      toolsCalled.push(call.name)
      let content: string
      if (isProposeTool(call.name)) {
        const proposed = await proposeAction(actor, linkId, call.name, call.input, now)
        if (proposed.actionId) actionId = proposed.actionId
        content = proposed.result
      } else if (READ_TOOL_NAMES.has(call.name)) {
        const outcome = await executeVoiceReadTool({
          toolName: call.name as VoiceToolName,
          filter: call.input,
          auth: { orgId: actor.orgId, userId: actor.userId, role: actor.role, hiddenModules: actor.hiddenModules },
        })
        content = JSON.stringify(outcome.body).slice(0, RESULT_CHARS)
      } else {
        content = "UNKNOWN_TOOL"
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content })
    }
    messages.push({ role: "user", content: results })
  }

  await prisma.aiInteractionLog.create({
    data: {
      organizationId: actor.orgId,
      userMessage: input.text.slice(0, 500),
      aiResponse: reply.slice(0, 1000),
      model,
      latencyMs: Date.now() - started,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      costUsd: (inputTokens * 0.003 + outputTokens * 0.015) / 1000,
      toolsCalled,
      agentType: "telegram_staff",
    },
  }).catch((error) => console.warn("[telegram-staff] usage log failed", error instanceof Error ? error.message : error))

  return { text: reply, actionId }
}
