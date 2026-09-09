import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * The 3CX CRM template's `ReportCall` scenario posts one url-encoded form when a
 * call ends. These tests pin the contract that turns that POST into call history:
 * the secret gate, the direction/status mapping, contact matching, and the
 * fingerprint-based de-duplication (3CX sends no call id of its own).
 */

const ORG = "org_3cx"
// Word-shaped on purpose: a random hex string here reads as a real key to
// the gitleaks gate in CI. Only the length has to be stable.
const SECRET = "threecx-test-secret-not-a-real-key"

type CallLogRow = Record<string, unknown> & { id: string }

const state: {
  voipConfigs: { id: string; isActive: boolean; settings: unknown }[]
  openCall: Record<string, unknown> | null
  contact: { id: string } | null
  lead: { id: string } | null
  callEvents: Record<string, unknown>[]
  callLogs: CallLogRow[]
  activities: Record<string, unknown>[]
} = {
  voipConfigs: [],
  openCall: null,
  contact: null,
  lead: null,
  callEvents: [],
  callLogs: [],
  activities: [],
}

class UniqueViolation extends Error {
  code = "P2002"
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: vi.fn(async () => state.voipConfigs),
    },
    contact: {
      findFirst: vi.fn(async () => state.contact),
    },
    lead: {
      findFirst: vi.fn(async () => state.lead),
    },
    callEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const clash = state.callEvents.some(
          e => e.providerCallId === data.providerCallId && e.eventHash === data.eventHash,
        )
        if (clash) throw new UniqueViolation("duplicate")
        state.callEvents.push(data)
        return { id: `evt_${state.callEvents.length}`, ...data }
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    callLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // Mirrors the partial unique index
        // (organizationId, provider, providerCallId) WHERE providerCallId IS NOT NULL.
        if (
          data.providerCallId &&
          state.callLogs.some(c => c.providerCallId === data.providerCallId && c.provider === data.provider)
        ) {
          throw new UniqueViolation("duplicate call log")
        }
        const row = { id: `call_${state.callLogs.length + 1}`, ...data }
        state.callLogs.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.callLogs.find(c => c.id === where.id)
        if (row) Object.assign(row, data)
        return row ?? { id: where.id, ...data }
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.openCall) Object.assign(state.openCall, data)
        else if (data.status === "in-progress") {
          state.openCall = {
            id: "call-answered",
            organizationId: ORG,
            callSid: "call-answered",
            direction: "outbound",
            fromNumber: "101",
            toNumber: "+994500000001",
            activityId: null,
            contactId: null,
            companyId: null,
            userId: null,
            ...data,
          }
        }
        return { count: 1 }
      }),
      findFirst: vi.fn(async () => state.openCall),
    },
    activity: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `act_${state.activities.length + 1}`, ...data }
        state.activities.push(row)
        return row
      }),
    },
  },
}))

import { POST } from "@/app/api/v1/calls/webhook/threecx/route"
import { prisma } from "@/lib/prisma"

function reportCall(fields: Record<string, string>, opts: { secret?: string | null } = {}) {
  const secret = opts.secret === undefined ? SECRET : opts.secret
  const query = new URLSearchParams({ orgId: ORG })
  if (secret) query.set("secret", secret)

  return new NextRequest(`https://app.leaddrivecrm.org/api/v1/calls/webhook/threecx?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ event: "ReportCall", ...fields }).toString(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.voipConfigs = [{ id: "cfg_1", isActive: true, settings: { provider: "threecx", webhookSecret: SECRET } }]
  state.contact = null
  state.lead = null
  state.openCall = null
  state.callEvents = []
  state.callLogs = []
  state.activities = []
})

describe("POST /api/v1/calls/webhook/threecx — CRM-template journaling", () => {
  it("rejects a request without a secret", async () => {
    const res = await POST(reportCall({ callType: "Inbound", number: "994501234567" }, { secret: null }))
    expect(res.status).toBe(401)
    expect(state.callLogs).toHaveLength(0)
  })

  it("rejects a wrong secret", async () => {
    const res = await POST(reportCall({ callType: "Inbound", number: "994501234567" }, { secret: "f".repeat(SECRET.length) }))
    expect(res.status).toBe(401)
    expect(state.callLogs).toHaveLength(0)
  })

  it("rejects when the org has no secret configured at all", async () => {
    state.voipConfigs = [{ id: "cfg_1", isActive: true, settings: { provider: "threecx" } }]
    const res = await POST(reportCall({ callType: "Inbound", number: "994501234567" }))
    expect(res.status).toBe(401)
    expect(state.callLogs).toHaveLength(0)
  })

  it.each([
    ["missing", {}],
    ["unknown", { callType: "Connected" }],
  ])("fails closed for a %s CallType without writing call evidence", async (_label, typeFields) => {
    const res = await POST(reportCall({ number: "994501234567", ...typeFields }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ skipped: "unsupported-call-type" })
    expect(state.callEvents).toHaveLength(0)
    expect(state.callLogs).toHaveLength(0)
    expect(state.activities).toHaveLength(0)
    expect(prisma.contact.findFirst).not.toHaveBeenCalled()
    expect(prisma.lead.findFirst).not.toHaveBeenCalled()
    expect(prisma.callLog.findFirst).not.toHaveBeenCalled()
  })

  it("logs an answered inbound call against the matching contact", async () => {
    state.contact = { id: "contact_1" }

    const res = await POST(
      reportCall({
        callType: "Inbound",
        number: "+994 50 123 45 67",
        agent: "101",
        duration: "00:01:23",
        dateTime: "2026-07-29 18:46:12",
        name: "Rashad",
      }),
    )

    expect(res.status).toBe(200)
    expect(state.callLogs).toHaveLength(1)
    const call = state.callLogs[0]
    expect(call.direction).toBe("inbound")
    expect(call.status).toBe("completed")
    expect(call.duration).toBe(83)
    expect(call.provider).toBe("threecx")
    expect(call.contactId).toBe("contact_1")
    expect(call.fromNumber).toBe("+994 50 123 45 67")
    expect(call.toNumber).toBe("101")
    expect(call.targetPhoneE164).toBe("+994501234567")
    expect(call.wasAnswered).toBe(true)
    expect(call.providerOutcome).toBe("connected")
    expect(state.activities).toHaveLength(1)
    expect(String(state.activities[0].subject)).toContain("Inbound call")

    const contactLookup = vi.mocked(prisma.contact.findFirst).mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>
    }
    expect(contactLookup.where).toMatchObject({
      organizationId: ORG,
      OR: [
        { phone: { in: ["+994501234567", "994501234567", "0501234567"] } },
        { phones: { hasSome: ["+994501234567", "994501234567", "0501234567"] } },
      ],
    })
    expect(JSON.stringify(contactLookup.where)).not.toContain("contains")
  })

  it("records a missed inbound call as no-answer", async () => {
    const res = await POST(reportCall({ callType: "Missed", number: "994501234567", agent: "101" }))

    expect(res.status).toBe(200)
    expect(state.callLogs[0].direction).toBe("inbound")
    expect(state.callLogs[0].status).toBe("no-answer")
    expect(state.callLogs[0].duration).toBeUndefined()
    expect(state.callLogs[0].targetPhoneE164).toBe("+994501234567")
    expect(state.callLogs[0].wasAnswered).toBe(false)
    expect(state.callLogs[0].providerOutcome).toBe("no_answer")
    expect(String(state.activities[0].subject)).toContain("Missed call")
  })

  it("flips from/to for an outbound call", async () => {
    const res = await POST(
      reportCall({ callType: "Outbound", number: "994501234567", agent: "101", duration: "00:00:30" }),
    )

    expect(res.status).toBe(200)
    expect(state.callLogs[0].direction).toBe("outbound")
    expect(state.callLogs[0].fromNumber).toBe("101")
    expect(state.callLogs[0].toNumber).toBe("994501234567")
    expect(state.callLogs[0].targetPhoneE164).toBe("+994501234567")
    expect(state.callLogs[0].wasAnswered).toBe(true)
    expect(state.callLogs[0].providerOutcome).toBe("connected")
  })

  it("falls back to a lead when no contact matches", async () => {
    state.lead = { id: "lead_9" }

    await POST(reportCall({ callType: "Inbound", number: "994501234567", agent: "101" }))

    expect(state.callLogs[0].leadId).toBe("lead_9")
    expect(state.callLogs[0].contactId).toBeUndefined()

    const leadLookup = vi.mocked(prisma.lead.findFirst).mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>
    }
    expect(leadLookup.where).toMatchObject({
      organizationId: ORG,
      OR: [
        { phone: { in: ["+994501234567", "994501234567", "0501234567"] } },
        { phoneWhatsApp: { in: ["+994501234567", "994501234567", "0501234567"] } },
      ],
    })
    expect(JSON.stringify(leadLookup.where)).not.toContain("contains")
  })

  it("closes the click-to-call row instead of adding a second entry", async () => {
    // POST /api/v1/calls wrote this when the agent pressed call in the card.
    // The template knows nothing about it, so without merging the agent ends up
    // with one row stuck at "initiated" and one completed row for one call.
    const clickToCall: CallLogRow = {
      id: "call_click",
      provider: "threecx",
      direction: "outbound",
      status: "initiated",
      fromNumber: "101",
      toNumber: "+994512060838",
      providerCallId: "3cx-call-77",
      contactId: "contact_1",
      leadId: null,
      activityId: null,
    }
    state.callLogs.push(clickToCall)
    state.openCall = clickToCall

    const res = await POST(
      reportCall({ callType: "Outbound", number: "994512060838", agent: "101", duration: "00:00:42" }),
    )

    expect(res.status).toBe(200)
    expect(state.callLogs).toHaveLength(1)
    expect(state.callLogs[0].id).toBe("call_click")
    expect(state.callLogs[0].status).toBe("completed")
    expect(state.callLogs[0].duration).toBe(42)
    expect(state.callLogs[0].targetPhoneE164).toBe("+994512060838")
    expect(state.callLogs[0].wasAnswered).toBe(true)
    expect(state.callLogs[0].providerOutcome).toBe("connected")
    // The PBX call id from makecall must survive — it is the better identifier.
    expect(state.callLogs[0].providerCallId).toBe("3cx-call-77")
    expect(state.activities).toHaveLength(1)

    const openCallLookup = vi.mocked(prisma.callLog.findFirst).mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>
    }
    expect(openCallLookup.where).toMatchObject({
      organizationId: ORG,
      provider: "threecx",
      direction: "outbound",
      toNumber: { in: ["+994512060838", "994512060838", "0512060838"] },
    })
    expect(JSON.stringify(openCallLookup.where)).not.toContain("contains")
  })

  it("does not close an open call for an ambiguous bare subscriber number", async () => {
    const clickToCall: CallLogRow = {
      id: "call_click",
      provider: "threecx",
      direction: "outbound",
      status: "initiated",
      fromNumber: "101",
      toNumber: "+994512060838",
      providerCallId: "3cx-call-ambiguous",
      activityId: null,
    }
    state.callLogs.push(clickToCall)
    state.openCall = clickToCall

    await POST(
      reportCall({ callType: "Outbound", number: "512060838", agent: "101", duration: "00:00:05" }),
    )

    expect(prisma.callLog.findFirst).not.toHaveBeenCalled()
    expect(clickToCall.status).toBe("initiated")
    expect(state.callLogs).toHaveLength(2)
    expect(state.callLogs[1].targetPhoneE164).toBeNull()
  })

  it("does not add a second activity when the reused row already has one", async () => {
    const clickToCall: CallLogRow = {
      id: "call_click",
      provider: "threecx",
      direction: "outbound",
      status: "in-progress",
      fromNumber: "101",
      toNumber: "+994512060838",
      providerCallId: "3cx-call-78",
      contactId: "contact_1",
      leadId: null,
      activityId: "act_existing",
    }
    state.callLogs.push(clickToCall)
    state.openCall = clickToCall

    await POST(reportCall({ callType: "Outbound", number: "994512060838", agent: "101", duration: "00:00:10" }))

    expect(state.callLogs).toHaveLength(1)
    expect(state.activities).toHaveLength(0)
  })

  it("creates a new row when no open call matches", async () => {
    state.openCall = null

    await POST(reportCall({ callType: "Outbound", number: "994512060838", agent: "101", duration: "00:00:12" }))

    expect(state.callLogs).toHaveLength(1)
    expect(state.callLogs[0].status).toBe("completed")
  })

  it("still logs a call from an unknown number", async () => {
    await POST(reportCall({ callType: "Inbound", number: "994559999999", agent: "101" }))

    expect(state.callLogs).toHaveLength(1)
    expect(state.callLogs[0].contactId).toBeUndefined()
    expect(state.callLogs[0].leadId).toBeUndefined()
  })

  it("de-duplicates a repeated POST for the same call", async () => {
    const fields = {
      callType: "Inbound",
      number: "994501234567",
      agent: "101",
      duration: "00:01:23",
      dateTime: "2026-07-29 18:46:12",
    }

    await POST(reportCall(fields))
    const second = await POST(reportCall(fields))

    expect(await second.json()).toMatchObject({ duplicate: true })
    expect(state.callLogs).toHaveLength(1)
    expect(state.activities).toHaveLength(1)
  })

  it("treats a different call from the same number as a new call", async () => {
    await POST(
      reportCall({ callType: "Inbound", number: "994501234567", agent: "101", dateTime: "2026-07-29 18:46:12" }),
    )
    await POST(
      reportCall({ callType: "Inbound", number: "994501234567", agent: "101", dateTime: "2026-07-29 19:10:00" }),
    )

    expect(state.callLogs).toHaveLength(2)
  })

  it("skips a payload with no number instead of writing a broken row", async () => {
    const res = await POST(reportCall({ callType: "Inbound", agent: "101" }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ skipped: "missing-number" })
    expect(state.callLogs).toHaveLength(0)
  })

  it("keeps two timestamp-less missed calls apart rather than dropping the second", async () => {
    // Without [DateTime] the two payloads are byte-identical. Losing a real
    // missed call is worse than an occasional duplicate row, so they must not
    // collapse into one.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-07-29T18:00:00Z"))
      await POST(reportCall({ callType: "Missed", number: "994501234567", agent: "101" }))

      vi.setSystemTime(new Date("2026-07-29T18:05:00Z"))
      await POST(reportCall({ callType: "Missed", number: "994501234567", agent: "101" }))
    } finally {
      vi.useRealTimers()
    }

    expect(state.callLogs).toHaveLength(2)
  })

  it("logs one call when a ring group repeats the ringing event per leg", async () => {
    // The owner's DID routes to a ring group, so the same call rings several
    // extensions. Each leg posts the same callId — only the first is a call.
    const ringing = () =>
      new NextRequest(
        `https://app.leaddrivecrm.org/api/v1/calls/webhook/threecx?orgId=${ORG}&secret=${SECRET}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "call.ringing",
            call: { callId: "call-1", callerNumber: "994501234567", calleeNumber: "800", direction: "inbound" },
          }),
        },
      )

    expect((await POST(ringing())).status).toBe(200)
    const second = await POST(ringing())

    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ ok: true })
    expect(state.callLogs).toHaveLength(1)
  })

  it("marks a proven answered event and its terminal event as connected", async () => {
    const event = (name: string) =>
      new NextRequest(
        `https://app.leaddrivecrm.org/api/v1/calls/webhook/threecx?orgId=${ORG}&secret=${SECRET}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: name,
            call: {
              callId: "call-answered",
              callerNumber: "101",
              calleeNumber: "+994500000001",
              direction: "outbound",
              duration: 32,
            },
          }),
        },
      )

    await POST(event("call.answered"))
    expect(prisma.callLog.updateMany).toHaveBeenLastCalledWith({
      where: { organizationId: ORG, callSid: "call-answered" },
      data: { status: "in-progress", wasAnswered: true },
    })

    await POST(event("call.ended"))
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: ORG, callSid: "call-answered" },
      data: expect.objectContaining({
        status: "completed",
        wasAnswered: true,
        providerOutcome: "connected",
      }),
    }))
  })

  it("does not infer a connected conversation from an Ended event alone", async () => {
    state.openCall = {
      id: "call-ended-only",
      organizationId: ORG,
      callSid: "call-ended-only",
      direction: "outbound",
      fromNumber: "101",
      toNumber: "+994500000001",
      activityId: null,
      contactId: null,
      companyId: null,
      userId: null,
      wasAnswered: false,
    }
    const request = new NextRequest(
      `https://app.leaddrivecrm.org/api/v1/calls/webhook/threecx?orgId=${ORG}&secret=${SECRET}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "call.ended",
          call: {
            callId: "call-ended-only",
            callerNumber: "101",
            calleeNumber: "+994500000001",
            direction: "outbound",
            duration: 32,
          },
        }),
      },
    )

    await POST(request)
    expect(prisma.callLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ providerOutcome: "connected" }),
    }))
  })

  it("accepts the same payload as JSON", async () => {
    const res = await POST(
      new NextRequest(
        `https://app.leaddrivecrm.org/api/v1/calls/webhook/threecx?orgId=${ORG}&secret=${SECRET}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "ReportCall", callType: "Outbound", number: "994501234567", agent: "101" }),
        },
      ),
    )

    expect(res.status).toBe(200)
    expect(state.callLogs).toHaveLength(1)
    expect(state.callLogs[0].direction).toBe("outbound")
  })
})
