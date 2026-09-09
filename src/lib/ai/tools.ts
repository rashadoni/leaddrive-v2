import type { Tool } from "@anthropic-ai/sdk/resources/messages"
import { hasModule, type ModuleId } from "@/lib/modules"
import { READ_TOOLS, READ_TOOL_META, READ_TOOL_MODULE, READ_TOOL_NAMES } from "./read-tools"

export type RiskLevel = "low" | "medium" | "high"

export interface ToolMeta {
  riskLevel: RiskLevel
  category: string
  requiresApproval: boolean
}

export const TOOL_META: Record<string, ToolMeta> = {
  add_note: { riskLevel: "low", category: "notes", requiresApproval: false },
  log_activity: { riskLevel: "low", category: "activity", requiresApproval: false },
  create_task: { riskLevel: "low", category: "tasks", requiresApproval: false },
  update_deal_stage: { riskLevel: "medium", category: "deals", requiresApproval: false },
  create_ticket: { riskLevel: "medium", category: "tickets", requiresApproval: false },
  create_deal: { riskLevel: "high", category: "deals", requiresApproval: true },
  send_email: { riskLevel: "high", category: "email", requiresApproval: true },
  update_contact: { riskLevel: "high", category: "contacts", requiresApproval: true },
  // Smart AI Search — read-only tools (category "read", no approval). Gated by
  // the `ai_smart_search` org flag in the chat route.
  ...READ_TOOL_META,
}

const WRITE_TOOLS: Tool[] = [
  // LOW RISK
  {
    name: "add_note",
    description: "Add a note to a contact, company, or deal",
    input_schema: {
      type: "object" as const,
      properties: {
        entityType: { type: "string", enum: ["contact", "company", "deal"] },
        entityId: { type: "string" },
        content: { type: "string", description: "Note text" },
      },
      required: ["entityType", "entityId", "content"],
    },
  },
  {
    name: "log_activity",
    description: "Log a call, meeting, or email activity",
    input_schema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: ["call", "meeting", "email", "note"] },
        subject: { type: "string" },
        description: { type: "string" },
        contactId: { type: "string" },
        relatedType: { type: "string", enum: ["deal", "ticket", "lead"] },
        relatedId: { type: "string" },
      },
      required: ["type", "subject"],
    },
  },
  {
    name: "create_task",
    description: "Create a task assigned to a user",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        assignedTo: { type: "string", description: "User ID or 'me'" },
        dueDate: { type: "string", description: "ISO date string" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        relatedType: { type: "string", enum: ["deal", "contact", "company", "lead", "ticket"] },
        relatedId: { type: "string" },
      },
      required: ["title"],
    },
  },

  // MEDIUM RISK
  {
    name: "update_deal_stage",
    description: "Move a deal to a different pipeline stage",
    input_schema: {
      type: "object" as const,
      properties: {
        dealId: { type: "string" },
        stage: { type: "string", description: "Stage name (e.g. QUALIFIED, PROPOSAL)" },
      },
      required: ["dealId", "stage"],
    },
  },
  {
    name: "create_ticket",
    description: "Create a support ticket",
    input_schema: {
      type: "object" as const,
      properties: {
        subject: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        category: { type: "string" },
        contactId: { type: "string" },
        companyId: { type: "string" },
      },
      required: ["subject"],
    },
  },
  {
    name: "create_deal",
    description: "Create a new deal in the pipeline",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        valueAmount: { type: "number" },
        currency: { type: "string" },
        companyId: { type: "string" },
        contactId: { type: "string" },
        stage: { type: "string" },
        pipelineId: { type: "string" },
      },
      required: ["name"],
    },
  },

  // HIGH RISK
  {
    name: "send_email",
    description: "Send an email to a contact",
    input_schema: {
      type: "object" as const,
      properties: {
        to: { type: "string", description: "Email address" },
        subject: { type: "string" },
        body: { type: "string", description: "Email body (HTML)" },
        contactId: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "update_contact",
    description: "Update contact fields",
    input_schema: {
      type: "object" as const,
      properties: {
        contactId: { type: "string" },
        fields: {
          type: "object",
          description: "Key-value pairs to update (e.g. phone, email, position)",
        },
      },
      required: ["contactId", "fields"],
    },
  },
]

// Write tools + read-only Smart AI Search tools. Read tools are filtered out in
// the chat route when the `ai_smart_search` flag is off, so registering them
// here is safe (the flag gate is the rollout switch).
export const CRM_TOOLS: Tool[] = [...WRITE_TOOLS, ...READ_TOOLS]

export const WRITE_TOOL_MODULE: Partial<Record<string, ModuleId>> = {
  add_note: "crm",
  log_activity: "crm",
  create_task: "crm",
  update_contact: "crm",
  update_deal_stage: "sales",
  create_deal: "sales",
  create_ticket: "support",
}

export function getToolModule(toolName: string): ModuleId | undefined {
  return WRITE_TOOL_MODULE[toolName] ?? READ_TOOL_MODULE[toolName]
}

export function filterToolsByTenantModules<T extends { name: string }>(
  tools: T[],
  org: { plan: string; addons?: string[]; modules?: Record<string, boolean> },
): T[] {
  return tools.filter((tool) => {
    const moduleId = getToolModule(tool.name)
    return !moduleId || hasModule(org, moduleId)
  })
}

export function getEnabledTools(toolsEnabled: string[]): Tool[] {
  if (!toolsEnabled.length) return [] // no tools enabled = no tools
  if (toolsEnabled.includes("*")) return CRM_TOOLS // wildcard = all tools
  return CRM_TOOLS.filter(t => toolsEnabled.includes(t.name))
}

// Agent type → default tool sets for multi-agent orchestration.
// Read-only Smart AI Search tools (list_*) are appended per agent type:
// analyst + general get all five (retrieval is their core value); sales/support
// get the reads relevant to their domain. Read tools only reach the LLM when the
// `ai_smart_search` flag is on (filtered in the chat route).
const AGENT_TOOL_SETS: Record<string, string[]> = {
  sales: ["create_deal", "update_deal_stage", "log_activity", "add_note", "send_email", "create_task", "list_deals", "list_invoices", "list_contacts"],
  support: ["create_ticket", "add_note", "log_activity", "create_task", "list_tickets", "list_contacts"],
  marketing: ["log_activity", "add_note", "create_task", "list_contacts"],
  analyst: ["add_note", ...READ_TOOL_NAMES],
  general: ["add_note", "log_activity", "create_task", ...READ_TOOL_NAMES],
}

export function getEnabledToolsForAgent(config: { toolsEnabled?: string[]; agentType?: string }): Tool[] {
  // If agent has explicit tools configured, use those
  if (config.toolsEnabled?.length) {
    return getEnabledTools(config.toolsEnabled)
  }
  // Otherwise use default set for agent type
  const allowedNames = AGENT_TOOL_SETS[config.agentType || "general"] ?? AGENT_TOOL_SETS.general
  return CRM_TOOLS.filter(t => allowedNames.includes(t.name))
}
