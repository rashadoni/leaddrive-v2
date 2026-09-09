import { describe, it, expect } from "vitest"
import {
  AGENT_TRANSFER_FORMAT,
  TRANSFERABLE_FIELDS,
  toTransferDocument,
  parseTransferDocument,
  transferDigest,
} from "@/lib/inbox/agent-config-transfer"

/**
 * Moving an agent to another tenant.
 *
 * The failure this guards against is not a crash — it is an import that looks
 * like it worked. Copying the two text boxes and re-setting the switches by eye
 * produces an assistant that behaves differently with an identical prompt,
 * because `autoLeadEnabled` and `escalationEnabled` change what the engine
 * appends to that prompt.
 */

const CONFIG = {
  id: "cfg_1",
  organizationId: "org_1",
  createdAt: new Date(),
  updatedAt: new Date(),
  configName: "Gobustone",
  agentType: "inbox",
  model: "claude-sonnet-4-6",
  maxTokens: 512,
  temperature: 0.1,
  systemPrompt: "Sən Qobustan şirkətinin rəsmi onlayn məsləhətçisisən.",
  knowledgeBase: "60x25x20: 3.10 AZN",
  replyLanguage: "az",
  greeting: "Salam!",
  toolsEnabled: [],
  escalationEnabled: true,
  escalationRules: [],
  kbEnabled: true,
  kbMaxArticles: 3,
  isActive: true,
  notes: null,
  autoLeadEnabled: true,
  autoAssignSales: true,
  autonomousBacklogEnabled: false,
  autonomousLookbackDays: 7,
  autonomousBatchSize: 20,
  department: null,
  priority: 0,
  intents: [],
  maxToolRounds: 5,
}

describe("exporting an agent", () => {
  const doc = toTransferDocument(CONFIG, { exportedAt: "2026-08-12T10:00:00.000Z", sourceOrganization: "LeadDrive Inc." })

  it("carries every field that changes how the assistant behaves", () => {
    for (const field of TRANSFERABLE_FIELDS) {
      expect(doc.agent, `${field} must travel`).toHaveProperty(field)
    }
    // The switches are the point: the prompt alone is not the configuration.
    expect(doc.agent.autoLeadEnabled).toBe(true)
    expect(doc.agent.escalationEnabled).toBe(true)
    expect(doc.agent.temperature).toBe(0.1)
  })

  it("carries nothing that belongs to the source tenant", () => {
    for (const leaked of ["id", "organizationId", "createdAt", "updatedAt"]) {
      expect(doc.agent).not.toHaveProperty(leaked)
    }
  })

  it("does not carry a tenant-specific phone hidden in the Knowledge Base", () => {
    const config = {
      ...CONFIG,
      knowledgeBase: [
        "60x25x20: 3.10 AZN",
        "APPROVED_COMPANY_PHONE: 0507778555",
        "APPROVED_COMPANY_ADDRESS: Bakı şəhəri, Qaradağ rayonu",
      ].join("\n"),
    }
    const exported = toTransferDocument(config, { exportedAt: "2026-08-12T10:00:00.000Z" })
    expect(exported.agent.knowledgeBase).toBe("60x25x20: 3.10 AZN")
  })
})

describe("importing an agent", () => {
  const doc = toTransferDocument(CONFIG, { exportedAt: "2026-08-12T10:00:00.000Z" })

  it("round-trips without losing a field", () => {
    const parsed = parseTransferDocument(JSON.parse(JSON.stringify(doc)))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    for (const field of TRANSFERABLE_FIELDS) {
      expect(parsed.agent[field]).toEqual(doc.agent[field])
    }
    expect(parsed.warnings).toEqual([])
  })

  it("survives reformatting, because the digest is over values and not over the file", () => {
    const reordered = { ...doc, agent: Object.fromEntries(Object.entries(doc.agent).reverse()) }
    expect(parseTransferDocument(reordered).ok).toBe(true)
  })

  it("refuses a document edited after export", () => {
    const tampered = { ...doc, agent: { ...doc.agent, temperature: 1.0 } }
    const parsed = parseTransferDocument(tampered)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain("checksum")
  })

  it("refuses a truncated paste", () => {
    const { knowledgeBase: _dropped, ...rest } = doc.agent
    expect(parseTransferDocument({ ...doc, agent: rest }).ok).toBe(false)
  })

  it("rejects a wrong type instead of coercing it", () => {
    for (const bad of [
      { field: "temperature", value: "0.1" },
      { field: "autoLeadEnabled", value: "true" },
      { field: "maxTokens", value: 512.5 },
      { field: "intents", value: "sales" },
      { field: "systemPrompt", value: 42 },
    ]) {
      const agent = { ...doc.agent, [bad.field]: bad.value }
      const parsed = parseTransferDocument({ ...doc, agent, digest: transferDigest(agent) })
      expect(parsed.ok, `${bad.field}=${JSON.stringify(bad.value)} must be rejected`).toBe(false)
    }
  })

  it("names an unknown field rather than swallowing it", () => {
    const agent = { ...doc.agent, futureSetting: "x" }
    const parsed = parseTransferDocument({ ...doc, agent, digest: transferDigest(agent as never) })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.warnings.join(" ")).toContain("futureSetting")
  })

  it("refuses a file that is not one of ours", () => {
    expect(parseTransferDocument({ format: "something/else", agent: {} }).ok).toBe(false)
    expect(parseTransferDocument({ format: AGENT_TRANSFER_FORMAT }).ok).toBe(false)
    expect(parseTransferDocument("not a document").ok).toBe(false)
    expect(parseTransferDocument(null).ok).toBe(false)
  })
})
