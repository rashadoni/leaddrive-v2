/**
 * C9 #14 — public event-registration route, focused on the (eventId, email)
 * unique constraint behavior: a race that loses to the DB unique index must
 * surface 409 (already registered), not a 500. Plus the happy create + the
 * app-level already-registered guard so the P2002 path is the genuine race,
 * not a regression of the pre-check.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_org: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))

vi.mock("@/lib/marketing-attribution/touchpoint-recorder", () => ({
  recordTouchpointsSafe: vi.fn(),
  touchpointSourceKey: {
    eventRegistered: (id: string) => `event:${id}:registered`,
    eventAttended: (id: string) => `event:${id}:attended`,
  },
}))

// Mocked so the reservation lifecycle can be asserted directly. Both gates
// allow by default; individual tests override.
vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0, unavailable: false })),
  reservePublicAction: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0, unavailable: false })),
  releasePublicActionReservation: vi.fn(async () => undefined),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: vi.fn(), updateMany: vi.fn() },
    eventParticipant: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    contact: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { POST } from "@/app/api/v1/public/events/[id]/register/route"
import { prisma } from "@/lib/prisma"
import {
  consumePublicRateLimit,
  releasePublicActionReservation,
  reservePublicAction,
} from "@/lib/public-abuse-guard"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pr = prisma as any

const EVENT = {
  id: "evt-1",
  organizationId: "org-1",
  name: "Tech Conf",
  status: "registration_open",
  startDate: new Date("2026-07-01"),
  endDate: null,
  maxParticipants: null,
  registeredCount: 0,
  campaignId: null, // null → no touchpoint recorded, keeps the test focused
}

function reqFor(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/public/events/evt-1/register", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}
const params = { params: Promise.resolve({ id: "evt-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(consumePublicRateLimit).mockResolvedValue({ allowed: true, retryAfterSeconds: 0, unavailable: false } as never)
  vi.mocked(reservePublicAction).mockResolvedValue({ allowed: true, retryAfterSeconds: 0, unavailable: false } as never)
  vi.mocked(releasePublicActionReservation).mockResolvedValue(undefined)
  pr.event.findFirst.mockResolvedValue(EVENT)
  pr.organization.findUnique.mockResolvedValue({ settings: {}, name: "Org" }) // no smtp → email no-op
  pr.event.updateMany.mockResolvedValue({})
  // $transaction runs its callback against the same prisma mock as `tx`.
  pr.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(pr))
})

describe("C9 #14 — event register unique-constraint handling", () => {
  it("returns 409 (not 500) when the create loses the race to the unique index", async () => {
    pr.eventParticipant.findFirst.mockResolvedValue(null) // pre-check sees nobody
    pr.contact.findFirst.mockResolvedValue(null)
    pr.eventParticipant.count.mockResolvedValue(0)
    // A concurrent request inserted (evt-1, email) between our findFirst and
    // create → Postgres raises the unique violation, Prisma surfaces P2002.
    pr.eventParticipant.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    )

    const res = await POST(reqFor({ name: "Ada Lovelace", email: "ada@x.com" }), params)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/already registered/i)
  })

  it("happy path: creates the participant and returns 201", async () => {
    pr.eventParticipant.findFirst.mockResolvedValue(null)
    pr.contact.findFirst.mockResolvedValue(null)
    pr.eventParticipant.count.mockResolvedValue(0)
    pr.eventParticipant.create.mockResolvedValue({
      id: "p-1",
      registeredAt: new Date("2026-07-01"),
      role: "attendee",
    })

    const res = await POST(reqFor({ name: "Grace Hopper", email: "grace@x.com" }), params)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(pr.eventParticipant.create).toHaveBeenCalledOnce()
  })

  it("app-level pre-check still 409s an already-confirmed registrant (no create attempted)", async () => {
    pr.eventParticipant.findFirst.mockResolvedValue({
      id: "p-existing",
      status: "confirmed",
      inviteStatus: "not_sent",
      name: "Grace",
    })

    const res = await POST(reqFor({ name: "Grace", email: "grace@x.com" }), params)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/already registered/i)
    expect(pr.eventParticipant.create).not.toHaveBeenCalled()
  })
})

describe("recipient allowance is spent only when something happened", () => {
  // The per-recipient gate is keyed on an address the caller names, which makes
  // it a weapon as well as a shield: if a request that writes nothing and sends
  // nothing still consumes the allowance, the cheapest attack is to aim it at a
  // victim — pick a full event, POST their address five times, and each 400
  // burns an hour of that address's budget for free. It also punishes the
  // honest case: try a full event, then fail to register for a different one.
  it("gives the reservation back when the event turned out to be full", async () => {
    pr.eventParticipant.findFirst.mockResolvedValue(null)
    pr.contact.findFirst.mockResolvedValue(null)
    pr.eventParticipant.count.mockResolvedValue(50)
    pr.event.findFirst.mockResolvedValue({ ...EVENT, maxParticipants: 50 })

    const res = await POST(reqFor({ name: "Ada", email: "ada@x.com" }), params)

    expect(res.status).toBe(400)
    expect(pr.eventParticipant.create).not.toHaveBeenCalled()
    expect(releasePublicActionReservation).toHaveBeenCalledOnce()
  })

  it("gives the reservation back when the create lost the unique-index race", async () => {
    pr.eventParticipant.findFirst.mockResolvedValue(null)
    pr.contact.findFirst.mockResolvedValue(null)
    pr.eventParticipant.count.mockResolvedValue(0)
    pr.eventParticipant.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    )

    const res = await POST(reqFor({ name: "Ada", email: "ada@x.com" }), params)

    expect(res.status).toBe(409)
    expect(releasePublicActionReservation).toHaveBeenCalledOnce()
  })

  it("keeps the reservation once the participant is created and mail is on its way", async () => {
    pr.eventParticipant.findFirst.mockResolvedValue(null)
    pr.contact.findFirst.mockResolvedValue(null)
    pr.eventParticipant.count.mockResolvedValue(0)
    pr.eventParticipant.create.mockResolvedValue({
      id: "p-1",
      registeredAt: new Date("2026-07-01"),
      role: "attendee",
    })

    const res = await POST(reqFor({ name: "Grace", email: "grace@x.com" }), params)

    expect(res.status).toBe(201)
    expect(releasePublicActionReservation).not.toHaveBeenCalled()
  })

  it("shares the abuse bucket across plus aliases but preserves the delivery address", async () => {
    pr.eventParticipant.findFirst.mockResolvedValue(null)
    pr.contact.findFirst.mockResolvedValue(null)
    pr.eventParticipant.count.mockResolvedValue(0)
    pr.eventParticipant.create.mockResolvedValue({
      id: "p-alias",
      registeredAt: new Date("2026-07-01"),
      role: "attendee",
    })
    const deliveryAddress = "Victim+campaign@Example.com"

    const res = await POST(reqFor({ name: "Victim User", email: deliveryAddress }), params)

    expect(res.status).toBe(201)
    expect(reservePublicAction).toHaveBeenCalledWith(
      "event-register:recipient",
      "victim@example.com",
      expect.any(Object),
    )
    expect(pr.eventParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: deliveryAddress }) }),
    )
  })

  // The 409 is answered before the gate, so it must not reserve at all —
  // otherwise a double-submit costs the honest registrant their allowance.
  it("does not reserve at all for an already-registered address", async () => {
    pr.eventParticipant.findFirst.mockResolvedValue({
      id: "p-existing",
      status: "confirmed",
      inviteStatus: "not_sent",
      name: "Grace",
    })

    const res = await POST(reqFor({ name: "Grace", email: "grace@x.com" }), params)

    expect(res.status).toBe(409)
    expect(reservePublicAction).not.toHaveBeenCalled()
    expect(releasePublicActionReservation).not.toHaveBeenCalled()
  })
})
