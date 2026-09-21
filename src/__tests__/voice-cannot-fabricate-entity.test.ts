import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Roadmap V1.10 — the model cannot fabricate a trusted entity selection.
 *
 * `voice-model-cannot-write.test.ts` proves the model publishes no id-shaped
 * parameter. That stops the obvious route and leaves a quieter one: a model
 * steered by text in a record could put an identifier into a field that looks
 * innocent — a name — and hope some resolver passes it through.
 *
 * So this test poisons every argument with a sentinel that looks exactly like
 * a CRM id, runs every proposal tool, and asserts that no sentinel reaches any
 * field the CRM treats as a reference. Every id in a resolved payload must be
 * one the database returned for this caller.
 */

const DB_IDS = {
  user: "db-user-0001",
  lead: "db-lead-0001",
  company: "db-company-0001",
  contact: "db-contact-0001",
} as const

const mocks = vi.hoisted(() => ({
  users: vi.fn(),
  leads: vi.fn(),
  companies: vi.fn(),
  contacts: vi.fn(),
  pipeline: vi.fn(),
  stage: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.users },
    lead: { findMany: mocks.leads },
    company: { findMany: mocks.companies },
    contact: { findMany: mocks.contacts },
    pipeline: { findFirst: mocks.pipeline },
    pipelineStage: { findFirst: mocks.stage },
  },
}))
vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: vi.fn(async (_o: string, _u: string, _r: string, _t: string, where: object) => where),
}))

import { resolveVoiceProposal } from "@/lib/ai/voice/propose-resolve"
import { VOICE_PROPOSE_TOOL_NAMES, type VoiceProposeToolName } from "@/lib/ai/voice/propose-tools"
import type { AuthResult } from "@/lib/api-auth"

const auth = {
  orgId: "org-1",
  userId: "user-1",
  role: "manager",
  email: "me@example.com",
  name: "Me",
} as unknown as AuthResult

/** Looks exactly like a CRM id. If one of these reaches a reference field, the
 *  model chose the record, not the database. */
const POISON = "clxpoisoned0000000000001"

/** Fields the CRM reads as a reference to another record. */
const REFERENCE_FIELDS = ["assignedTo", "companyId", "contactId", "relatedId", "pipelineId", "campaignId"]

/** Every string argument each tool accepts, filled with the poison. */
const POISONED_ARGS: Record<VoiceProposeToolName, Record<string, unknown>> = {
  propose_create_task: {
    title: POISON, description: POISON, assigneeName: POISON, relateToCurrentRecord: true,
  },
  propose_create_lead: {
    contactName: POISON, companyName: POISON, assigneeName: POISON, notes: POISON,
    interest: POISON, source: POISON, sourceDetail: POISON,
  },
  propose_update_lead: {
    leadName: POISON, contactName: POISON, companyName: POISON, assigneeName: POISON, notes: POISON,
  },
  propose_convert_lead_to_deal: { leadName: POISON, dealTitle: POISON },
  propose_create_deal: {
    name: POISON, companyName: POISON, contactName: POISON, assigneeName: POISON, notes: POISON,
  },
}

beforeEach(() => {
  // The database resolves every name to its OWN id, never to the argument.
  mocks.users.mockResolvedValue([{ id: DB_IDS.user, name: POISON, email: "a@x.az" }])
  mocks.leads.mockResolvedValue([{ id: DB_IDS.lead, contactName: POISON, companyName: null }])
  mocks.companies.mockResolvedValue([{ id: DB_IDS.company, name: POISON }])
  mocks.contacts.mockResolvedValue([{ id: DB_IDS.contact, fullName: POISON }])
  mocks.pipeline.mockResolvedValue(null)
  mocks.stage.mockResolvedValue(null)
})

describe("no proposal tool lets the model choose a record", () => {
  it("covers every published proposal tool", () => {
    expect(Object.keys(POISONED_ARGS).sort()).toEqual([...VOICE_PROPOSE_TOOL_NAMES].sort())
  })

  it.each(VOICE_PROPOSE_TOOL_NAMES)("%s puts only database ids in reference fields", async (tool) => {
    const result = await resolveVoiceProposal(
      auth,
      tool,
      POISONED_ARGS[tool],
      // The screen id is the browser's, not the model's, and it is also not
      // the poison — so if the poison appears, it came from the arguments.
      { recordType: "lead", recordId: "screen-lead-0001" },
    )

    expect(result.kind, `${tool} did not resolve`).toBe("resolved")
    if (result.kind !== "resolved") return

    for (const field of REFERENCE_FIELDS) {
      expect(result.payload[field], `${tool}.${field} carries a model-supplied id`).not.toBe(POISON)
    }
    expect(result.targetEntityId, `${tool} targets a model-supplied record`).not.toBe(POISON)
  })

  it("resolves each name to the id the database returned", async () => {
    const task = await resolveVoiceProposal(auth, "propose_create_task", POISONED_ARGS.propose_create_task, {})
    expect(task).toMatchObject({ payload: { assignedTo: DB_IDS.user } })

    const deal = await resolveVoiceProposal(auth, "propose_create_deal", POISONED_ARGS.propose_create_deal, {})
    expect(deal).toMatchObject({
      payload: { companyId: DB_IDS.company, contactId: DB_IDS.contact, assignedTo: DB_IDS.user },
    })

    const update = await resolveVoiceProposal(auth, "propose_update_lead", POISONED_ARGS.propose_update_lead, {})
    expect(update).toMatchObject({ targetEntityId: DB_IDS.lead })
  })

  // The subtle case: text the user dictated legitimately ends up in the payload
  // as TEXT. A lead's contact name may be anything, including something that
  // looks like an id — that is data, and it must stay in its text field.
  it("keeps dictated text as text, never promoting it into a reference", async () => {
    const lead = await resolveVoiceProposal(auth, "propose_create_lead", POISONED_ARGS.propose_create_lead, {})
    expect(lead.kind).toBe("resolved")
    if (lead.kind !== "resolved") return
    expect(lead.payload.contactName).toBe(POISON)
    for (const field of REFERENCE_FIELDS) {
      if (field === "assignedTo") continue
      expect(lead.payload[field], field).toBeUndefined()
    }
  })

  it("never lets the model name the record an update touches directly", async () => {
    // No leadName: the target must be the screen's, which the browser read
    // from its own location, not a value the model supplied.
    const result = await resolveVoiceProposal(
      auth,
      "propose_update_lead",
      { notes: POISON },
      { recordType: "lead", recordId: "screen-lead-0001" },
    )
    expect(result).toMatchObject({ targetEntityId: "screen-lead-0001" })
  })
})

describe("the actor behind every CRM audit entry", () => {
  // V1.9. An audit row that records a creation but not its author answers
  // "what happened" and hides "who did it" — for a click and for a voice
  // command alike. Four of the five commands used to omit it.
  const COMMAND_AUDITS: Array<[string, RegExp]> = [
    ["src/lib/crm-commands/task/create-task.ts", /logAudit\(orgId, "create", "task"[\s\S]{0,160}userId/],
    ["src/lib/crm-commands/lead/create-lead.ts", /logAudit\(orgId, "create", "lead"[\s\S]{0,160}userId/],
    ["src/lib/crm-commands/lead/update-lead.ts", /logAudit\(orgId, "update", "lead"[\s\S]{0,160}userId/],
    ["src/lib/crm-commands/lead/convert-lead-to-deal.ts", /logAudit\(organizationId, "convert", "lead"[\s\S]{0,200}userId/],
    ["src/lib/crm-commands/deal/effects.ts", /logAudit\(organizationId, "create", "deal"[\s\S]{0,160}userId/],
  ]

  it.each(COMMAND_AUDITS)("%s names the actor", (path, pattern) => {
    expect(readFileSync(path, "utf8")).toMatch(pattern)
  })

  // The deal helper is shared by creation and by conversion; a caller that
  // forgets the actor silently drops it from one of the two paths.
  it("passes the actor from both callers of the shared deal effects", () => {
    const calls = [
      readFileSync("src/lib/crm-commands/deal/create-deal.ts", "utf8"),
      readFileSync("src/lib/crm-commands/lead/convert-lead-to-deal.ts", "utf8"),
    ].flatMap((source) => [...source.matchAll(/dispatchDealCreatedEffects\(([^)]*)\)/g)].map((m) => m[1]))
    expect(calls).toHaveLength(2)
    for (const args of calls) expect(args, args).toMatch(/,\s*userId\s*$/)
  })
})

describe("the record-to-action link is queryable", () => {
  const migration = readFileSync(
    "prisma/migrations/20260921100000_ai_action_intent_result_idx/migration.sql",
    "utf8",
  )
  const schema = readFileSync("prisma/schema.prisma", "utf8")

  // Only the record an action ACTS ON was indexed; the record it PRODUCED was
  // not, so "where did this lead come from" meant a full scan.
  it("indexes the record an action produced, not only the one it acted on", () => {
    expect(migration).toMatch(
      /CREATE INDEX "ai_action_intents_org_result_idx"\s+ON "ai_action_intents"\("organizationId", "resultEntityType", "resultEntityId"\)/,
    )
  })

  it("declares the same index in the schema, so there is no drift", () => {
    expect(schema).toContain(
      '@@index([organizationId, resultEntityType, resultEntityId], map: "ai_action_intents_org_result_idx")',
    )
  })

  it("is a plain index, not a data migration", () => {
    expect(migration).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER TABLE|DISABLE ROW LEVEL SECURITY)\b/i)
  })
})
