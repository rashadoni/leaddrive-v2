import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Saving a page's AI settings from the «ИИ-агент» screen. What must hold: a save reaches only a
 * page of the caller's own organisation, the page's connection data (tokens, ids) in the same
 * settings blob survives, and «вернуть общий» really removes the page's agent and hours.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const { db, matches, table } = vi.hoisted(() => {
  const db = { agents: [] as Row[], channels: [] as Row[], hours: [] as Row[], seq: 0 }
  const matches = (row: Row, where: Row): boolean => {
    return Object.entries(where).every(([key, cond]) => {
      if (cond && typeof cond === "object" && "in" in cond) return (cond.in as unknown[]).includes(row[key])
      return row[key] === cond
    })
    }
    const table = (rows: () => Row[]) => ({
    findFirst: vi.fn(async ({ where }: Row) => rows().find((r) => matches(r, where)) ?? null),
    findMany: vi.fn(async ({ where }: Row) => rows().filter((r) => matches(r, where))),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      const hit = rows().filter((r) => matches(r, where))
      hit.forEach((r) => Object.assign(r, data))
      return { count: hit.length }
    }),
  })
  return { db, matches, table }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: table(() => db.channels),
    aiAgentConfig: {
      ...table(() => db.agents),
      create: vi.fn(async ({ data }: Row) => { const row = { id: `agent_${++db.seq}`, ...data }; db.agents.push(row); return row }),
      deleteMany: vi.fn(async ({ where }: Row) => { const before = db.agents.length; db.agents = db.agents.filter((r) => !matches(r, where)); return { count: before - db.agents.length } }),
    },
    businessHours: {
      ...table(() => db.hours),
      deleteMany: vi.fn(async ({ where }: Row) => { const before = db.hours.length; db.hours = db.hours.filter((r) => !matches(r, where)); return { count: before - db.hours.length } }),
      upsert: vi.fn(async ({ where, create, update }: Row) => {
        const key = where.organizationId_channelType
        const existing = db.hours.find((r) => r.organizationId === key.organizationId && r.channelType === key.channelType)
        if (existing) return Object.assign(existing, update)
        db.hours.push({ ...create })
        return create
      }),
    },
  },
}))

import { listPageAgents, updatePageAgent } from "@/lib/inbox/page-agent-settings"
import { pageBusinessHoursKey } from "@/lib/inbox/business-hours"

const ORG = "org_zeytun"
const BABY = "cfg_baby"
const agent = { systemPrompt: "Тепло и коротко.", knowledgeBase: "Bambi: 24 AZN.", greeting: "Salam!", replyLanguage: "az" as const }
const save = (update: Parameters<typeof updatePageAgent>[0]["update"], organizationId = ORG, channelConfigId = BABY) =>
  updatePageAgent({ organizationId, channelConfigId, userId: "user_admin", update })

beforeEach(() => {
  db.seq = 0
  db.agents = [{
    id: "agent_common", organizationId: ORG, agentType: "inbox", channelConfigId: null,
    systemPrompt: "Общие правила.", knowledgeBase: "Общие знания.", greeting: "", replyLanguage: null,
    model: "claude-sonnet-4-6", temperature: 0.3, maxTokens: 700, escalationEnabled: false,
  }]
  db.channels = [
    { id: BABY, organizationId: ORG, channelType: "instagram", configName: "zeytun.baby", isActive: true, settings: { igLogin: true, replyMode: "agent", webhookSecret: "keep-me" } },
    { id: "cfg_wa", organizationId: ORG, channelType: "whatsapp", configName: "+994", isActive: true, settings: {} },
    { id: "cfg_foreign", organizationId: "org_other", channelType: "instagram", configName: "someone", isActive: true, settings: { replyMode: "agent" } },
  ]
  db.hours = [{ organizationId: ORG, channelType: "all", timezone: "Asia/Baku", schedule: {} }]
})

describe("saving a page's own agent", () => {
  it("creates it for that page, starting from the common agent's model and escalation", async () => {
    expect(await save({ agent })).toEqual({ ok: true })

    const row = db.agents.find((a) => a.agentType === "inbox_page")
    expect(row).toMatchObject({
      organizationId: ORG, channelConfigId: BABY, systemPrompt: "Тепло и коротко.", knowledgeBase: "Bambi: 24 AZN.",
      replyLanguage: "az", model: "claude-sonnet-4-6", temperature: 0.3, escalationEnabled: false,
    })
    // The organisation's common agent is a different row and is untouched.
    expect(db.agents.find((a) => a.id === "agent_common")).toMatchObject({ systemPrompt: "Общие правила.", agentType: "inbox" })
  })

  it("updates the same row on the next save instead of adding a second agent for the page", async () => {
    await save({ agent })
    await save({ agent: { ...agent, knowledgeBase: "Bambi: 26 AZN." } })

    const rows = db.agents.filter((a) => a.agentType === "inbox_page")
    expect(rows).toHaveLength(1)
    expect(rows[0].knowledgeBase).toBe("Bambi: 26 AZN.")
  })

  it("«вернуть общий» removes the page's agent", async () => {
    await save({ agent })
    await save({ agent: null })

    expect(db.agents.map((a) => a.id)).toEqual(["agent_common"])
  })

  it("refuses another organisation's page and writes nothing", async () => {
    const result = await save({ agent, aiOn: true }, ORG, "cfg_foreign")

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(db.agents).toHaveLength(1)
    expect(db.channels.find((c) => c.id === "cfg_foreign")!.settings).toEqual({ replyMode: "agent" })
  })

  it("refuses a WhatsApp number: its AI is a different agent, a page agent there would be read by nothing", async () => {
    expect(await save({ agent }, ORG, "cfg_wa")).toMatchObject({ ok: false, status: 404 })
    expect(db.agents).toHaveLength(1)
  })
})

describe("the page's AI switch, schedule and hours", () => {
  it("turns the AI on for the page without losing the page's connection settings", async () => {
    await save({ aiOn: true, aiSchedule: "outside_hours" })

    expect(db.channels.find((c) => c.id === BABY)!.settings).toEqual({
      igLogin: true, webhookSecret: "keep-me", replyMode: "ai", aiSchedule: "outside_hours",
    })
  })

  it("saves the page's own hours under the page, and removes them again", async () => {
    await save({ hours: { timezone: "Asia/Baku", schedule: { mon: { enabled: true, intervals: [{ start: "12:00", end: "20:00" }] } } } })
    expect(db.hours.find((h) => h.channelType === pageBusinessHoursKey(BABY))).toMatchObject({ organizationId: ORG, timezone: "Asia/Baku" })

    await save({ hours: null })
    expect(db.hours.map((h) => h.channelType)).toEqual(["all"])
  })

  it("refuses a time zone that does not exist", async () => {
    expect(await save({ hours: { timezone: "Mars/Olympus", schedule: {} } })).toMatchObject({ ok: false, status: 400 })
    expect(db.hours).toHaveLength(1)
  })
})

describe("the list the screen shows", () => {
  it("names each page the inbox AI answers on, with what is its own", async () => {
    await save({ agent, aiOn: true })

    const { pages, commonAgent, defaultTimezone } = await listPageAgents(ORG)

    // The WhatsApp number and the other organisation's page are not in it.
    expect(pages.map((p) => p.channelConfigId)).toEqual([BABY])
    expect(pages[0]).toMatchObject({ name: "zeytun.baby", aiOn: true, aiSchedule: "always", hours: null })
    expect(pages[0].agent).toMatchObject({ knowledgeBase: "Bambi: 24 AZN." })
    expect(commonAgent).toMatchObject({ systemPrompt: "Общие правила." })
    expect(defaultTimezone).toBe("Asia/Baku")
  })
})
