import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The booking agent's turn, a minute late, on a number the team answers from a phone.
 *
 * Everything here is about the two ways this can go wrong, and they pull in opposite directions:
 * answering over a human who already replied, and never answering at all. So the tests are written
 * as "who ends up being asked to answer, and how many times" — not as "which prisma call happened".
 *
 * The claim is the part worth being strict about. It is stamped before the agent is asked anything,
 * so a crash costs one unanswered customer; a test that only checked the happy path would miss that
 * a failure must NOT come back next minute and ask the model again.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const db = vi.hoisted(() => ({
  channels: [] as Row[],
  messages: [] as Row[],
}))

function matchesWhere(row: Row, where: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "NOT") {
      if (matchesWhere(row, cond as Row)) return false
      continue
    }
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("not" in cond) {
        if (cond.not === null ? row[key] === null || row[key] === undefined : row[key] === cond.not) return false
      }
      if ("lt" in cond && !(row[key] < cond.lt)) return false
      if ("gt" in cond && !(row[key] > cond.gt)) return false
      continue
    }
    if (cond === null) {
      if (row[key] !== null && row[key] !== undefined) return false
      continue
    }
    if (row[key] !== cond) return false
  }
  return true
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: vi.fn(async ({ where }: Row) => db.channels.filter((c) => matchesWhere(c, where))),
    },
    channelMessage: {
      findMany: vi.fn(async ({ where, take }: Row) => db.messages
        .filter((m) => matchesWhere(m, where))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, take ?? 50)),
      findFirst: vi.fn(async ({ where }: Row) => db.messages.find((m) => matchesWhere(m, where)) ?? null),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const hits = db.messages.filter((m) => matchesWhere(m, where))
        hits.forEach((m) => Object.assign(m, data))
        return { count: hits.length }
      }),
    },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))
vi.mock("@/lib/cron/job-lease", () => ({
  withJobLease: async (_opts: unknown, fn: () => Promise<unknown>) => ({ status: "ran", value: await fn() }),
}))
vi.mock("@/lib/sanitize", () => ({ sanitizeLog: (s: string) => s }))

import { runWhatsAppDeferredTurns, DEFERRED_TURN_GRACE_MS, DEFERRED_TURN_CAP_MS } from "@/lib/booking/whatsapp-deferred-turn"

const NOW = new Date("2026-11-09T09:00:00Z")
const ORG = "org_1"
const CHANNEL = "cfg_held"

function heldChannel(settings: Record<string, unknown> = { coexistence: true }) {
  return { id: CHANNEL, organizationId: ORG, isActive: true, channelType: "whatsapp", settings }
}

/** A customer message, `agoMs` before now, exactly as the webhook stores it. */
function waiting(agoMs: number, extra: Row = {}) {
  const row = {
    id: `in_${db.messages.length + 1}`,
    organizationId: ORG,
    channelConfigId: CHANNEL,
    conversationId: "conv_1",
    channelType: "whatsapp",
    direction: "inbound",
    from: "Leyla",
    body: "Sabah 11:30 olar?",
    deferredTurnAt: null,
    createdAt: new Date(NOW.getTime() - agoMs),
    metadata: { waPhone: "994501234567" },
    ...extra,
  }
  db.messages.push(row)
  return row
}

/** Somebody answered — our send, an operator, or a reply typed on the phone. */
function answeredAt(agoMs: number, extra: Row = {}) {
  db.messages.push({
    id: `out_${db.messages.length + 1}`,
    organizationId: ORG,
    channelConfigId: CHANNEL,
    conversationId: "conv_1",
    channelType: "whatsapp",
    direction: "outbound",
    from: "phone_1",
    body: "Bəli, gözləyirik",
    status: "sent",
    deferredTurnAt: null,
    createdAt: new Date(NOW.getTime() - agoMs),
    metadata: { source: "business_app" },
    ...extra,
  })
}

const answer = vi.fn(async () => ({ handled: true }))

beforeEach(() => {
  vi.clearAllMocks()
  db.channels = [heldChannel()]
  db.messages = []
  answer.mockResolvedValue({ handled: true })
})

describe("who gets answered", () => {
  it("gives the agent the turn once the grace has passed", async () => {
    waiting(DEFERRED_TURN_GRACE_MS + 5_000)

    const out = await runWhatsAppDeferredTurns({ now: NOW, answer })

    expect(out).toMatchObject({ candidates: 1, answered: 1, declined: 0, answeredElsewhere: 0 })
    // The agent is handed the stored message and the phone from its metadata — the same arguments
    // the webhook would have given it, so nothing about the agent had to change.
    expect(answer).toHaveBeenCalledWith({
      organizationId: ORG,
      channelConfigId: CHANNEL,
      conversationId: "conv_1",
      waPhone: "994501234567",
      senderName: "Leyla",
      text: "Sabah 11:30 olar?",
    })
  })

  it("leaves the floor to the person with the phone until the grace is up", async () => {
    waiting(DEFERRED_TURN_GRACE_MS - 5_000)

    const out = await runWhatsAppDeferredTurns({ now: NOW, answer })

    expect(out).toMatchObject({ candidates: 0, answered: 0 })
    expect(answer).not.toHaveBeenCalled()
    expect(db.messages[0].deferredTurnAt).toBeNull()
  })

  it("says nothing when a reply was typed on the phone", async () => {
    waiting(5 * 60_000)
    answeredAt(4 * 60_000) // the echo of the team's own answer

    const out = await runWhatsAppDeferredTurns({ now: NOW, answer })

    expect(answer).not.toHaveBeenCalled()
    expect(out.answeredElsewhere).toBe(1)
    // Not claimed: nobody here took responsibility, so the row must not claim to have been dealt
    // with. It simply ages past the cap.
    expect(db.messages[0].deferredTurnAt).toBeNull()
  })

  it("counts an operator's own reply and our earlier send the same way", async () => {
    waiting(5 * 60_000)
    answeredAt(4 * 60_000, { metadata: { channel: "whatsapp" } }) // no business-app marker

    await runWhatsAppDeferredTurns({ now: NOW, answer })

    // Who answered is not the question; that somebody did is.
    expect(answer).not.toHaveBeenCalled()
  })

  it("ignores an answer that came BEFORE the customer wrote", async () => {
    answeredAt(10 * 60_000)
    waiting(5 * 60_000)

    await runWhatsAppDeferredTurns({ now: NOW, answer })

    expect(answer).toHaveBeenCalledTimes(1)
  })

  it("lets a cold request stay unanswered", async () => {
    waiting(DEFERRED_TURN_CAP_MS + 60_000)

    const out = await runWhatsAppDeferredTurns({ now: NOW, answer })

    // «Here are three times» an hour later is worse than silence.
    expect(out.candidates).toBe(0)
    expect(answer).not.toHaveBeenCalled()
  })

  it("skips a message with no words to book from", async () => {
    waiting(5 * 60_000, { body: "" })

    expect((await runWhatsAppDeferredTurns({ now: NOW, answer })).candidates).toBe(0)
  })
})

describe("which channels are in play at all", () => {
  it("never touches a number that answers immediately", async () => {
    db.channels = [heldChannel({ embeddedSignup: true })]
    waiting(5 * 60_000)

    const out = await runWhatsAppDeferredTurns({ now: NOW, answer })

    expect(out).toMatchObject({ channels: 0, candidates: 0 })
    expect(answer).not.toHaveBeenCalled()
  })

  it("never answers on a channel the owner reserved for people", async () => {
    // `always` is the one held case that must never become an automatic answer.
    db.channels = [heldChannel({ coexistence: true, replyHold: "always" })]
    waiting(5 * 60_000)

    expect((await runWhatsAppDeferredTurns({ now: NOW, answer })).channels).toBe(0)
    expect(answer).not.toHaveBeenCalled()
  })

  it("is in play when the owner holds an ordinary channel himself", async () => {
    db.channels = [heldChannel({ embeddedSignup: true, replyHold: "auto", coexistence: true })]
    waiting(5 * 60_000)

    expect((await runWhatsAppDeferredTurns({ now: NOW, answer })).answered).toBe(1)
  })
})

describe("one answer per message, whatever happens", () => {
  it("does not come back for a message it already answered", async () => {
    waiting(5 * 60_000)

    await runWhatsAppDeferredTurns({ now: NOW, answer })
    const second = await runWhatsAppDeferredTurns({ now: new Date(NOW.getTime() + 60_000), answer })

    expect(answer).toHaveBeenCalledTimes(1)
    expect(second).toMatchObject({ candidates: 0 })
  })

  it("does not come back for a message the agent declined", async () => {
    // «Give me a discount» is not a booking request. The agent says so once; asking the model again
    // every minute would cost real money for the same answer.
    answer.mockResolvedValue({ handled: false })
    waiting(5 * 60_000)

    const first = await runWhatsAppDeferredTurns({ now: NOW, answer })
    await runWhatsAppDeferredTurns({ now: new Date(NOW.getTime() + 60_000), answer })

    expect(first).toMatchObject({ declined: 1, answered: 0 })
    expect(answer).toHaveBeenCalledTimes(1)
  })

  it("does not come back for a message whose answer failed", async () => {
    answer.mockRejectedValue(new Error("Meta refused the send"))
    waiting(5 * 60_000)

    const out = await runWhatsAppDeferredTurns({ now: NOW, answer })
    await runWhatsAppDeferredTurns({ now: new Date(NOW.getTime() + 60_000), answer })

    expect(out.failed).toBe(1)
    // The claim stands on purpose: one silence beats a customer answered on the fifth attempt.
    expect(db.messages[0].deferredTurnAt).not.toBeNull()
    expect(answer).toHaveBeenCalledTimes(1)
  })

  it("keeps a failure from costing the rest of the batch", async () => {
    answer.mockRejectedValueOnce(new Error("boom"))
    waiting(6 * 60_000)
    waiting(5 * 60_000, { conversationId: "conv_2" })

    const out = await runWhatsAppDeferredTurns({ now: NOW, answer })

    expect(out).toMatchObject({ failed: 1, answered: 1 })
  })

  it("answers a bounded number of people per run", async () => {
    for (let i = 0; i < 5; i++) waiting(5 * 60_000, { conversationId: `conv_${i}` })

    const out = await runWhatsAppDeferredTurns({ now: NOW, answer, limit: 2 })

    // A backlog must not turn into a burst of messages.
    expect(out.candidates).toBe(2)
    expect(answer).toHaveBeenCalledTimes(2)
  })
})
