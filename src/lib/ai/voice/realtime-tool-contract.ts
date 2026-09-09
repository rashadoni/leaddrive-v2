import { z } from "zod"
import { RECORD_TYPE_NAMES } from "./record-types"
import { VOICE_TOOL_NAMES, VOICE_TOOL_SCHEMAS, type VoiceToolName } from "./read-tools"
import { SECTION_DESCRIPTORS } from "./section-registry"
import {
  VOICE_SECTION_ALIASES,
  VOICE_SECTION_SUMMARIES,
  type VoiceSectionLocale,
} from "./section-aliases"
import { VOICE_SECTION_KEYS } from "./sections"

/** Provider-neutral JSON Schema used by Gemini Live function declarations. */
export type VoiceToolParameters = {
  type: "object"
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties: false
}

export type VoiceFunctionTool = {
  type: "function"
  name: string
  description: string
  parameters: VoiceToolParameters
}

export const CLIENT_VOICE_TOOL_NAMES = [
  "navigate_to_section",
  "get_current_screen",
  "open_record",
] as const

/**
 * A deterministic locale matrix, derived from the same nav/messages that draw
 * the launcher. Alias identity lives in the server-only section-aliases module
 * so routing, tests and the provider contract cannot drift into competing
 * dictionaries without adding the localized message catalogs to client code.
 */
export const REALTIME_SECTION_LOCALE_MATRIX = Object.fromEntries(
  VOICE_SECTION_KEYS.map((section) => {
    const locales = Object.fromEntries(
      (["ru", "az", "en"] as VoiceSectionLocale[]).map((locale) => {
        const aliases = VOICE_SECTION_ALIASES[section][locale]
        return [locale, { aliases, summary: VOICE_SECTION_SUMMARIES[section][locale] }]
      }),
    ) as Record<VoiceSectionLocale, { aliases: string[]; summary: string | null }>
    return [section, locales]
  }),
) as Record<string, Record<VoiceSectionLocale, { aliases: string[]; summary: string | null }>>

/**
 * The section catalog is the single most expensive thing in this payload, and
 * the payload is re-read by the provider on EVERY response — which makes its
 * size a limit on how many questions can be answered per minute, not merely a
 * matter of tidiness.
 *
 * Measured on the live account on 2026-08-13, after the owner's assistant died
 * mid-demo with `rate_limit_exceeded`: the account's ceiling is 40 000 tokens
 * per minute on the realtime model, and one answer was costing ~19 000 of them.
 * Two answers a minute, and the third fails — exactly the "it breaks after the
 * first replies" that was being reported as a connection fault.
 *
 * Almost all of it was this catalog: 134 sections, three languages each,
 * embedded twice — in `navigate_to_section` and again in `explain_section`.
 *
 * Hence two rules, both of which cost nothing the model actually uses:
 *  - ONE locale, the session's. The assistant is instructed to speak that
 *    language, so that is the language whose menu labels it must recognise; and
 *    the enum keys are themselves the English names, so the English column was
 *    largely a restatement of the values sitting next to it.
 *  - ONE copy. `explain_section` takes the same section keys as
 *    `navigate_to_section` and is only ever published alongside it, so it points
 *    at that vocabulary instead of repeating it.
 *
 * Both group-qualified and plain labels stay: the qualified form is how a real
 * collision ("Analytics" in two modules) is resolved, and dropping it would buy
 * a few kilobytes by making navigation ambiguous.
 */
function sectionCatalog(sectionKeys: readonly string[], locale: VoiceSectionLocale): string {
  return sectionKeys.map((section) => {
    const aliases = REALTIME_SECTION_LOCALE_MATRIX[section][locale].aliases
    return `${section} = ${aliases.map((value) => `"${value}"`).join(" / ")}`
  }).join("\n")
}

export function realtimeCatalogLocale(locale: string): VoiceSectionLocale {
  const base = locale.split("-")[0] ?? ""
  return base === "ru" || base === "en" || base === "az" ? base : "az"
}

const TOOL_DESCRIPTIONS: Record<VoiceToolName, string> = {
  list_deals: "List CRM deals using optional stage or assignee filters. Use for named rows, not aggregate totals.",
  list_invoices: "List invoices using an optional status filter. Use for named rows, not financial aggregates.",
  list_tasks: "List tasks using optional status or assignee filters. Use when the user asks which tasks, not how many.",
  list_tickets: "List support tickets using optional status or assignee filters. Use when the user asks which tickets.",
  list_contacts: "Find or list contacts with an optional free-text search. Reads at most the requested safe limit.",
  get_daily_briefing: "Read the current CRM daily briefing snapshot and its freshness. Never infer a different date window.",
  get_pipeline_by_stage: "Report the current open sales pipeline grouped by the tenant's deal stages.",
  get_sales_by_manager: "Report current sales performance grouped by manager from verified CRM aggregates.",
  get_overdue: "Report the current overdue task, invoice and deal totals. Do not use for historical periods.",
  find_record: "Find a CRM record by its human name or number before using open_record. Never invent an id.",
  read_record:
    "Read the card of ONE record found via find_record: deal (amount, probability, MEDDPICC blocks with notes, contact roles with influence, loyalty and cashback, competitors with threat, recorded stage history and recent activity), contact, company, lead, ticket, invoice, project, contract, product. Use the exact id and type returned by find_record; never invent an id and never read one aloud.",
  get_leads_summary: "Report the verified current lead summary, including status/source aggregates when available.",
  get_marketing_summary: "Report the verified current marketing summary. Do not invent rates absent from the result.",
  get_forecast_summary: "Report the current forecast summary while preserving separate currencies and forecast figures. If wonDealsWithoutHistory is positive or null, state that historical win coverage is incomplete or unavailable.",
  get_boards_summary:
    "Report the current task boards: org-wide totals plus each board by NAME with its own columns, overdue, unassigned and high-priority counts. Use it for a report on one named board too — match the name exactly and never invent one.",
  get_workload_by_person: "Report current workload grouped by person, optionally limited to tasks, leads, deals or tickets.",
  describe_section: "Report verified aggregate data for one data-backed CRM section. Only the enumerated sections support this tool.",
  explain_section: "Explain what any voice-accessible CRM section is, how it works and which capabilities it contains. This is documentation, not live statistics.",
  get_quotes_summary: "Report the current commercial-quote summary and status counts.",
  get_inbox_summary: "Report the current omnichannel inbox snapshot. This tool does not support a historical period.",
  get_field_summary: "Report the current route-and-field operations snapshot. This tool does not support a historical period.",
  get_lead_coverage: "Report how many open leads have been called and how many have not, broken down by salesperson, plus overdue promises made on calls. State the definition of contacted that the result carries and never present it as covering chats or emails.",
  get_sales_in_period: "Report verified sales for exactly one supported relative period or named calendar month. Use period alone, or month with optional year; never combine them. State any wonDealsWithoutHistory coverage caveat and never substitute current pipeline state.",
}

function strictJsonSchema(schema: z.ZodTypeAny): VoiceToolParameters {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  delete json.$schema
  if (json.type !== "object" || !json.properties || Array.isArray(json.properties)) {
    throw new Error("Voice tool schema must be an object")
  }
  return {
    ...(json as unknown as VoiceToolParameters),
    type: "object",
    properties: json.properties as Record<string, unknown>,
    additionalProperties: false,
  }
}

function withSectionEnum(
  base: VoiceToolParameters,
  sections: readonly string[],
  description: string,
): VoiceToolParameters {
  return {
    ...base,
    properties: {
      ...base.properties,
      section: { type: "string", enum: [...sections], description },
    },
  }
}

function serverTool(
  name: VoiceToolName,
  sectionKeys: readonly string[],
): VoiceFunctionTool {
  let parameters = strictJsonSchema(VOICE_TOOL_SCHEMAS[name])
  if (name === "explain_section") {
    parameters = withSectionEnum(
      parameters,
      sectionKeys,
      "Use the exact internal key after matching the user's spoken section label, using the same label catalog published on navigate_to_section. Ambiguous plain labels require clarification.",
    )
  }
  if (name === "describe_section") {
    parameters = withSectionEnum(
      parameters,
      Object.keys(SECTION_DESCRIPTORS),
      "Choose only a data-backed section key from this enum. Use explain_section for other sections.",
    )
  }
  return { type: "function", name, description: TOOL_DESCRIPTIONS[name], parameters }
}

const emptyParameters: VoiceToolParameters = {
  type: "object",
  properties: {},
  additionalProperties: false,
}

function clientTools(sectionKeys: readonly string[], catalog: string): VoiceFunctionTool[] {
  const navigationTools: VoiceFunctionTool[] = sectionKeys.length > 0 ? [
    {
      type: "function",
      name: "navigate_to_section",
      description: "Open a voice-accessible CRM section on the user's screen. Match RU/AZ/EN labels to the exact internal enum key; ask which module when a plain label is ambiguous.",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: [...sectionKeys],
            description: `Exact destination key. Localized labels from the real CRM navigation:\n${catalog}`,
          },
          filter: {
            type: "string",
            enum: ["overdue", "unassigned", "open"],
            description: "Optional safe filter intent. The client applies it only where that section supports it.",
          },
        },
        required: ["section"],
        additionalProperties: false,
      },
    },
  ] : []

  return [
    ...navigationTools,
    {
      type: "function",
      name: "get_current_screen",
      description: "Read which CRM section or record page is currently visible in the user's browser.",
      parameters: emptyParameters,
    },
    {
      type: "function",
      name: "open_record",
      description: "Open a record returned by find_record. Use the exact returned id and matching record type; never invent either.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...RECORD_TYPE_NAMES], description: "Record type returned by find_record." },
          id: { type: "string", minLength: 6, maxLength: 64, description: "Opaque CRM record id returned by find_record." },
        },
        required: ["type", "id"],
        additionalProperties: false,
      },
    },
  ]
}

/** Exported for provider/model evals so they exercise the exact live contract. */
export function voiceTools(
  sectionKeys: readonly string[] = VOICE_SECTION_KEYS,
  locale: string = "az",
): VoiceFunctionTool[] {
  const allowed = VOICE_SECTION_KEYS.filter((section) => sectionKeys.includes(section))
  const catalog = sectionCatalog(allowed, realtimeCatalogLocale(locale))
  const serverToolNames = allowed.length > 0
    ? VOICE_TOOL_NAMES
    : VOICE_TOOL_NAMES.filter((name) => name !== "explain_section")
  return [
    ...clientTools(allowed, catalog),
    ...serverToolNames.map((name) => serverTool(name, allowed)),
  ]
}
