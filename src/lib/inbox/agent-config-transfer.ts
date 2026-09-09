import { knowledgeWithoutApprovedCompanyContacts } from "@/lib/inbox/company-phone-policy"

/**
 * Moving a configured AI agent from one tenant to another.
 *
 * Copying the two text boxes by hand is the obvious approach and the wrong one:
 * how the assistant behaves is not decided by the prompt alone. `autoLeadEnabled`
 * and `escalationEnabled` change what the engine APPENDS to that prompt, and
 * `temperature`, `model` and `greeting` change the reply as much as a sentence
 * of instructions does. Carrying the prose and re-setting the switches by eye
 * produces an assistant that behaves differently with an identical prompt, and
 * the difference shows up in front of customers rather than in the settings
 * screen.
 *
 * So the unit of transfer is the whole card, and it is checkable: the document
 * carries a digest of exactly the fields that were exported, and an import that
 * silently drops one is a failed import rather than a partial one.
 *
 * Deliberately NOT carried: id, organizationId, timestamps, and anything a
 * channel authorises — tokens belong to the tenant that granted them and are
 * re-authorised on the other side.
 */

export const AGENT_TRANSFER_FORMAT = "leaddrive.ai-agent-config/1"

/** Every field that decides how the agent behaves. Order fixed: it feeds the digest. */
export const TRANSFERABLE_FIELDS = [
  "configName",
  "agentType",
  "model",
  "maxTokens",
  "temperature",
  "systemPrompt",
  "knowledgeBase",
  "replyLanguage",
  "greeting",
  "toolsEnabled",
  "escalationEnabled",
  "escalationRules",
  "kbEnabled",
  "kbMaxArticles",
  "isActive",
  "notes",
  "autoLeadEnabled",
  "autoAssignSales",
  "autonomousBacklogEnabled",
  "autonomousLookbackDays",
  "autonomousBatchSize",
  "department",
  "priority",
  "intents",
  "maxToolRounds",
] as const

export type TransferableField = (typeof TRANSFERABLE_FIELDS)[number]
export type AgentTransferPayload = Partial<Record<TransferableField, unknown>>

export type AgentTransferDocument = {
  format: string
  exportedAt: string
  /** Present for a human reading the file; never used to decide anything. */
  sourceOrganization?: string
  digest: string
  agent: AgentTransferPayload
}

/**
 * A digest over the exported values, not over the file. Re-ordered keys, a
 * different indentation or an added comment must not invalidate a document a
 * person opened in an editor; a changed price or a flipped switch must.
 */
export function transferDigest(agent: AgentTransferPayload): string {
  const canonical = TRANSFERABLE_FIELDS.map((field) => {
    const value = agent[field]
    return `${field}=${value === undefined || value === null ? "" : JSON.stringify(value)}`
  }).join("\n")
  // FNV-1a: short, stable across runtimes, and enough to catch an edit or a
  // truncated paste. Not a security control — nothing here is a secret.
  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}-${canonical.length}`
}

export function toTransferDocument(
  config: Record<string, unknown>,
  meta: { exportedAt: string; sourceOrganization?: string },
): AgentTransferDocument {
  const agent: AgentTransferPayload = {}
  for (const field of TRANSFERABLE_FIELDS) {
    if (config[field] === undefined) continue
    // Public contacts are tenant-owned configuration. Exporting a persona may
    // carry product facts, but must not silently carry Gobustone's phone or
    // address into a different organisation.
    agent[field] = field === "knowledgeBase"
      ? knowledgeWithoutApprovedCompanyContacts(config[field])
      : config[field]
  }
  return {
    format: AGENT_TRANSFER_FORMAT,
    exportedAt: meta.exportedAt,
    ...(meta.sourceOrganization ? { sourceOrganization: meta.sourceOrganization } : {}),
    digest: transferDigest(agent),
    agent,
  }
}

export type TransferParseResult =
  | { ok: true; agent: AgentTransferPayload; warnings: string[] }
  | { ok: false; error: string }

const STRING_FIELDS: TransferableField[] = ["configName", "agentType", "model", "systemPrompt", "knowledgeBase", "replyLanguage", "greeting", "notes", "department"]
const BOOLEAN_FIELDS: TransferableField[] = ["escalationEnabled", "kbEnabled", "isActive", "autoLeadEnabled", "autoAssignSales", "autonomousBacklogEnabled"]
const INT_FIELDS: TransferableField[] = ["maxTokens", "kbMaxArticles", "autonomousLookbackDays", "autonomousBatchSize", "priority", "maxToolRounds"]
const STRING_ARRAY_FIELDS: TransferableField[] = ["toolsEnabled", "escalationRules", "intents"]

/**
 * Reject rather than repair. An import that quietly coerces a wrong type is how
 * a tenant ends up with an agent that looks transferred and is not.
 */
export function parseTransferDocument(input: unknown): TransferParseResult {
  if (!input || typeof input !== "object") return { ok: false, error: "The file is not a configuration document." }
  const doc = input as Partial<AgentTransferDocument>
  if (doc.format !== AGENT_TRANSFER_FORMAT) {
    return { ok: false, error: `Unknown format ${JSON.stringify(doc.format ?? null)}; expected ${AGENT_TRANSFER_FORMAT}.` }
  }
  if (!doc.agent || typeof doc.agent !== "object") return { ok: false, error: "The document carries no agent." }

  const agent: AgentTransferPayload = {}
  const warnings: string[] = []
  const source = doc.agent as Record<string, unknown>

  for (const [key] of Object.entries(source)) {
    if (!(TRANSFERABLE_FIELDS as readonly string[]).includes(key)) {
      // A field this version does not know about. Named, not swallowed: it is
      // the one thing that will not arrive on the other side.
      warnings.push(`Ignored unknown field "${key}".`)
    }
  }

  for (const field of TRANSFERABLE_FIELDS) {
    const value = source[field]
    if (value === undefined) continue
    if (value === null) { agent[field] = null; continue }
    if (STRING_FIELDS.includes(field)) {
      if (typeof value !== "string") return { ok: false, error: `Field "${field}" must be text.` }
      agent[field] = value
    } else if (BOOLEAN_FIELDS.includes(field)) {
      if (typeof value !== "boolean") return { ok: false, error: `Field "${field}" must be true or false.` }
      agent[field] = value
    } else if (INT_FIELDS.includes(field)) {
      if (typeof value !== "number" || !Number.isInteger(value)) return { ok: false, error: `Field "${field}" must be a whole number.` }
      agent[field] = value
    } else if (STRING_ARRAY_FIELDS.includes(field)) {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return { ok: false, error: `Field "${field}" must be a list of text values.` }
      agent[field] = value
    } else if (field === "temperature") {
      if (typeof value !== "number" || Number.isNaN(value)) return { ok: false, error: `Field "temperature" must be a number.` }
      agent[field] = value
    }
  }

  if (typeof doc.digest === "string" && doc.digest !== transferDigest(agent)) {
    return {
      ok: false,
      error: "The document was edited after it was exported, or arrived incomplete: its checksum does not match its contents.",
    }
  }

  return { ok: true, agent, warnings }
}
