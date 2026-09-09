import { prisma } from "@/lib/prisma"
import { ENTITY_FIELDS } from "@/lib/entity-fields"
import { isAdmin } from "@/lib/constants"
import type { Role } from "@/lib/permissions"
import type { VoiceToolName } from "./read-tools"
import type { VoiceRecordType } from "./record-types"
import { SECTION_DESCRIPTORS } from "./section-registry"

const ALL_CONFIGURABLE_ENTITY_TYPES = Object.keys(ENTITY_FIELDS)

const RECORD_ENTITY_TYPE: Partial<Record<VoiceRecordType, string>> = {
  deal: "deal",
  contact: "contact",
  company: "company",
  lead: "lead",
  ticket: "ticket",
  invoice: "invoice",
  contract: "contract",
  quote: "quote",
  campaign: "campaign",
  complaint: "ticket",
  task: "task",
}

const MODEL_ENTITY_TYPE: Record<string, string> = {
  lead: "lead",
  deal: "deal",
  contact: "contact",
  company: "company",
  task: "task",
  quote: "quote",
  invoice: "invoice",
  ticket: "ticket",
  contract: "contract",
  mtmVisit: "mtm_visit",
  mtmRoute: "mtm_route",
  mtmTask: "mtm_task",
}

function supported(types: Array<string | undefined>): string[] {
  return [...new Set(types.filter((type): type is string => Boolean(type && ENTITY_FIELDS[type])))]
}

/**
 * Field-permission families a voice data tool can expose.
 *
 * The policy is deliberately coarse for the pilot: if a manager has hidden
 * fields on an entity, the whole spoken data tool is unavailable. A screen can
 * hide one cell; an audio answer has no equivalent redaction boundary once an
 * aggregate or hint has already been composed. Navigation and section guides
 * return no CRM values and therefore stay available.
 */
export function voiceFieldEntitiesForTool(
  tool: VoiceToolName,
  filter: Record<string, unknown>,
): string[] {
  switch (tool) {
    case "list_deals": return ["deal"]
    case "list_invoices": return ["invoice"]
    case "list_tasks": return ["task"]
    case "list_tickets": return ["ticket"]
    case "list_contacts": return ["contact"]
    case "get_daily_briefing": return ALL_CONFIGURABLE_ENTITY_TYPES
    case "get_pipeline_by_stage":
    case "get_sales_by_manager":
    case "get_forecast_summary":
    case "get_sales_in_period":
      return ["deal"]
    case "get_overdue": return ["task", "invoice", "deal"]
    case "get_leads_summary":
    case "get_lead_coverage":
      return ["lead"]
    case "get_marketing_summary": return ["campaign"]
    case "get_boards_summary": return ["task"]
    case "get_quotes_summary": return ["quote"]
    case "get_field_summary": return ["mtm_visit", "mtm_task"]
    case "get_workload_by_person": {
      const focus = typeof filter.focus === "string" ? filter.focus : "all"
      const type = { tasks: "task", leads: "lead", deals: "deal", tickets: "ticket" }[focus]
      return type ? [type] : ["task", "lead", "deal", "ticket"]
    }
    case "read_record": {
      // Mirrors find_record exactly: reading a card by id is subject to the
      // same hidden-field policy that governs finding the record.
      const type = typeof filter.type === "string" ? filter.type as VoiceRecordType : undefined
      return supported([type ? RECORD_ENTITY_TYPE[type] : undefined])
    }
    case "find_record": {
      const type = typeof filter.type === "string" ? filter.type as VoiceRecordType : undefined
      return supported([type ? RECORD_ENTITY_TYPE[type] : undefined])
    }
    case "describe_section": {
      const section = typeof filter.section === "string" ? filter.section : ""
      const descriptor = SECTION_DESCRIPTORS[section]
      const entityType = descriptor ? MODEL_ENTITY_TYPE[descriptor.model] : undefined
      // Preserve a known-but-unconfigured family (currently mtm_task) so the
      // strict checker below denies it. Dropping it here would turn a missing
      // field-permission matrix into unrestricted spoken aggregates.
      return entityType ? [entityType] : []
    }
    // These tools expose either no configurable entity fields or documentation
    // only. `explain_section` must remain usable even when a data field is hidden.
    case "get_inbox_summary":
    case "explain_section":
      return []
    default: {
      // A tool name absent from this switch does not fail loudly on its own:
      // the undefined return becomes a TypeError in the strict checker, which
      // the route masks as a permanent ACCESS_SCOPE_UNAVAILABLE for every
      // non-admin role. Assigning to `never` turns the missing case into a
      // compile error instead.
      const unhandled: never = tool
      return unhandled
    }
  }
}

/**
 * Strict voice-only permission read. Unlike the generic UI helper, an absent
 * table or DB failure is NOT interpreted as unrestricted access.
 */
export async function canUseVoiceDataFields(
  orgId: string,
  role: Role,
  entityTypes: string[],
): Promise<boolean> {
  if (isAdmin(role) || entityTypes.length === 0) return true
  if (entityTypes.some((entityType) => !ENTITY_FIELDS[entityType])) return false
  const hidden = await prisma.fieldPermission.findFirst({
    where: {
      organizationId: orgId,
      roleId: role,
      entityType: { in: entityTypes },
      access: "hidden",
    },
    select: { id: true },
  })
  return hidden === null
}
