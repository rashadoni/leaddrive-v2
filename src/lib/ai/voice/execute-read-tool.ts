/**
 * Execute one voice read tool: the shared brain behind BOTH assistants.
 *
 * The voice console and the Da Vinci chat ask the same questions of the same
 * CRM; for months they had different answers because they had different tools.
 * Everything the voice route learned the hard way - module gating that answers
 * instead of erroring, schema rejection as a normal event, the hidden-field
 * boundary that matches the screen - lives here once, and both doors call it.
 *
 * Read-only by construction: nothing here can reach a write tool. Callers own
 * authentication; this function trusts the auth it is handed exactly as the
 * route trusted withRlsAuth.
 */
import { hasModule } from "@/lib/modules"
import type { Role } from "@/lib/permissions"
import { getOrgModuleContext } from "@/lib/api-auth"
import { executeReadTool } from "@/lib/ai/read-tool-executor"
import {
  VOICE_TOOL_MODULE,
  VOICE_TOOL_SCHEMAS,
  VOICE_LIST_TOOLS,
  shapeRowsForSpeech,
  type VoiceToolName,
} from "@/lib/ai/voice/read-tools"
import { readVoiceRecord, type VoiceReadableType } from "@/lib/ai/voice/record-read"
import { readSection } from "@/lib/ai/voice/section-reader"
import { SECTION_DESCRIPTORS } from "@/lib/ai/voice/section-registry"
import { SECTION_GUIDE } from "@/lib/ai/voice/section-guide"
import {
  buildInboxSummary,
  buildFieldSummary,
  buildVoiceBriefing,
  buildPipelineSummary,
  buildSalesByManager,
  buildOverdueSummary,
  findVoiceRecords,
  buildLeadsSummary,
  buildMarketingSummary,
  buildForecastSummary,
  buildBoardsSummary,
  buildWorkloadSummary,
  buildQuotesSummary,
  buildSalesPeriodSummary,
} from "@/lib/ai/voice/summaries"
import { resolveSalesPeriod, type SalesPeriodInput } from "@/lib/ai/voice/sales-period"
import {
  loadVoiceReportingTimezone,
  resolveVoiceForecastRanges,
  resolveVoiceReportingRange,
} from "@/lib/ai/voice/reporting-timezone"
import { buildAdvisorCapabilities } from "@/lib/ai/advisor/capabilities"
import {
  canAccessAllVoiceOverdueData,
  canAccessVoiceRecord,
  canAccessVoiceSection,
  canAccessVoiceWorkload,
  type VoiceOrgModuleContext,
  type VoiceRecordType,
  type VoiceWorkloadFocus,
} from "@/lib/ai/voice/read-access"
import {
  canUseVoiceDataFields,
  voiceFieldEntitiesForTool,
} from "@/lib/ai/voice/field-access"
import { executeVoiceTaskList } from "@/lib/ai/voice/task-list"
import { isVoiceTaskScopeUnavailable } from "@/lib/ai/voice/task-scope"
import { buildLeadCoverageSummary } from "@/lib/ai/voice/lead-coverage"

export type VoiceReadOutcome = { status?: number; body: Record<string, unknown> }

export async function executeVoiceReadTool(params: {
  toolName: VoiceToolName
  filter: unknown
  auth: { orgId: string; userId: string; role: string }
  logTurn?: (entry: { outcome: string; keys: string[] }) => void
}): Promise<VoiceReadOutcome> {
  const { toolName, filter, auth, logTurn } = params
  // Module gate. Every tool has an entry (asserted by test), so a missing one
  // cannot fall through `filterToolsByTenantModules`'s allow-by-default branch.
  const moduleId = VOICE_TOOL_MODULE[toolName]
  let orgCtx: VoiceOrgModuleContext
  try {
    orgCtx = await getOrgModuleContext(auth.orgId)
    if (!hasModule(orgCtx, moduleId)) {
      // A module the tenant never bought is a fact about the account, not an
      // outage — and every sibling denial in this file already says so at 200
      // (ACCESS_SCOPE_UNAVAILABLE, NOT_PERMITTED_FOR_ROLE, SECTION_NOT_AVAILABLE)
      // precisely so the assistant can explain and carry on. This one left by
      // the error door, and the browser counts two non-2xx replies as a dead
      // CRM and ends the conversation. Two questions about modules you do not
      // have therefore hung up on the user.
      return { body: { data: { error: "MODULE_NOT_ENABLED", module: moduleId } } }
    }
  } catch {
    return { status: 503, body: { error: "Module check failed" } }
  }

  const parsed = VOICE_TOOL_SCHEMAS[toolName].safeParse(filter ?? {})
  if (!parsed.success) {
    // Also data, for the same reason. The model composes these arguments and
    // some of the rules it must satisfy cannot be expressed in the JSON Schema
    // it was given (get_sales_in_period's period-XOR-month lives in a zod
    // refinement, which the published schema drops), so a rejected shape is a
    // normal event on the way to the right one — not a reason to end the call.
    // The filter itself is still never echoed: it can carry free text.
    console.warn(`[voice] invalid filter for ${toolName}`)
    return { body: { data: { error: "BAD_ARGUMENTS", tool: toolName } } }
  }

  const now = new Date()

  // A manager can configure fields as hidden. Voice must match that screen
  // boundary: once a value has been folded into a spoken hint or aggregate it
  // cannot be selectively redacted. Fail closed per data-bearing tool; keep
  // navigation and documentation available. The generic field-permission
  // helper is intentionally not used because it treats DB errors as no rules.
  const fieldEntities = voiceFieldEntitiesForTool(
    toolName,
    parsed.data as Record<string, unknown>,
  )
  try {
    if (!await canUseVoiceDataFields(auth.orgId, auth.role as Role, fieldEntities)) {
      return { body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE" } } }
    }
  } catch {
    return { body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE" } } }
  }

  // WHICH tool ran, never the content. The voice route records this as a
  // session turn; chat passes nothing. Only schema-key names leave here - the
  // full privacy reasoning lives on the voice route.
  logTurn?.({ outcome: "accepted", keys: Object.keys(parsed.data as Record<string, unknown>).sort() })

  if ((VOICE_LIST_TOOLS as readonly string[]).includes(toolName)) {
    // executeReadTool does not open a tenant scope of its own — it relies on the
    // caller already being inside one, which withRlsAuth guarantees here.
    const result = toolName === "list_tasks"
      ? await executeVoiceTaskList(
          parsed.data as Record<string, unknown>,
          auth.orgId,
          { userId: auth.userId, role: auth.role as Role },
        )
      : await executeReadTool(
          toolName,
          parsed.data as Record<string, unknown>,
          auth.orgId,
          auth.userId,
          auth.role,
        )
    if (!result.success) {
      if (result.error === "ACCESS_SCOPE_UNAVAILABLE") {
        return { body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE" } } }
      }
      return { status: 400, body: { error: result.error ?? "Read failed" } }
    }
    return { body: { data: shapeRowsForSpeech(result.data) } }
  }

  if (toolName === "get_inbox_summary") {
    return { body: { data: await buildInboxSummary(auth.orgId, now) } }
  }
  if (toolName === "get_field_summary") {
    let timezone: string
    try {
      timezone = await loadVoiceReportingTimezone(auth.orgId, auth.userId)
    } catch {
      return { body: { data: { error: "REPORTING_TIMEZONE_UNAVAILABLE" } } }
    }
    const today = resolveVoiceReportingRange("today", now, timezone)
    return { body: { data: await buildFieldSummary(auth.orgId, now, today) } }
  }
  if (toolName === "get_daily_briefing") {
    const allowedDomains = buildAdvisorCapabilities(orgCtx, auth.role)
      .filter((capability) => capability.status === "active")
      .map((capability) => capability.key)
    return { body: {
      data: await buildVoiceBriefing(
        auth.orgId,
        now,
        allowedDomains,
        { userId: auth.userId, role: auth.role as Role },
      ),
    } }
  }
  if (toolName === "get_pipeline_by_stage") {
    return { body: { data: await buildPipelineSummary(auth.orgId) } }
  }
  if (toolName === "get_sales_in_period") {
    const input = parsed.data as SalesPeriodInput
    let timezone: string
    try {
      timezone = await loadVoiceReportingTimezone(auth.orgId, auth.userId)
    } catch {
      return { body: { data: { error: "REPORTING_TIMEZONE_UNAVAILABLE" } } }
    }
    const { from, toExclusive, label } = resolveSalesPeriod(input, now, timezone)
    return { body: {
      data: await buildSalesPeriodSummary(auth.orgId, from, toExclusive, label),
    } }
  }
  if (toolName === "get_sales_by_manager") {
    return { body: { data: await buildSalesByManager(auth.orgId) } }
  }
  if (toolName === "get_overdue") {
    // This summary spans CRM tasks, Finance invoices and Sales deals. It is
    // all-or-nothing so a missing entitlement cannot be represented as a
    // misleading zero, and the builder is never called before every component
    // has passed both the role and tenant-module checks.
    if (!canAccessAllVoiceOverdueData(auth.role as Role, orgCtx)) {
      return { body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE" } } }
    }
    try {
      return { body: {
        data: await buildOverdueSummary(
          auth.orgId,
          now,
          { userId: auth.userId, role: auth.role as Role },
        ),
      } }
    } catch (error) {
      if (isVoiceTaskScopeUnavailable(error)) {
        return { body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE" } } }
      }
      throw error
    }
  }
  if (toolName === "get_leads_summary") {
    let timezone: string
    try {
      timezone = await loadVoiceReportingTimezone(auth.orgId, auth.userId)
    } catch {
      return { body: { data: { error: "REPORTING_TIMEZONE_UNAVAILABLE" } } }
    }
    return { body: {
      data: await buildLeadsSummary(
        auth.orgId,
        now,
        resolveVoiceReportingRange("month", now, timezone),
      ),
    } }
  }
  if (toolName === "get_marketing_summary") {
    let timezone: string
    try {
      timezone = await loadVoiceReportingTimezone(auth.orgId, auth.userId)
    } catch {
      return { body: { data: { error: "REPORTING_TIMEZONE_UNAVAILABLE" } } }
    }
    return { body: {
      data: await buildMarketingSummary(
        auth.orgId,
        now,
        resolveVoiceReportingRange("month", now, timezone),
      ),
    } }
  }
  if (toolName === "get_forecast_summary") {
    let timezone: string
    try {
      timezone = await loadVoiceReportingTimezone(auth.orgId, auth.userId)
    } catch {
      return { body: { data: { error: "REPORTING_TIMEZONE_UNAVAILABLE" } } }
    }
    const forecastRanges = resolveVoiceForecastRanges(now, timezone)
    return { body: {
      data: await buildForecastSummary(
        auth.orgId,
        now,
        forecastRanges.actuals,
        forecastRanges.pipelineToExclusive,
      ),
    } }
  }
  if (toolName === "get_boards_summary") {
    try {
      return { body: {
        data: await buildBoardsSummary(
          auth.orgId,
          now,
          { userId: auth.userId, role: auth.role as Role },
        ),
      } }
    } catch (error) {
      if (isVoiceTaskScopeUnavailable(error)) {
        return { body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE" } } }
      }
      throw error
    }
  }
  if (toolName === "explain_section") {
    // Served from the SERVER: the guide is 437 KB, which is the whole console
    // bundle again. Shipping it to every browser to answer an occasional
    // question would tax every page load for the few that ask.
    const key = String((parsed.data as { section?: string }).section ?? "")
    const guide = SECTION_GUIDE[key]
    if (!guide || !canAccessVoiceSection(auth.role as Role, orgCtx, key)) {
      return { body: {
        data: { error: "SECTION_NOT_AVAILABLE", section: key },
      } }
    }
    return { body: { data: { section: key, ...guide } } }
  }
  if (toolName === "describe_section") {
    const a = parsed.data as {
      section: string
      facet?: "all" | "status" | "people" | "overdue" | "money"
      period?: "today" | "yesterday" | "week" | "month" | "quarter" | "year"
    }
    // The module gate is per SECTION, not per tool: one tool now spans many
    // paid modules, so the entitlement has to be checked against the thing
    // actually being read rather than against the tool's own declaration.
    const desc = SECTION_DESCRIPTORS[a.section]
    if (!desc) {
      return { body: {
        data: {
          error: "UNKNOWN_SECTION",
          known: Object.keys(SECTION_DESCRIPTORS),
        },
      } }
    }
    // Re-checked against the SECTION's module, not the tool's: one tool now
    // spans many paid modules, so the outer gate (which passed `crm`) is not
    // the entitlement that matters here. A denial is returned as data, not a
    // 403, so the agent says "that module is off" instead of falling silent.
    // TWO different questions, both required.
    //
    // hasModule answers "did the organisation pay for this". canRead answers
    // "may this ROLE see it". Only the first was being asked, which made voice
    // a way around the role matrix: a salesperson could hear finance figures
    // the screen would never show them, because the org owns finance. What is
    // audible must match what is visible.
    if (!canAccessVoiceSection(auth.role as Role, orgCtx, a.section)) {
      return { body: { data: { error: "NOT_PERMITTED_FOR_ROLE", section: a.section } } }
    }
    let explicitRange
    if (a.period) {
      let timezone: string
      try {
        timezone = await loadVoiceReportingTimezone(auth.orgId, auth.userId)
      } catch {
        return { body: { data: { error: "REPORTING_TIMEZONE_UNAVAILABLE" } } }
      }
      explicitRange = resolveVoiceReportingRange(a.period, now, timezone)
    }
    try {
      const report = await readSection(
        auth.orgId,
        a.section,
        now,
        a.facet ?? "all",
        explicitRange,
        { userId: auth.userId, role: auth.role as Role },
      )
      return { body: { data: report } }
    } catch (error) {
      if (isVoiceTaskScopeUnavailable(error)) {
        return { body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE" } } }
      }
      throw error
    }
  }
  if (toolName === "get_workload_by_person") {
    const f = (parsed.data as { focus?: VoiceWorkloadFocus | "all" }).focus
    if (!canAccessVoiceWorkload(auth.role as Role, orgCtx, f ?? "all")) {
      return { body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE", focus: f ?? "all" } } }
    }
    try {
      return { body: {
        data: await buildWorkloadSummary(
          auth.orgId,
          now,
          f ?? "all",
          { userId: auth.userId, role: auth.role as Role },
        ),
      } }
    } catch (error) {
      if (isVoiceTaskScopeUnavailable(error)) {
        return { body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE" } } }
      }
      throw error
    }
  }
  if (toolName === "get_lead_coverage") {
    return { body: { data: await buildLeadCoverageSummary(auth.orgId, now) } }
  }
  if (toolName === "get_quotes_summary") {
    return { body: { data: await buildQuotesSummary(auth.orgId, now) } }
  }
  if (toolName === "find_record") {
    // parsed.data, not the raw body: the schema is what guarantees the type is
    // one of three literals and the query is length-bounded.
    const f = parsed.data as { type: VoiceRecordType; query: string }
    if (!canAccessVoiceRecord(auth.role as Role, orgCtx, f.type)) {
      return { body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE", type: f.type } } }
    }
    return { body: {
      data: await findVoiceRecords(auth.orgId, f.type, f.query, {
        userId: auth.userId,
        role: auth.role as Role,
      }),
    } }
  }

  if (toolName === "read_record") {
    const f = parsed.data as { type: VoiceReadableType; id: string }
    // The card is gated by the same per-type access map as finding it: a role
    // that cannot search invoices cannot read one by id either.
    if (!canAccessVoiceRecord(auth.role as Role, orgCtx, f.type)) {
      return { body: { data: { error: "ACCESS_SCOPE_UNAVAILABLE", type: f.type } } }
    }
    return { body: { data: await readVoiceRecord(auth.orgId, f.type, f.id) } }
  }

  return { status: 400, body: { error: "Unhandled voice tool" } }
}
