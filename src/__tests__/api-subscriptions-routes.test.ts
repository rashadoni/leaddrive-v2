/**
 * D4 Subscription Management slice 2 — route handler tests.
 *
 * Exercises the request-boundary behavior: auth gating, Zod
 * validation, cross-tenant FK rejection, status-gate enforcement,
 * proration math integration, transaction atomicity, SubscriptionEvent
 * audit-row emission. Mocks Prisma + api-auth — zero DB. The DB
 * CHECK constraints + transactions are integration-tested elsewhere.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscriptionPlan: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    subscription: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    subscriptionEvent: { create: vi.fn(), findMany: vi.fn() },
    dunningAttempt: { findMany: vi.fn() },
    company: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi
    .fn()
    .mockImplementation(
      (r: unknown) =>
        r != null &&
        typeof r === "object" &&
        "status" in (r as Record<string, unknown>) &&
        typeof (r as { json?: unknown }).json === "function"
    ),
}))

import { POST as POST_plan, GET as GET_plan } from "@/app/api/v1/subscription-plans/route"
import { POST as POST_sub, GET as GET_sub } from "@/app/api/v1/subscriptions/route"
import { POST as POST_trans } from "@/app/api/v1/subscriptions/[id]/transition/route"
import { POST as POST_change } from "@/app/api/v1/subscriptions/[id]/plan-change/route"
import { POST as POST_sched } from "@/app/api/v1/subscriptions/[id]/schedule-cancel/route"
import { GET as GET_dun } from "@/app/api/v1/dunning-attempts/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const ORG = "org-1"
const USER = "user-1"
const PLAN = "plan-1"
const SUB = "sub-1"

function makeReq(url: string, method: "GET" | "POST", body?: unknown): NextRequest {
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { "Content-Type": "application/json" }
  }
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function mockAuthOk() {
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: USER,
    role: "manager",
    email: "u@example.com",
    name: "U",
  } as never)
}

function mockAuthFail() {
  vi.mocked(requireAuth).mockResolvedValue(
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ─── POST /api/v1/subscription-plans ─────────────────────────────────── */

describe("POST /api/v1/subscription-plans", () => {
  it("returns 401 on auth fail", async () => {
    mockAuthFail()
    const res = await POST_plan(
      makeReq("/api/v1/subscription-plans", "POST", { name: "Pro", unitAmount: 30 })
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 on missing required fields", async () => {
    mockAuthOk()
    const res = await POST_plan(
      makeReq("/api/v1/subscription-plans", "POST", { name: "Pro" })
    )
    expect(res.status).toBe(400)
  })

  it("creates a plan with defaults (currency=USD, interval=month, count=1, trialDays=0)", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscriptionPlan.create).mockResolvedValue({
      id: PLAN,
      organizationId: ORG,
      name: "Pro",
      unitAmount: 30,
      currency: "USD",
      billingInterval: "month",
      billingIntervalCount: 1,
      trialDays: 0,
      isActive: true,
    } as never)
    const res = await POST_plan(
      makeReq("/api/v1/subscription-plans", "POST", { name: "Pro", unitAmount: 30 })
    )
    expect(res.status).toBe(201)
    const createCall = vi.mocked(prisma.subscriptionPlan.create).mock.calls[0][0]!
    expect(createCall.data.currency).toBe("USD")
    expect(createCall.data.billingInterval).toBe("month")
    expect(createCall.data.billingIntervalCount).toBe(1)
    expect(createCall.data.trialDays).toBe(0)
    expect(createCall.data.isActive).toBe(true)
  })

  it("rejects negative unitAmount via Zod", async () => {
    mockAuthOk()
    const res = await POST_plan(
      makeReq("/api/v1/subscription-plans", "POST", { name: "Pro", unitAmount: -5 })
    )
    expect(res.status).toBe(400)
  })
})

describe("GET /api/v1/subscription-plans", () => {
  it("filters by isActive=true", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscriptionPlan.findMany).mockResolvedValue([] as never)
    await GET_plan(makeReq("/api/v1/subscription-plans?isActive=true", "GET"))
    const call = vi.mocked(prisma.subscriptionPlan.findMany).mock.calls[0][0]!
    expect(call.where).toMatchObject({ organizationId: ORG, isActive: true })
  })

  it("rejects invalid isActive filter with 400", async () => {
    mockAuthOk()
    const res = await GET_plan(makeReq("/api/v1/subscription-plans?isActive=maybe", "GET"))
    expect(res.status).toBe(400)
  })
})

/* ─── POST /api/v1/subscriptions ──────────────────────────────────────── */

describe("POST /api/v1/subscriptions", () => {
  it("returns 401 on auth fail", async () => {
    mockAuthFail()
    const res = await POST_sub(
      makeReq("/api/v1/subscriptions", "POST", { planId: PLAN, companyId: "c-1" })
    )
    expect(res.status).toBe(401)
  })

  it("rejects payload missing both companyId and contactId (400)", async () => {
    mockAuthOk()
    const res = await POST_sub(
      makeReq("/api/v1/subscriptions", "POST", { planId: PLAN })
    )
    expect(res.status).toBe(400)
  })

  it("returns 404 when plan is not in tenant (and SELECT was org-scoped)", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscriptionPlan.findFirst).mockResolvedValue(null)
    const res = await POST_sub(
      makeReq("/api/v1/subscriptions", "POST", { planId: PLAN, companyId: "c-1" })
    )
    expect(res.status).toBe(404)
    // Air-tight regression guard: future drop of organizationId from the
    // cross-tenant findFirst here would silently leak plans from other
    // tenants. Assert the SELECT was org-scoped on a real id, not just
    // "not found" status code.
    const planFindCall = vi.mocked(prisma.subscriptionPlan.findFirst).mock.calls[0][0]!
    expect(planFindCall.where).toMatchObject({ id: PLAN, organizationId: ORG })
  })

  it("returns 409 when plan is archived (isActive=false)", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscriptionPlan.findFirst).mockResolvedValue({
      id: PLAN,
      isActive: false,
      unitAmount: 30,
      currency: "USD",
      billingInterval: "month",
      billingIntervalCount: 1,
      trialDays: 0,
    } as never)
    const res = await POST_sub(
      makeReq("/api/v1/subscriptions", "POST", { planId: PLAN, companyId: "c-1" })
    )
    expect(res.status).toBe(409)
  })

  it("returns 404 when companyId is not in tenant (and SELECT was org-scoped)", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscriptionPlan.findFirst).mockResolvedValue({
      id: PLAN,
      isActive: true,
      unitAmount: 30,
      currency: "USD",
      billingInterval: "month",
      billingIntervalCount: 1,
      trialDays: 0,
    } as never)
    vi.mocked(prisma.company.findFirst).mockResolvedValue(null)
    const res = await POST_sub(
      makeReq("/api/v1/subscriptions", "POST", { planId: PLAN, companyId: "c-leaked" })
    )
    expect(res.status).toBe(404)
    const companyFindCall = vi.mocked(prisma.company.findFirst).mock.calls[0][0]!
    expect(companyFindCall.where).toMatchObject({ id: "c-leaked", organizationId: ORG })
  })

  it("creates a trial-status subscription when plan.trialDays > 0", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscriptionPlan.findFirst).mockResolvedValue({
      id: PLAN,
      isActive: true,
      unitAmount: 30,
      currency: "USD",
      billingInterval: "month",
      billingIntervalCount: 1,
      trialDays: 14,
    } as never)
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: "c-1" } as never)
    const txMocks = {
      subscription: {
        create: vi.fn().mockResolvedValue({
          id: SUB,
          status: "trial",
          trialEndsAt: new Date("2026-05-31T00:00:00Z"),
        }),
      },
      subscriptionEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMocks) => Promise<unknown>)(txMocks)
    )
    const res = await POST_sub(
      makeReq("/api/v1/subscriptions", "POST", { planId: PLAN, companyId: "c-1" })
    )
    expect(res.status).toBe(201)
    // Subscription create payload should reflect trial status from
    // calculateInitialPeriod (status='trial' since trialDays > 0).
    const subCreateCall = txMocks.subscription.create.mock.calls[0][0] as {
      data: { status: string; trialEndsAt: Date | null }
    }
    expect(subCreateCall.data.status).toBe("trial")
    expect(subCreateCall.data.trialEndsAt).not.toBeNull()
    // Audit `created` event must accompany the subscription row.
    expect(txMocks.subscriptionEvent.create).toHaveBeenCalledTimes(1)
    const eventCreateCall = txMocks.subscriptionEvent.create.mock.calls[0][0] as {
      data: { eventType: string; newStatus: string }
    }
    expect(eventCreateCall.data.eventType).toBe("created")
    expect(eventCreateCall.data.newStatus).toBe("trial")
  })

  it("creates an active-status subscription when plan.trialDays = 0", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscriptionPlan.findFirst).mockResolvedValue({
      id: PLAN,
      isActive: true,
      unitAmount: 30,
      currency: "USD",
      billingInterval: "month",
      billingIntervalCount: 1,
      trialDays: 0,
    } as never)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "ct-1" } as never)
    const txMocks = {
      subscription: {
        create: vi.fn().mockResolvedValue({ id: SUB, status: "active" }),
      },
      subscriptionEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMocks) => Promise<unknown>)(txMocks)
    )
    const res = await POST_sub(
      makeReq("/api/v1/subscriptions", "POST", { planId: PLAN, contactId: "ct-1" })
    )
    expect(res.status).toBe(201)
    const subCreateCall = txMocks.subscription.create.mock.calls[0][0] as {
      data: { status: string; trialEndsAt: Date | null }
    }
    expect(subCreateCall.data.status).toBe("active")
    expect(subCreateCall.data.trialEndsAt).toBeNull()
  })
})

/* ─── POST /api/v1/subscriptions/[id]/transition ─────────────────────── */

describe("POST /api/v1/subscriptions/[id]/transition", () => {
  const ctx = (id = SUB) => ({ params: Promise.resolve({ id }) })

  it("returns 404 when subscription not in tenant (and SELECT was org-scoped)", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null)
    const res = await POST_trans(
      makeReq("/api/v1/subscriptions/sub-1/transition", "POST", { to: "active" }),
      ctx()
    )
    expect(res.status).toBe(404)
    const subFindCall = vi.mocked(prisma.subscription.findFirst).mock.calls[0][0]!
    expect(subFindCall.where).toMatchObject({ id: SUB, organizationId: ORG })
  })

  it("returns 409 on invalid SM transition (trial → paused)", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "trial",
      planId: PLAN,
    } as never)
    const res = await POST_trans(
      makeReq("/api/v1/subscriptions/sub-1/transition", "POST", { to: "paused" }),
      ctx()
    )
    expect(res.status).toBe(409)
  })

  it("trial → active emits BOTH `trial_ended` and `activated` events", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "trial",
      planId: PLAN,
    } as never)
    const txMocks = {
      // Simulate Prisma.Decimal for unitAmount — normalizeSubscriptionRow must
      // convert to a plain number. Regression guard: a missing wrap would
      // serialize as a Decimal string "29.9900" instead of number 2999.
      subscription: { update: vi.fn().mockResolvedValue({ id: SUB, status: "active", unitAmount: { toNumber: () => 2999 } }) },
      subscriptionEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMocks) => Promise<unknown>)(txMocks)
    )
    const res = await POST_trans(
      makeReq("/api/v1/subscriptions/sub-1/transition", "POST", { to: "active" }),
      ctx()
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    // Decimal-normalization guard: unitAmount must be a JS number in the response.
    expect(typeof json.subscription.unitAmount).toBe("number")
    expect(json.subscription.unitAmount).toBe(2999)
    // Two audit rows expected for trialEnding side-effect.
    expect(txMocks.subscriptionEvent.create).toHaveBeenCalledTimes(2)
    const eventTypes = txMocks.subscriptionEvent.create.mock.calls.map(
      (c) => (c[0] as { data: { eventType: string } }).data.eventType
    )
    expect(eventTypes).toEqual(["trial_ended", "activated"])
  })

  it("active → paused sets pausedAt + nextBillingAt=null", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "active",
      planId: PLAN,
    } as never)
    const txMocks = {
      subscription: { update: vi.fn().mockResolvedValue({ id: SUB, status: "paused" }) },
      subscriptionEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMocks) => Promise<unknown>)(txMocks)
    )
    await POST_trans(
      makeReq("/api/v1/subscriptions/sub-1/transition", "POST", { to: "paused" }),
      ctx()
    )
    const updateCall = txMocks.subscription.update.mock.calls[0][0] as {
      data: {
        status: string
        pausedAt: Date
        resumedAt: Date | null
        nextBillingAt: Date | null
      }
    }
    expect(updateCall.data.status).toBe("paused")
    expect(updateCall.data.pausedAt).toBeInstanceOf(Date)
    expect(updateCall.data.resumedAt).toBeNull()
    expect(updateCall.data.nextBillingAt).toBeNull()
  })

  it("paused → active sets resumedAt (NOT pausedAt overwrite)", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "paused",
      planId: PLAN,
    } as never)
    const txMocks = {
      subscription: { update: vi.fn().mockResolvedValue({ id: SUB, status: "active" }) },
      subscriptionEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMocks) => Promise<unknown>)(txMocks)
    )
    await POST_trans(
      makeReq("/api/v1/subscriptions/sub-1/transition", "POST", { to: "active" }),
      ctx()
    )
    const updateCall = txMocks.subscription.update.mock.calls[0][0] as {
      data: { resumedAt: Date; pausedAt: Date | null }
    }
    expect(updateCall.data.resumedAt).toBeInstanceOf(Date)
    // Defense-in-depth: must NOT clobber the original pausedAt (which
    // stays sticky for audit / report).
    expect(updateCall.data.pausedAt).toBeUndefined()
  })

  it("active → cancelled sets cancelledAt + nextBillingAt=null + emits `cancelled` event", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "active",
      planId: PLAN,
    } as never)
    const txMocks = {
      subscription: { update: vi.fn().mockResolvedValue({ id: SUB, status: "cancelled" }) },
      subscriptionEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMocks) => Promise<unknown>)(txMocks)
    )
    await POST_trans(
      makeReq("/api/v1/subscriptions/sub-1/transition", "POST", { to: "cancelled" }),
      ctx()
    )
    const updateCall = txMocks.subscription.update.mock.calls[0][0] as {
      data: { cancelledAt: Date; nextBillingAt: Date | null }
    }
    expect(updateCall.data.cancelledAt).toBeInstanceOf(Date)
    expect(updateCall.data.nextBillingAt).toBeNull()
    expect(txMocks.subscriptionEvent.create).toHaveBeenCalledTimes(1)
    const eventTypes = txMocks.subscriptionEvent.create.mock.calls.map(
      (c) => (c[0] as { data: { eventType: string } }).data.eventType
    )
    expect(eventTypes).toEqual(["cancelled"])
  })

  it("rejects leaving the cancelled terminal with 409", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "cancelled",
      planId: PLAN,
    } as never)
    const res = await POST_trans(
      makeReq("/api/v1/subscriptions/sub-1/transition", "POST", { to: "active" }),
      ctx()
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/terminal/i)
  })
})

/* ─── POST /api/v1/subscriptions/[id]/plan-change ────────────────────── */

describe("POST /api/v1/subscriptions/[id]/plan-change", () => {
  const ctx = (id = SUB) => ({ params: Promise.resolve({ id }) })

  it("returns 404 when subscription not in tenant (and SELECT was org-scoped)", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null)
    const res = await POST_change(
      makeReq("/api/v1/subscriptions/sub-1/plan-change", "POST", { newPlanId: "plan-2" }),
      ctx()
    )
    expect(res.status).toBe(404)
    const subFindCall = vi.mocked(prisma.subscription.findFirst).mock.calls[0][0]!
    expect(subFindCall.where).toMatchObject({ id: SUB, organizationId: ORG })
  })

  it("returns 409 when subscription is not active (status=trial)", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "trial",
      planId: PLAN,
      unitAmount: 10,
      currency: "USD",
      currentPeriodStart: new Date("2026-05-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-05-31T00:00:00Z"),
    } as never)
    const res = await POST_change(
      makeReq("/api/v1/subscriptions/sub-1/plan-change", "POST", { newPlanId: "plan-2" }),
      ctx()
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/status="active"/)
  })

  it("returns 400 on same-plan no-op", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "active",
      planId: PLAN,
      unitAmount: 10,
      currency: "USD",
      currentPeriodStart: new Date("2026-05-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-05-31T00:00:00Z"),
    } as never)
    const res = await POST_change(
      makeReq("/api/v1/subscriptions/sub-1/plan-change", "POST", { newPlanId: PLAN }),
      ctx()
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 on cross-currency plan change", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "active",
      planId: PLAN,
      unitAmount: 10,
      currency: "USD",
      currentPeriodStart: new Date("2026-05-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-05-31T00:00:00Z"),
    } as never)
    vi.mocked(prisma.subscriptionPlan.findFirst).mockResolvedValue({
      id: "plan-eur",
      isActive: true,
      unitAmount: 30,
      currency: "EUR",
      billingInterval: "month",
      billingIntervalCount: 1,
    } as never)
    const res = await POST_change(
      makeReq("/api/v1/subscriptions/sub-1/plan-change", "POST", { newPlanId: "plan-eur" }),
      ctx()
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Currency mismatch/i)
  })

  it("happy-path mid-cycle upgrade applies proration + emits plan_changed event", async () => {
    // Freeze time so the route's internal `new Date()` (asOf for the
    // proration call) is deterministic. asOf = May 16 → 15/30 days
    // remaining in a May 1–May 31 period. Upgrade $10 → $30:
    //   unusedCredit = round2(10 * 0.5) = 5
    //   newCharge    = round2(30 * 0.5) = 15
    //   prorationAmount = 15 - 5 = 10 (customer owes +$10)
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-16T00:00:00Z"))
    try {
      mockAuthOk()
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
        id: SUB,
        status: "active",
        planId: PLAN,
        unitAmount: 10,
        currency: "USD",
        currentPeriodStart: new Date("2026-05-01T00:00:00Z"),
        currentPeriodEnd: new Date("2026-05-31T00:00:00Z"),
      } as never)
      vi.mocked(prisma.subscriptionPlan.findFirst).mockResolvedValue({
        id: "plan-pro",
        isActive: true,
        unitAmount: 30,
        currency: "USD",
        billingInterval: "month",
        billingIntervalCount: 1,
      } as never)
      const txMocks = {
        // Simulate Prisma.Decimal for unitAmount (duck-typed: has .toNumber()).
        // normalizeSubscriptionRow must convert it to a plain number before
        // the response is serialised — this guards against Decimal→string regression.
        subscription: { update: vi.fn().mockResolvedValue({ id: SUB, unitAmount: { toNumber: () => 30 } }) },
        subscriptionEvent: { create: vi.fn().mockResolvedValue({}) },
      }
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
        (cb as (tx: typeof txMocks) => Promise<unknown>)(txMocks)
      )
      const res = await POST_change(
        makeReq("/api/v1/subscriptions/sub-1/plan-change", "POST", { newPlanId: "plan-pro" }),
        ctx()
      )
      expect(res.status).toBe(200)
      const json = await res.json()
      // Value-asserted proration math (frozen time makes asOf deterministic):
      expect(json.proration).toMatchObject({
        daysInPeriod: 30,
        daysRemaining: 15,
        unusedCredit: 5,
        newCharge: 15,
        prorationAmount: 10,
      })
      // Audit row must carry the same prorationAmount and the plan-id deltas.
      expect(txMocks.subscriptionEvent.create).toHaveBeenCalledTimes(1)
      const eventCall = txMocks.subscriptionEvent.create.mock.calls[0][0] as {
        data: {
          eventType: string
          previousPlanId: string
          newPlanId: string
          prorationAmount: number
        }
      }
      expect(eventCall.data.eventType).toBe("plan_changed")
      expect(eventCall.data.previousPlanId).toBe(PLAN)
      expect(eventCall.data.newPlanId).toBe("plan-pro")
      expect(eventCall.data.prorationAmount).toBe(10)

      // Decimal-normalization guard: unitAmount must be a JS number, not a
      // Prisma.Decimal string ("30.0000") or Decimal object. Regression for
      // the normalizeSubscriptionRow() wrap added in 68a46d93.
      expect(json.subscription.unitAmount).toBe(30)
      expect(typeof json.subscription.unitAmount).toBe("number")

      // Period-boundary carry-over regression guard. Scope: this
      // assertion only covers the active+same-currency happy path
      // (the fixture used above). A regression that conditionally
      // touches period fields ONLY on cross-currency / paused /
      // past_due / trial branches would not be caught here — those
      // branches all reject BEFORE the update fires (see the four
      // rejection tests above). So in the current route shape this
      // is sufficient; if slice 3 adds new write-time branches,
      // mirror the assertion in their corresponding happy-path tests.
      const updateCall = txMocks.subscription.update.mock.calls[0][0] as {
        data: Record<string, unknown>
      }
      expect(updateCall.data.currentPeriodStart).toBeUndefined()
      expect(updateCall.data.currentPeriodEnd).toBeUndefined()
      expect(updateCall.data.nextBillingAt).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

/* ─── POST /api/v1/subscriptions/[id]/schedule-cancel ─────────────────── */

describe("POST /api/v1/subscriptions/[id]/schedule-cancel", () => {
  const ctx = (id = SUB) => ({ params: Promise.resolve({ id }) })

  it("returns 409 when subscription is already cancelled (and SELECT was org-scoped)", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "cancelled",
      cancelAtPeriodEnd: false,
    } as never)
    const res = await POST_sched(
      makeReq("/api/v1/subscriptions/sub-1/schedule-cancel", "POST", { cancelAtPeriodEnd: true }),
      ctx()
    )
    expect(res.status).toBe(409)
    // Air-tight regression guard: schedule-cancel's findFirst MUST scope
    // by organizationId. The other 3 schedule-cancel paths share this
    // SELECT; one assertion here covers the entire route's call-site.
    const subFindCall = vi.mocked(prisma.subscription.findFirst).mock.calls[0][0]!
    expect(subFindCall.where).toMatchObject({ id: SUB, organizationId: ORG })
  })

  it("returns 400 on same-state no-op (already true)", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "active",
      cancelAtPeriodEnd: true,
    } as never)
    const res = await POST_sched(
      makeReq("/api/v1/subscriptions/sub-1/schedule-cancel", "POST", { cancelAtPeriodEnd: true }),
      ctx()
    )
    expect(res.status).toBe(400)
  })

  it("flips the flag false→true and emits cancel_scheduled event", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "active",
      cancelAtPeriodEnd: false,
    } as never)
    const txMocks = {
      subscription: {
        update: vi.fn().mockResolvedValue({ id: SUB, cancelAtPeriodEnd: true }),
      },
      subscriptionEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMocks) => Promise<unknown>)(txMocks)
    )
    const res = await POST_sched(
      makeReq("/api/v1/subscriptions/sub-1/schedule-cancel", "POST", { cancelAtPeriodEnd: true }),
      ctx()
    )
    expect(res.status).toBe(200)
    // flag update
    const updateCall = txMocks.subscription.update.mock.calls[0][0] as {
      data: { cancelAtPeriodEnd: boolean }
    }
    expect(updateCall.data.cancelAtPeriodEnd).toBe(true)
    // audit event
    const eventCall = txMocks.subscriptionEvent.create.mock.calls[0][0] as {
      data: { eventType: string; subscriptionId: string; previousStatus: string; metadata: { source: string } }
    }
    expect(eventCall.data.eventType).toBe("cancel_scheduled")
    expect(eventCall.data.subscriptionId).toBe(SUB)
    expect(eventCall.data.previousStatus).toBe("active")
    expect(eventCall.data.metadata.source).toBe("schedule_cancel_route")
  })

  it("revokes a scheduled cancel (true→false) and emits cancel_revoked event", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: SUB,
      status: "active",
      cancelAtPeriodEnd: true,
    } as never)
    const txMocks = {
      subscription: {
        // Simulate Prisma.Decimal — normalizeSubscriptionRow must convert to a plain
        // number. Regression guard for the wrap added to schedule-cancel route.
        update: vi.fn().mockResolvedValue({ id: SUB, cancelAtPeriodEnd: false, unitAmount: { toNumber: () => 2999 } }),
      },
      subscriptionEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) =>
      (cb as (tx: typeof txMocks) => Promise<unknown>)(txMocks)
    )
    const res = await POST_sched(
      makeReq("/api/v1/subscriptions/sub-1/schedule-cancel", "POST", { cancelAtPeriodEnd: false }),
      ctx()
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.scheduled).toBe(false)
    // Decimal-normalization guard: unitAmount must be a JS number in the response.
    expect(typeof json.subscription.unitAmount).toBe("number")
    expect(json.subscription.unitAmount).toBe(2999)
    // audit event
    const eventCall = txMocks.subscriptionEvent.create.mock.calls[0][0] as {
      data: { eventType: string; previousStatus: string; metadata: { source: string } }
    }
    expect(eventCall.data.eventType).toBe("cancel_revoked")
    expect(eventCall.data.previousStatus).toBe("active")
    expect(eventCall.data.metadata.source).toBe("schedule_cancel_route")
  })
})

/* ─── GET /api/v1/dunning-attempts ────────────────────────────────────── */

describe("GET /api/v1/dunning-attempts", () => {
  it("returns 401 on auth fail", async () => {
    mockAuthFail()
    const res = await GET_dun(makeReq("/api/v1/dunning-attempts", "GET"))
    expect(res.status).toBe(401)
  })

  it("filters by status=pending → attemptedAt IS NULL", async () => {
    mockAuthOk()
    vi.mocked(prisma.dunningAttempt.findMany).mockResolvedValue([] as never)
    await GET_dun(makeReq("/api/v1/dunning-attempts?status=pending", "GET"))
    const call = vi.mocked(prisma.dunningAttempt.findMany).mock.calls[0][0]!
    expect(call.where).toMatchObject({ organizationId: ORG, attemptedAt: null })
  })

  it("filters by status=succeeded → succeededAt NOT NULL", async () => {
    mockAuthOk()
    vi.mocked(prisma.dunningAttempt.findMany).mockResolvedValue([] as never)
    await GET_dun(makeReq("/api/v1/dunning-attempts?status=succeeded", "GET"))
    const call = vi.mocked(prisma.dunningAttempt.findMany).mock.calls[0][0]!
    expect(call.where).toMatchObject({
      organizationId: ORG,
      succeededAt: { not: null },
    })
  })

  it("filters by status=failed → failureReason set + succeededAt NULL", async () => {
    mockAuthOk()
    vi.mocked(prisma.dunningAttempt.findMany).mockResolvedValue([] as never)
    await GET_dun(makeReq("/api/v1/dunning-attempts?status=failed", "GET"))
    const call = vi.mocked(prisma.dunningAttempt.findMany).mock.calls[0][0]!
    expect(call.where).toMatchObject({
      organizationId: ORG,
      failureReason: { not: null },
      succeededAt: null,
    })
  })

  it("rejects invalid status with 400", async () => {
    mockAuthOk()
    const res = await GET_dun(makeReq("/api/v1/dunning-attempts?status=stolen", "GET"))
    expect(res.status).toBe(400)
  })

  it("scopes by subscriptionId when provided", async () => {
    mockAuthOk()
    vi.mocked(prisma.dunningAttempt.findMany).mockResolvedValue([] as never)
    await GET_dun(makeReq("/api/v1/dunning-attempts?subscriptionId=sub-1", "GET"))
    const call = vi.mocked(prisma.dunningAttempt.findMany).mock.calls[0][0]!
    expect(call.where).toMatchObject({
      organizationId: ORG,
      subscriptionId: "sub-1",
    })
  })
})

/* ─── GET /api/v1/subscriptions (list) ────────────────────────────────── */

describe("GET /api/v1/subscriptions", () => {
  it("scopes findMany to org + applies status + planId filters", async () => {
    mockAuthOk()
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([] as never)
    await GET_sub(makeReq("/api/v1/subscriptions?status=active&planId=plan-1", "GET"))
    const call = vi.mocked(prisma.subscription.findMany).mock.calls[0][0]!
    expect(call.where).toMatchObject({
      organizationId: ORG,
      status: "active",
      planId: "plan-1",
    })
  })

  it("rejects unknown status with 400", async () => {
    mockAuthOk()
    const res = await GET_sub(makeReq("/api/v1/subscriptions?status=expired", "GET"))
    expect(res.status).toBe(400)
  })
})
