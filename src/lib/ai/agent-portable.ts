/**
 * F4 (Creatio 10X roadmap — AI agent builder) — portable agent definitions.
 *
 * Export an AiAgentConfig as a self-contained JSON an admin can move between
 * orgs/environments, and validate one on import. The portable shape carries ONLY
 * the definition (persona, tools, KB, orchestration hints) — never environment
 * identity: id / organizationId / timestamps / version / isActive are dropped,
 * and `handoffTargets` (org-local config-id references that would dangle
 * elsewhere) is intentionally excluded. Imports always land as an inactive
 * draft so a human reviews + publishes.
 */
import { z } from "zod"

export const AGENT_DEFINITION_FORMAT = "leaddrive.agent-definition"
export const AGENT_DEFINITION_VERSION = 1

/** The definition fields that travel with an export (env/identity fields excluded). */
export const PORTABLE_AGENT_FIELDS = [
  "configName",
  "model",
  "maxTokens",
  "temperature",
  "systemPrompt",
  "toolsEnabled",
  "escalationEnabled",
  "escalationRules",
  "kbEnabled",
  "kbMaxArticles",
  "agentType",
  "department",
  "priority",
  "intents",
  "greeting",
  "maxToolRounds",
  "notes",
] as const

export type PortableAgentField = (typeof PORTABLE_AGENT_FIELDS)[number]

export interface AgentDefinitionEnvelope {
  format: typeof AGENT_DEFINITION_FORMAT
  version: number
  exportedAt: string
  definition: Record<string, unknown>
}

/** Build the downloadable envelope from a stored config row. */
export function toPortableDefinition(config: Record<string, unknown>): AgentDefinitionEnvelope {
  const definition: Record<string, unknown> = {}
  for (const key of PORTABLE_AGENT_FIELDS) {
    const v = config[key]
    if (v !== undefined && v !== null) definition[key] = v
  }
  return {
    format: AGENT_DEFINITION_FORMAT,
    version: AGENT_DEFINITION_VERSION,
    exportedAt: new Date().toISOString(),
    definition,
  }
}

/**
 * Validate the `definition` payload of an imported envelope. Mirrors the create
 * route's constraints so an import can't smuggle an invalid config past the API.
 * `model` is validated by the route against KNOWN_AI_MODELS (kept out of here to
 * avoid a budget import in shared code); everything else is shape/range checked.
 */
export const importedDefinitionSchema = z
  .object({
    configName: z.string().min(1).max(255),
    model: z.string().max(100).optional(),
    maxTokens: z.number().int().positive().max(200000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    systemPrompt: z.string().max(20000).optional(),
    toolsEnabled: z.array(z.string().max(100)).max(200).optional(),
    escalationEnabled: z.boolean().optional(),
    escalationRules: z.array(z.string().max(500)).max(100).optional(),
    kbEnabled: z.boolean().optional(),
    kbMaxArticles: z.number().int().min(0).max(50).optional(),
    agentType: z.enum(["sales", "support", "marketing", "analyst", "contract", "general", "inbox", "social"]).optional(),
    department: z.string().max(100).optional(),
    priority: z.number().int().optional(),
    intents: z.array(z.string().max(100)).max(100).optional(),
    greeting: z.string().max(1000).optional(),
    maxToolRounds: z.number().int().min(1).max(50).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strip() // drop any extra keys (e.g. a stale handoffTargets/id) rather than fail

export const importEnvelopeSchema = z.object({
  format: z.literal(AGENT_DEFINITION_FORMAT),
  version: z.number(),
  exportedAt: z.string().optional(),
  definition: importedDefinitionSchema,
})
