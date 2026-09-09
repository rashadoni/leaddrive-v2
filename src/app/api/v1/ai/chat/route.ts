import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { resolveAiModel } from "@/lib/ai/budget"
import { checkRateLimit, RATE_LIMIT_CONFIG } from "@/lib/rate-limit"
import { TOOL_META, filterToolsByTenantModules, getEnabledTools, getEnabledToolsForAgent, type RiskLevel } from "@/lib/ai/tools"
import { READ_TOOLS, READ_TOOL_NAMES, READ_TOOL_MODULE, READ_TOOL_PERMISSION, type ReadResultData } from "@/lib/ai/read-tools"
import { VOICE_SUMMARY_TOOLS, type VoiceToolName } from "@/lib/ai/voice/read-tools"
import { voiceTools } from "@/lib/ai/voice/realtime-tool-contract"
import { executeVoiceReadTool } from "@/lib/ai/voice/execute-read-tool"
import { getOrgModuleContext } from "@/lib/api-auth"
import { hasModule } from "@/lib/modules"
import { executeTool } from "@/lib/ai/tool-executor"
import { predictDealWin } from "@/lib/ai/predictive"
import { generateNextBestActions } from "@/lib/ai/next-best-action"
import { routeToAgent } from "@/lib/ai/agent-router"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { dateInputValueInTimezone } from "@/lib/timezone"
import {
  CHAT_ANALYTICS_TOOLS,
  chatAnalyticsInputMatchesRequest,
  hasMixedChatAnalyticsIntent,
  isChatAnalyticsToolName,
  messageCarriesExplicitPeriod,
  requiredChatAnalyticsTool,
} from "@/lib/ai/chat-analytics-tools"
import {
  executeChatAnalyticsTool,
  loadChatAnalyticsTimezone,
} from "@/lib/ai/chat-analytics-executor"
import { renderChatAnalyticsEvidence } from "@/lib/ai/chat-analytics-renderer"
import { ADVISORY_GROUNDING_RULES, advisoryGroundingTool } from "@/lib/ai/chat-advisory"
import {
  CURRENT_STATE_GROUNDING_RULES,
  currentStateGrounding,
  currentStateInputMatches,
  type CurrentStateGrounding,
} from "@/lib/ai/chat-current-state"
import { canRead } from "@/lib/permissions"
import {
  isManagerOrAbove,
  COMPANY_LEGAL_NAME,
  COMPANY_LEGAL_ADDRESS,
} from "@/lib/constants"
import { applyRecordFilter } from "@/lib/sharing-rules"

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  return getAnthropicClient()
}

const MAX_TOOL_ROUNDS = 5

function analyticsUnavailableReply(locale: unknown): string {
  if (locale === "az") return "CRM məlumatlarını təsdiqləyə bilmədim. Yoxlanmış rəqəm olmadan təxmin verməyəcəyəm."
  if (locale === "en") return "I could not verify the CRM data. I will not estimate a number without verified evidence."
  return "Не удалось проверить данные CRM. Я не буду оценивать или придумывать число без подтверждённых данных."
}

function analyticsPeriodNeededReply(locale: unknown): string {
  if (locale === "az") return "Bu sual keçmiş hadisə barədədir, ona görə dövr lazımdır. Hansı dövrü götürüm — bu gün, bu həftə, bu ay, yoxsa konkret tarixlər?"
  if (locale === "en") return "That question is about past events, so it needs a period. Which one should I use — today, this week, this month, or exact dates?"
  return "Этот вопрос о прошедших событиях, поэтому нужен период. Какой взять — сегодня, эта неделя, этот месяц или конкретные даты?"
}

function splitAnalyticsQuestionReply(locale: unknown): string {
  if (locale === "az") return "Dəqiq cavab üçün bölmə izahını və hesabat sualını ayrı-ayrılıqda göndərin."
  if (locale === "en") return "For a verified answer, ask the section-help question and the reporting question separately."
  return "Чтобы ответ был проверяемым, задайте отдельно вопрос о разделе и отдельно вопрос по отчёту."
}

type ChatHistoryEntry = {
  role?: unknown
  content?: unknown
}

type AiToolAction = {
  tool: string
  input: unknown
  status: "pending_approval" | "executed" | "failed"
  pendingActionId?: string
  result?: unknown
  error?: string
  riskLevel: RiskLevel
}

export const POST = withRlsAuth("ai", "read", async (req, session) => {
  const { orgId, userId } = session

  const aiLimitKey = `ai:${orgId}`
  if (!checkRateLimit(aiLimitKey, RATE_LIMIT_CONFIG.ai)) {
    return NextResponse.json({ error: "Too many Da Vinci requests. Please try again later." }, { status: 429 })
  }

  const { message, context, history, locale, previousAgentId, sessionId } = await req.json()
  if (!message) return NextResponse.json({ error: "Message required" }, { status: 400 })

  const client = getClient()
  if (!client) return NextResponse.json({ error: "Da Vinci AI requires configuration. Please set ANTHROPIC_API_KEY in Settings → Integrations." }, { status: 503 })

  try {
    // One clock for the whole turn: period boundaries, prompt context and tool
    // evidence cannot drift across midnight while the model is thinking.
    const requestNow = new Date()
    const langMap: Record<string, string> = {
      az: "Azerbaijani (Azərbaycan dili)",
      ru: "Russian (Русский)",
      en: "English",
    }
    const forceLang = langMap[locale || "ru"] || "Russian"
    const analyticsCandidate = requiredChatAnalyticsTool(String(message))
    // "How many leads do we have" is a state question, and the period report
    // it would otherwise be forced onto refuses every message without a
    // parsable window. Ground those on the snapshot tool that can actually
    // answer them; only the period-report class is ever intercepted, so
    // rankings and section help keep their existing verified paths.
    const stateGrounding = analyticsCandidate === null || analyticsCandidate === "get_crm_period_report"
      ? currentStateGrounding(String(message))
      : null
    const requiredAnalyticsTool = stateGrounding ? null : analyticsCandidate
    // Advice grounds on read tools, never on the analytics evidence path: the
    // deterministic renderer would replace the advice with a number template.
    const advisoryTool = requiredAnalyticsTool || stateGrounding
      ? null
      : advisoryGroundingTool(String(message))
    if (hasMixedChatAnalyticsIntent(String(message))) {
      return NextResponse.json({
        success: true,
        data: {
          reply: splitAnalyticsQuestionReply(locale),
          queryError: "Ask one verified analytics question at a time.",
        },
      })
    }

    // Multi-agent routing: classify intent and find best agent
    const { agent: agentConfig, intent, confidence, isHandoff } = await routeToAgent(
      orgId, message, previousAgentId
    )

    // Record handoff if agent changed
    if (isHandoff && previousAgentId && agentConfig) {
      try {
        await prisma.agentHandoff.create({
          data: {
            organizationId: orgId,
            sessionId: sessionId ?? crypto.randomUUID(),
            fromAgentId: previousAgentId,
            toAgentId: agentConfig.id,
            reason: `Intent: ${intent} (confidence: ${confidence})`,
            context: { lastMessages: (history || []).slice(-3) },
          },
        })
      } catch { /* ignore handoff logging errors */ }
    }

    // Smart AI Search — read-only list_* tools are gated by (1) the
    // `ai_smart_search` org feature flag and (2) per-tool module-gating. Both
    // derive from the SAME cached org context (features + modules), so no extra
    // DB round-trip. `ai_smart_search` lives in Organization.features, which
    // loadOrgContext surfaces as modules["ai_smart_search"].
    const orgCtx = await getOrgModuleContext(orgId)
    const smartSearchEnabled = orgCtx.modules["ai_smart_search"] === true
    let analyticsTimezone: string
    try {
      analyticsTimezone = await loadChatAnalyticsTimezone(orgId, userId)
    } catch (error) {
      console.error("[chat-analytics] timezone lookup failed", error instanceof Error ? error.message : "unknown error")
      if (requiredAnalyticsTool) {
        return NextResponse.json({
          success: true,
          data: {
            reply: analyticsUnavailableReply(locale),
            queryError: "Verified CRM analytics are unavailable.",
            agentId: agentConfig?.id,
            agentName: agentConfig?.configName,
            agentType: agentConfig?.agentType,
            intent,
          },
        })
      }
      throw error
    }
    const localDate = dateInputValueInTimezone(requestNow, analyticsTimezone)

    // Get tools from the routed agent's own config (write/CRM tools).
    let tools = agentConfig ? getEnabledToolsForAgent(agentConfig) : getEnabledTools([])
    // Smart AI Search is a FLAG-gated capability, NOT a per-agent toolsEnabled
    // setting: search must work on any active (or default) agent without each
    // agent listing the read tools. So strip any read tools the agent config
    // happened to include, then re-add the module-allowed ones iff the flag is on.
    // Tenant scoping still holds (RLS + organizationId in every read builder).
    tools = tools.filter((t) => !READ_TOOL_NAMES.includes(t.name))
    if (smartSearchEnabled) {
      const allowedReadTools = READ_TOOLS.filter((t) => {
        const mod = READ_TOOL_MODULE[t.name]
        const permission = READ_TOOL_PERMISSION[t.name]
        return isManagerOrAbove(session.role)
          && Boolean(permission && canRead(session.role, permission))
          && (!mod || hasModule(orgCtx, mod))
      })
      tools = [...tools, ...allowedReadTools]
    }
    // The voice assistant's read tools, verbatim. For months the two surfaces
    // answered the same question differently because they had different tools;
    // now chat carries the voice set - briefings, pipeline, overdue, workload,
    // find_record and read_record (deal cards with MEDDPICC, cashback and
    // competitors) - executed by the same shared executor with the same module,
    // role and hidden-field gates. Two are deliberately absent: period sales
    // stay on get_crm_period_report (chat's timezone-forced evidence path),
    // and section guides stay on explain_crm_section.
    const voiceChatToolNames = (VOICE_SUMMARY_TOOLS as readonly string[]).filter(
      (name) => name !== "get_sales_in_period" && name !== "explain_section",
    )
    const voiceChatTools = smartSearchEnabled && isManagerOrAbove(session.role)
      ? voiceTools(undefined, forceLang === "Russian" ? "ru" : forceLang === "English" ? "en" : "az")
          .filter((t) => voiceChatToolNames.includes(t.name))
          .map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
      : []

    tools = filterToolsByTenantModules(tools, orgCtx)
    // Deterministic reports/rankings/section help are part of Da Vinci itself,
    // not the hidden Smart Search rollout flag. Each executor call still checks
    // the caller's role and the metric's paid module before touching data.
    tools = [...tools, ...CHAT_ANALYTICS_TOOLS, ...(voiceChatTools as typeof tools)]

    // Context enrichment: deal prediction + next actions when on deal page
    let aiInsightsContext = ""
    const dealPageMatch = context?.url?.match(/\/deals\/([^/]+)/)
    if (dealPageMatch && canRead(session.role, "deals") && hasModule(orgCtx, "sales")) {
      try {
        const visibleDealWhere = await applyRecordFilter(
          orgId,
          userId,
          session.role,
          "deal",
          { id: dealPageMatch[1], organizationId: orgId },
        )
        const visibleDeal = await prisma.deal.findFirst({
          where: visibleDealWhere,
          select: { id: true },
        })
        if (!visibleDeal) throw new Error("Deal is not visible to this user")
        const [prediction, nextActions] = await Promise.all([
          predictDealWin(visibleDeal.id, orgId),
          generateNextBestActions(orgId, userId, 3, {
            role: session.role,
            deals: canRead(session.role, "deals") && hasModule(orgCtx, "sales"),
            leads: canRead(session.role, "leads") && hasModule(orgCtx, "sales"),
            tasks: canRead(session.role, "tasks") && hasModule(orgCtx, "crm"),
            tickets: canRead(session.role, "tickets") && hasModule(orgCtx, "support"),
          }),
        ])
        aiInsightsContext = `\n\nAI Insights for current deal:
- Win Probability: ${prediction.winProbability}% (confidence: ${prediction.confidence}%)
- Risk Factors: ${prediction.riskFactors.join(", ") || "none"}
- Recommended Actions: ${nextActions.map(a => a.titleKey).join("; ") || "none"}`
      } catch { /* ignore enrichment errors */ }
    }

    const agentName = agentConfig?.configName || "Da Vinci"
    const agentSystemPrompt = agentConfig?.systemPrompt ? `${agentConfig.systemPrompt}\n\n` : ""
    const systemPrompt = `${agentSystemPrompt}You are ${agentName} — an intelligent CRM assistant (type: ${agentConfig?.agentType || "general"}) for LeadDrive, a CRM platform built by ${COMPANY_LEGAL_NAME} in ${COMPANY_LEGAL_ADDRESS}.

CRITICAL RULE #1: You MUST always respond in ${forceLang}. This is non-negotiable regardless of what language the user writes in.

Current page: ${context?.url || "unknown"} (${context?.title || ""})
Reporting clock: ${requestNow.toISOString()} (local date ${localDate || "unknown"}, timezone ${analyticsTimezone})

Rules:
- ALWAYS respond in ${forceLang}
- Be concise and actionable
- Reference specific data when possible
- If asked about specific records, explain that you see aggregate data
- Format numbers with locale formatting
- You have CRM tools available. Use them when the user asks to create tasks, log activities, update deals, etc.
- For high-risk actions (sending emails, updating contacts), inform the user that approval will be required
- Always confirm what you did after executing a tool
- When the user asks to SEE / LIST / FIND / FILTER records (invoices, deals, tasks, tickets, contacts), call the matching list_* read tool with ONLY the supported filter fields. After it returns, give a SHORT summary (counts, notable items) — do NOT re-print every row; a results table is shown to the user separately
- If a list_* tool returns "Invalid filter", do not invent field names — ask the user to clarify what they meant
- For HOW MANY / REPORT / STATISTICS / TODAY / WEEK / MONTH / CUSTOM DATE questions, call get_crm_period_report. For WHO DID MOST/LEAST/TOP/BOTTOM, call get_crm_ranking or get_kpi_arena. For questions about a CRM section, call explain_crm_section
- Period semantics are exact: "за неделю/last week period" = rolling last_7_days; "за месяц/last month period" = rolling last_30_days; "на этой неделе/this week" = this_week; "в этом месяце/this month" = this_month; custom dateFrom/dateTo are inclusive local calendar dates
- NEVER state a tenant-specific count, amount, percentage, ranking, trend, or date-bounded fact unless a successful read/analytics tool in THIS turn returned it. Never estimate, round into a range, extrapolate from the all-time snapshot, or reuse a number from chat history
- Answer like a colleague, not a report generator: lead with the number and the period in plain words ("В июле выиграно 12 сделок на 84 000 AZN"), then one short sentence of caveats if any exist. Translate every coverage caveat into plain language the user's own terms ("у 89 выигранных сделок нет даты перехода, они не вошли в этот период"). NEVER mention internal identifiers, database fields, table or model names (PipelineStageTransition, transitionedAt, transitionType and the like) - the user has no idea what they are and should never need to. If the tool fails or says data is unavailable, say so explicitly and give NO number
${ADVISORY_GROUNDING_RULES}
${CURRENT_STATE_GROUNDING_RULES}
- For a briefing, pipeline, overdue, workload, quotes, inbox, leads, marketing, forecast or boards question, call the matching get_*_summary tool. To answer about ONE record's contents - a deal's MEDDPICC, a contact's cashback, competitors, an invoice - call find_record first, then read_record with the returned id. Null fields are genuinely empty: say the field is not filled in, never guess. Never read record ids aloud or print them
- For section help, translate or concisely paraphrase only the verified explain_crm_section guide into ${forceLang}; do not add product behavior that is absent from the guide
- Use AI insights context below to proactively suggest relevant actions${aiInsightsContext}`

    const historyEntries: ChatHistoryEntry[] = Array.isArray(history) ? history : []
    const messages: Anthropic.MessageParam[] = [
      ...historyEntries.map((h) => ({
        role: h.role === "assistant" ? "assistant" as const : "user" as const,
        content: typeof h.content === "string" ? h.content : "",
      })),
      { role: "user", content: message },
    ]

    const start = Date.now()
    let totalInputTokens = 0
    let totalOutputTokens = 0
    const allActions: AiToolAction[] = []
    let queryResult: ReadResultData | undefined
    let queryError: string | undefined
    let textReply = ""
    const toolsCalled: string[] = []
    let numericAnalyticsAttempted = false
    let guideAnalyticsAttempted = false
    let latestNumericEvidence: Record<string, unknown> | undefined
    let latestGuideEvidence: Record<string, unknown> | undefined
    let latestNumericError: string | undefined
    let latestGuideError: string | undefined
    let stateEvidenceObserved = false

    // PII masking — load known names from CRM, mask messages + system prompt
    const piiMasker = new PiiMasker()
    try {
      const contacts: Array<{ fullName: string | null }> = await prisma.contact.findMany({
        where: { organizationId: orgId },
        select: { fullName: true },
        take: 200,
      })
      const companies: Array<{ name: string | null }> = await prisma.company.findMany({
        where: { organizationId: orgId },
        select: { name: true },
        take: 100,
      })
      piiMasker.addKnownNames(contacts.map((c) => c.fullName).filter((name): name is string => Boolean(name)))
      piiMasker.addKnownCompanies(companies.map((c) => c.name).filter((name): name is string => Boolean(name)))
    } catch { /* non-critical */ }

    const maskedSystemPrompt = piiMasker.mask(systemPrompt)
    let currentMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      ...m,
      content: typeof m.content === "string" ? piiMasker.mask(m.content) : m.content,
    }))
    const configuredMaxRounds = agentConfig?.maxToolRounds || MAX_TOOL_ROUNDS
    // A forced evidence call needs one round for tool_use and one round for the
    // model to observe tool_result. The deterministic renderer below remains
    // the final authority, but a one-round agent config must not cut the loop.
    // The advisory ground exists only when the read tools are exposed (smart
    // search flag + manager role); for everyone else the prompt rules alone
    // apply and the model must say its advice is general.
    const advisoryForcedTool = advisoryTool && tools.some((t) => t.name === advisoryTool) ? advisoryTool : null
    // A state question is only grounded when its tool is actually exposed to
    // this caller. When Smart Search is off, or the role or module gate hides
    // the tool, the question falls back to the ordinary un-grounded answer
    // rather than being force-called into a tool that does not exist.
    const stateForced: CurrentStateGrounding | null = stateGrounding
      && tools.some((t) => t.name === stateGrounding.tool)
      ? stateGrounding
      : null
    const groundedForcedTool = stateForced?.tool ?? advisoryForcedTool
    const maxRounds = requiredAnalyticsTool || groundedForcedTool
      ? Math.max(2, configuredMaxRounds)
      : configuredMaxRounds
    for (let round = 0; round < maxRounds; round++) {
      const response = await client.messages.create({
        model: resolveAiModel(agentConfig?.model),
        max_tokens: agentConfig?.maxTokens || 1024,
        temperature: Math.min(1, Math.max(0, agentConfig?.temperature ?? 0.2)),
        system: maskedSystemPrompt,
        tools: tools.length > 0 ? tools : undefined,
        messages: currentMessages,
        ...(round === 0 && (requiredAnalyticsTool || groundedForcedTool)
          ? { tool_choice: { type: "tool" as const, name: (requiredAnalyticsTool || groundedForcedTool)! } }
          : {}),
      })

      totalInputTokens += response.usage?.input_tokens || 0
      totalOutputTokens += response.usage?.output_tokens || 0

      // Collect text blocks
      for (const block of response.content) {
        if (block.type === "text") {
          textReply += block.text
        }
      }

      // Check for tool_use blocks
      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")

      if (toolUseBlocks.length === 0) {
        // No more tool calls, done
        break
      }

      // Execute tools and build tool_result messages
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const toolBlock of toolUseBlocks) {
        const isAnalyticsTool = isChatAnalyticsToolName(toolBlock.name)
        const isGuideTool = toolBlock.name === "explain_crm_section"
        if (isAnalyticsTool) {
          if (isGuideTool) guideAnalyticsAttempted = true
          else numericAnalyticsAttempted = true
        }
        const meta = isAnalyticsTool
          ? { riskLevel: "low" as const, category: "analytics", requiresApproval: false }
          : TOOL_META[toolBlock.name]
        toolsCalled.push(toolBlock.name)

        const analyticsInputMismatch = Boolean(
          isAnalyticsTool
          && (
            !requiredAnalyticsTool
            || requiredAnalyticsTool !== toolBlock.name
            || !chatAnalyticsInputMatchesRequest(
              String(message),
              toolBlock.name,
              toolBlock.input as Record<string, unknown>,
              localDate,
            )
          ),
        )
        const isVoiceReadTool = voiceChatToolNames.includes(toolBlock.name)
        if (isVoiceReadTool) {
          const out = await executeVoiceReadTool({
            toolName: toolBlock.name as VoiceToolName,
            filter: toolBlock.input,
            auth: { orgId, userId, role: session.role },
          })
          if (stateForced && toolBlock.name === stateForced.tool) {
            // The read tools report a refused scope inside the payload rather
            // than by throwing, and a snapshot the model asked for with the
            // wrong arguments answers a different question. Either way the
            // turn has no evidence, and the answer must not be model prose.
            const payload = (out.body ?? {}) as { data?: unknown }
            const data = payload.data
            const refused = !data
              || (typeof data === "object" && data !== null && "error" in data)
            if (!refused && currentStateInputMatches(stateForced, toolBlock.input)) {
              stateEvidenceObserved = true
            }
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: piiMasker.mask(JSON.stringify(out.body)),
          })
          continue
        }
        const result = analyticsInputMismatch
          ? {
              success: false,
              error: "Verified CRM analytics are unavailable because the requested scope could not be verified.",
            }
          : isAnalyticsTool
            ? await executeChatAnalyticsTool(
              toolBlock.name,
              toolBlock.input as Record<string, unknown>,
              {
                orgId,
                userId,
                role: session.role,
                timezone: analyticsTimezone,
                now: requestNow,
                org: orgCtx,
              },
              )
            : await executeTool(
              toolBlock.name,
              toolBlock.input as Record<string, unknown>,
              orgId,
              userId,
              false,
              session.role,
              analyticsTimezone,
            )

        if (result.requiresApproval) {
          allActions.push({
            tool: toolBlock.name,
            input: toolBlock.input,
            status: "pending_approval",
            pendingActionId: result.pendingActionId,
            riskLevel: meta?.riskLevel || "high",
          })
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: `Action "${toolBlock.name}" requires user approval. A pending action has been created. Tell the user they need to approve this action.`,
          })
        } else if (result.success) {
          if (isAnalyticsTool) {
            if (isGuideTool) {
              latestGuideEvidence = result.data as Record<string, unknown>
              latestGuideError = undefined
            } else {
              latestNumericEvidence = result.data as Record<string, unknown>
              latestNumericError = undefined
            }
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolBlock.id,
              content: piiMasker.mask(JSON.stringify({ success: true, evidence: result.data })),
            })
          } else if (meta?.category === "read") {
            // Read-only Smart AI Search result → rendered as a results table,
            // NOT an action-approval card. Keep the last read of the turn. The
            // LLM gets the rows (PII-masked) so it can write a short summary.
            // queryResult / queryError are mutually exclusive — last read wins.
            queryResult = result.data as ReadResultData
            queryError = undefined
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolBlock.id,
              content: piiMasker.mask(
                JSON.stringify({
                  success: true,
                  entityType: queryResult?.entityType,
                  total: queryResult?.total,
                  returned: queryResult?.returned,
                  rows: queryResult?.rows,
                }),
              ),
            })
          } else {
            allActions.push({
              tool: toolBlock.name,
              input: toolBlock.input,
              status: "executed",
              result: result.data,
              riskLevel: meta?.riskLevel || "low",
            })
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolBlock.id,
              content: piiMasker.mask(JSON.stringify({ success: true, ...result.data })),
            })
          }
        } else if (isAnalyticsTool) {
          // The most recent attempt remains authoritative within its own
          // evidence class. A section-guide success must never erase or reopen
          // a numeric report/ranking failure, and a guide must never replace a
          // verified number with free-form model text.
          const analyticsError = result.error || "Verified CRM analytics are unavailable."
          if (isGuideTool) {
            latestGuideEvidence = undefined
            latestGuideError = analyticsError
          } else {
            latestNumericEvidence = undefined
            latestNumericError = analyticsError
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: piiMasker.mask(JSON.stringify({ success: false, error: analyticsError })),
            is_error: true,
          })
        } else if (meta?.category === "read") {
          // Read-tool failure (e.g. "Invalid filter") → surfaced as a query
          // error card, NOT a failed action card. The LLM still gets the error
          // so it can re-ask the user instead of inventing fields.
          queryError = result.error
          queryResult = undefined
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: piiMasker.mask(JSON.stringify({ success: false, error: result.error })),
            is_error: true,
          })
        } else {
          allActions.push({
            tool: toolBlock.name,
            input: toolBlock.input,
            status: "failed",
            error: result.error,
            riskLevel: meta?.riskLevel || "low",
          })
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: piiMasker.mask(JSON.stringify({ success: false, error: result.error })),
            is_error: true,
          })
        }
      }

      // Add assistant response and tool results for next round
      currentMessages = [
        ...currentMessages,
        { role: "assistant" as const, content: response.content },
        { role: "user" as const, content: toolResults },
      ]

      // Reset text for final reply (we want Claude's summary after tool use)
      if (round < maxRounds - 1) {
        textReply = ""
      }
    }

    const latency = Date.now() - start

    const numericAnalyticsRequired = Boolean(
      requiredAnalyticsTool && requiredAnalyticsTool !== "explain_crm_section",
    )
    const guideAnalyticsRequired = requiredAnalyticsTool === "explain_crm_section"
    let analyticsEvidence: Record<string, unknown> | undefined

    if (numericAnalyticsAttempted || numericAnalyticsRequired) {
      if (latestNumericEvidence) {
        analyticsEvidence = latestNumericEvidence
        const verifiedReply = renderChatAnalyticsEvidence(latestNumericEvidence, locale)
        textReply = verifiedReply || analyticsUnavailableReply(locale)
        queryError = verifiedReply
          ? undefined
          : "Verified CRM analytics are unavailable."
      } else {
        // A forced period report that the message never gave a period for is
        // not a data failure — it is a question this tool cannot bound. Ask
        // for the window instead of blaming the CRM data.
        const periodMissing = requiredAnalyticsTool === "get_crm_period_report"
          && !messageCarriesExplicitPeriod(String(message))
        textReply = periodMissing ? analyticsPeriodNeededReply(locale) : analyticsUnavailableReply(locale)
        queryError = periodMissing
          ? "This report needs a period."
          : latestNumericError || "Verified CRM analytics are unavailable."
      }
    } else if (guideAnalyticsAttempted || guideAnalyticsRequired) {
      if (latestGuideEvidence) {
        const verifiedReply = renderChatAnalyticsEvidence(latestGuideEvidence, locale)
        if (!verifiedReply) {
          textReply = analyticsUnavailableReply(locale)
          queryError = "Verified CRM section help is unavailable."
        } else {
          analyticsEvidence = locale === "ru"
            ? latestGuideEvidence
            : {
                kind: latestGuideEvidence.kind,
                section: latestGuideEvidence.section,
                availableGroups: latestGuideEvidence.availableGroups,
                source: latestGuideEvidence.source,
              }
          textReply = verifiedReply
          queryError = undefined
        }
      } else {
        textReply = analyticsUnavailableReply(locale)
        queryError = latestGuideError || "Verified CRM section help is unavailable."
      }
    } else if (requiredAnalyticsTool) {
      textReply = analyticsUnavailableReply(locale)
      queryError = "Verified CRM analytics are unavailable."
    } else if (stateGrounding && !stateEvidenceObserved) {
      // The snapshot was demanded and did not arrive — refused, mis-scoped, or
      // never exposed to this caller at all. Model prose here would be an
      // un-grounded number, which is the one thing this route promises never to
      // produce, so the state question fails closed exactly like the analytics
      // path it was routed away from.
      textReply = analyticsUnavailableReply(locale)
      queryError = "Verified CRM data is unavailable."
    } else if (!textReply) {
      textReply = "Action completed."
    }

    // PII unmask — restore original values in AI response
    textReply = piiMasker.unmask(textReply)

    // Log interaction
    try {
      await prisma.aiInteractionLog.create({
        data: {
          organizationId: orgId,
          userMessage: message.slice(0, 500),
          aiResponse: textReply.slice(0, 1000),
          model: resolveAiModel(agentConfig?.model),
          latencyMs: latency,
          promptTokens: totalInputTokens,
          completionTokens: totalOutputTokens,
          costUsd: (totalInputTokens * 0.003 + totalOutputTokens * 0.015) / 1000,
          toolsCalled,
          agentConfigId: agentConfig?.id,
          agentType: agentConfig?.agentType,
        },
      })
    } catch (err) { console.error(err) }

    return NextResponse.json({
      success: true,
      data: {
        reply: textReply,
        actions: allActions.length > 0 ? allActions : undefined,
        queryResult,
        queryError,
        analyticsEvidence,
        agentId: agentConfig?.id,
        agentName: agentConfig?.configName,
        agentType: agentConfig?.agentType,
        intent,
      },
    })
  } catch (e) {
    console.error("Da Vinci chat error:", e)
    return NextResponse.json({ error: "Da Vinci request failed" }, { status: 500 })
  }
})
