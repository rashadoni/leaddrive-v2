/**
 * CLM Slice 5b-2 — Revenue recognition cron tests
 *
 * Route under test: POST /api/cron/revenue-recognition
 *
 * Coverage:
 *   - Posts entry for due scheduled line (calculateRecognition > 0 → entry + status update)
 *   - Idempotent (CAS miss / postNow 0 → no entry, no double-post)
 *   - CRON_SECRET: 401 on wrong secret; 503 when unset
 *   - Org-scoped (schedule.organizationId carried through)
 *   - PO → completed when ALL schedules recognized
 *   - over_time_straight_line: posts remainder for fully-elapsed period
 *   - point_in_time: all-at-periodEnd semantics
 *   - NO float: all amounts through decimalToMinor / minorToDecimalString
 *   - Returns { posted, skipped, errors, timestamp }
 *   - FIX 1: FOR UPDATE lock runs first in per-line tx (serializes against recalc)
 *   - FIX 2: status-repair when postNow=0 but suggestedStatus ≠ current (stale partially_recognized)
 *   - FIX 3: PO transitions scheduled→in_progress on first recognition (not only when all done)
 *
 * Pure helpers (calculateRecognition, decimalToMinor, canPoTransition, canScheduleTransition)
 * run against real logic — only prisma is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// ─── Mocks ───────────────────────────────────────────────────────────────────
// NOTE: vi.mock factories are hoisted — internal mock fns MUST be declared
// inside the factory (not as top-level consts that aren't yet initialized).

vi.mock("@/lib/prisma", () => {
  const updateManySched = vi.fn()
  const createEntry     = vi.fn()
  const findSiblings    = vi.fn()
  const updateManyPo    = vi.fn()
  const findMany        = vi.fn()
  const queryRaw        = vi.fn().mockResolvedValue([]) // FOR UPDATE lock — no-op in tests

  const transaction     = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    const tx = {
      $queryRaw:                   queryRaw,
      revenueRecognitionSchedule: {
        updateMany: updateManySched,
        findMany:   findSiblings,
      },
      revenueRecognitionEntry: {
        create: createEntry,
      },
      performanceObligation: {
        updateMany: updateManyPo,
      },
    }
    return cb(tx)
  })

  return {
    prisma: {
      revenueRecognitionSchedule: { findMany },
      $transaction: transaction,
      // Expose the internal fns under a test-access key.
      _test: { updateManySched, createEntry, findSiblings, updateManyPo, findMany, transaction, queryRaw },
    },
  }
})

// Import the route AFTER the mock is declared.
import { POST } from "@/app/api/cron/revenue-recognition/route"
import { prisma } from "@/lib/prisma"

// Helper to access the internal mock fns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = () => (prisma as any)._test as {
  updateManySched: ReturnType<typeof vi.fn>
  createEntry:     ReturnType<typeof vi.fn>
  findSiblings:    ReturnType<typeof vi.fn>
  updateManyPo:    ReturnType<typeof vi.fn>
  findMany:        ReturnType<typeof vi.fn>
  transaction:     ReturnType<typeof vi.fn>
  queryRaw:        ReturnType<typeof vi.fn>
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG         = "org-abc"
const CTR_ID      = "ctr-1"      // contractId — needed for FOR UPDATE lock
const CRON_SECRET = "super-secret-cron"
const PO_ID       = "po-1"
const SCHED_ID    = "sched-1"

// A completed period: January 2026 — well before our "now" of 2026-06-01.
const JAN_START = new Date("2026-01-01T00:00:00.000Z")
const JAN_END   = new Date("2026-01-31T23:59:59.000Z")

function makeDecimalLike(s: string) {
  return { toString: () => s }
}

function makeSchedule(overrides: Partial<{
  id:                      string
  organizationId:          string
  performanceObligationId: string
  lineNumber:              number
  periodStart:             Date
  periodEnd:               Date
  scheduledAmount:         ReturnType<typeof makeDecimalLike>
  currency:                string
  status:                  string
  entries:                 { recognizedAmount: ReturnType<typeof makeDecimalLike> }[]
  performanceObligation:   Record<string, unknown> | null
}> = {}) {
  return {
    id:                      SCHED_ID,
    organizationId:          ORG,
    performanceObligationId: PO_ID,
    lineNumber:              1,
    periodStart:             JAN_START,
    periodEnd:               JAN_END,
    scheduledAmount:         makeDecimalLike("1000.00"),   // $1000 → 100000 cents
    currency:                "USD",
    status:                  "scheduled",
    entries:                 [],
    performanceObligation: {
      id:                PO_ID,
      organizationId:    ORG,
      contractId:        CTR_ID,
      status:            "scheduled",
      recognitionMethod: "point_in_time",
      schedules:         [{ id: SCHED_ID, status: "scheduled" }],
    },
    ...overrides,
  }
}

function makeRequest(secret: string | null = CRON_SECRET): NextRequest {
  const headers: Record<string, string> = {}
  if (secret !== null) headers["x-cron-secret"] = secret
  return new NextRequest("http://localhost/api/cron/revenue-recognition", {
    method:  "POST",
    headers,
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/cron/revenue-recognition", () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET

    // Default happy-path defaults.
    m().updateManySched.mockResolvedValue({ count: 1 })
    m().createEntry.mockResolvedValue({ id: "entry-1" })
    m().findSiblings.mockResolvedValue([{ id: SCHED_ID, status: "recognized" }])
    m().updateManyPo.mockResolvedValue({ count: 1 })
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
  })

  // ── Auth ─────────────────────────────────────────────────────────────────

  it("returns 503 when CRON_SECRET not configured", async () => {
    delete process.env.CRON_SECRET
    m().findMany.mockResolvedValue([])
    const res = await POST(makeRequest("anything"))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toMatch(/not configured/i)
  })

  it("returns 401 on wrong secret", async () => {
    m().findMany.mockResolvedValue([])
    const res = await POST(makeRequest("wrong-secret"))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it("returns 401 when no secret header provided", async () => {
    m().findMany.mockResolvedValue([])
    const res = await POST(makeRequest(null))
    expect(res.status).toBe(401)
  })

  // ── Basic posting ────────────────────────────────────────────────────────

  it("posts entry for a due point_in_time scheduled line", async () => {
    const sched = makeSchedule({ status: "scheduled" })
    m().findMany.mockResolvedValue([sched])

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.posted).toBe(1)
    expect(body.data.skipped).toBe(0)
    expect(body.data.errors).toBe(0)

    // CAS update: schedule status → recognized
    expect(m().updateManySched).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: SCHED_ID, status: "scheduled" }),
        data:  expect.objectContaining({ status: "recognized" }),
      })
    )

    // Entry created with correct amount string (no float)
    expect(m().createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recognizedAmount: "1000.00",   // minorToDecimalString(100000, "USD") = "1000.00"
          currency:         "USD",
          postedBy:         "cron",
        }),
      })
    )
  })

  it("recognizedAmount is a decimal string (not a raw JS Number, no float)", async () => {
    const sched = makeSchedule({ scheduledAmount: makeDecimalLike("999.99") })
    m().findMany.mockResolvedValue([sched])
    await POST(makeRequest())
    const call = m().createEntry.mock.calls[0]?.[0]
    expect(typeof call?.data?.recognizedAmount).toBe("string")
    // Must match a decimal pattern — never a float-rendered value.
    expect(call.data.recognizedAmount).toMatch(/^\d+\.\d+$/)
    expect(call.data.recognizedAmount).toBe("999.99")
  })

  // ── Idempotent / CAS miss ────────────────────────────────────────────────

  it("skips (no double-post) when CAS updateMany returns count=0", async () => {
    const sched = makeSchedule()
    m().findMany.mockResolvedValue([sched])
    // Simulate another runner won the CAS race.
    m().updateManySched.mockResolvedValue({ count: 0 })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.posted).toBe(0)
    expect(body.data.skipped).toBe(1)
    // No entry was created.
    expect(m().createEntry).not.toHaveBeenCalled()
  })

  it("skips (pure skip) when postNow=0 AND status already correct (no stale repair needed)", async () => {
    // postedToDate = scheduledAmount → postNow = 0, suggestedStatus = "recognized".
    // Status is already "recognized" → no stale repair needed → pure skip.
    const sched = makeSchedule({
      scheduledAmount: makeDecimalLike("500.00"),
      entries: [{ recognizedAmount: makeDecimalLike("500.00") }],
      status: "recognized", // already in the right terminal state
    })
    m().findMany.mockResolvedValue([sched])

    const res = await POST(makeRequest())
    const body = await res.json()
    // postNow=0 AND status already "recognized" → pure skip, no CAS, no entry.
    expect(body.data.posted).toBe(0)
    expect(body.data.skipped).toBe(1)
    expect(m().updateManySched).not.toHaveBeenCalled()
    expect(m().createEntry).not.toHaveBeenCalled()
  })

  it("skips when schedule has no performanceObligation attached", async () => {
    const sched = makeSchedule({ performanceObligation: null })
    m().findMany.mockResolvedValue([sched])
    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body.data.skipped).toBe(1)
    expect(m().createEntry).not.toHaveBeenCalled()
  })

  // ── PO → completed when all schedules recognized ─────────────────────────

  it("transitions PO scheduled→in_progress→completed when all siblings recognized", async () => {
    const sched = makeSchedule({
      performanceObligation: {
        id:                PO_ID,
        organizationId:    ORG,
        contractId:        CTR_ID,
        status:            "scheduled",
        recognitionMethod: "point_in_time",
        schedules:         [{ id: SCHED_ID, status: "scheduled" }],
      },
    })
    m().findMany.mockResolvedValue([sched])
    m().findSiblings.mockResolvedValue([{ id: SCHED_ID, status: "recognized" }])

    await POST(makeRequest())

    // First PO transition: scheduled → in_progress
    expect(m().updateManyPo).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "scheduled" }),
        data:  expect.objectContaining({ status: "in_progress" }),
      })
    )
    // Second PO transition: in_progress → completed
    expect(m().updateManyPo).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "in_progress" }),
        data:  expect.objectContaining({ status: "completed" }),
      })
    )
  })

  it("transitions PO to in_progress but NOT completed when some siblings are not yet recognized", async () => {
    const sched = makeSchedule()
    m().findMany.mockResolvedValue([sched])
    // Second sibling still scheduled.
    m().findSiblings.mockResolvedValue([
      { id: SCHED_ID,  status: "recognized" },
      { id: "sched-2", status: "scheduled" },
    ])

    await POST(makeRequest())

    // FIX 3: PO should move to in_progress (first recognition)
    expect(m().updateManyPo).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "scheduled" }),
        data:  expect.objectContaining({ status: "in_progress" }),
      })
    )

    // Should NOT see a "completed" transition (second sibling still pending).
    const completedCall = m().updateManyPo.mock.calls.find(
      (c: unknown[]) => ((c[0] as { data?: { status?: string } }).data?.status) === "completed"
    )
    expect(completedCall).toBeUndefined()
  })

  // ── over_time_straight_line: posts remainder for fully-elapsed period ──

  it("over_time_straight_line: posts remainder when period fully elapsed with partial prior post", async () => {
    // Period fully elapsed (2025-01-01 → 2025-12-31); $1200 scheduled, $600 already posted.
    const start = new Date("2025-01-01T00:00:00.000Z")
    const end   = new Date("2025-12-31T23:59:59.000Z")

    const sched = makeSchedule({
      periodStart:       start,
      periodEnd:         end,
      scheduledAmount:   makeDecimalLike("1200.00"),   // 120000 minor
      entries:           [{ recognizedAmount: makeDecimalLike("600.00") }],   // 60000 already posted
      status:            "partially_recognized",
      performanceObligation: {
        id:                PO_ID,
        organizationId:    ORG,
        contractId:        CTR_ID,
        status:            "in_progress",
        recognitionMethod: "over_time_straight_line",
        schedules:         [{ id: SCHED_ID, status: "partially_recognized" }],
      },
    })
    m().findMany.mockResolvedValue([sched])
    m().findSiblings.mockResolvedValue([{ id: SCHED_ID, status: "recognized" }])

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.posted).toBe(1)

    // remainder = 1200.00 - 600.00 = 600.00 (period fully elapsed → full scheduled target)
    const entryCall = m().createEntry.mock.calls[0]?.[0]
    expect(entryCall.data.recognizedAmount).toBe("600.00")
  })

  // ── Multi-org ────────────────────────────────────────────────────────────

  it("processes schedules from multiple orgs independently", async () => {
    const po2 = { id: "po-b", organizationId: "org-b", contractId: "ctr-b", status: "scheduled", recognitionMethod: "point_in_time", schedules: [{ id: "s2", status: "scheduled" }] }
    const sched1 = makeSchedule({ id: "s1", organizationId: "org-a", performanceObligationId: "po-a",
      performanceObligation: { id: "po-a", organizationId: "org-a", contractId: "ctr-a", status: "scheduled", recognitionMethod: "point_in_time", schedules: [{ id: "s1", status: "scheduled" }] },
    })
    const sched2 = makeSchedule({ id: "s2", organizationId: "org-b", performanceObligationId: "po-b",
      performanceObligation: po2,
    })
    m().findMany.mockResolvedValue([sched1, sched2])
    m().findSiblings
      .mockResolvedValueOnce([{ id: "s1", status: "recognized" }])
      .mockResolvedValueOnce([{ id: "s2", status: "recognized" }])

    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body.data.posted).toBe(2)
    expect(m().createEntry).toHaveBeenCalledTimes(2)
  })

  // ── Empty batch ──────────────────────────────────────────────────────────

  it("returns posted=0 skipped=0 when no due lines", async () => {
    m().findMany.mockResolvedValue([])
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.posted).toBe(0)
    expect(body.data.skipped).toBe(0)
    expect(body.data.errors).toBe(0)
    expect(body.data.timestamp).toBeDefined()
    expect(m().createEntry).not.toHaveBeenCalled()
  })

  // ── Error counter ────────────────────────────────────────────────────────

  it("increments errors counter and continues processing remaining lines on per-line exception", async () => {
    const sched1 = makeSchedule({ id: "s1" })
    const sched2 = makeSchedule({ id: "s2" })
    m().findMany.mockResolvedValue([sched1, sched2])

    // Use mockImplementationOnce to throw only for the first line — factory handles the rest.
    m().transaction.mockImplementationOnce(async (_cb: (tx: unknown) => Promise<void>) => {
      throw new Error("DB transient error")
    })


    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    // First line errored; second succeeded.
    expect(body.data.errors).toBe(1)
    expect(body.data.posted).toBe(1)
  })

  // ── point_in_time before periodEnd ───────────────────────────────────────

  it("point_in_time: skips when periodEnd is in the future (postNow=0 from calculator)", async () => {
    // Create a schedule with a future periodEnd — even though the query normally
    // would filter these out (periodEnd > now), we test that the calculator correctly
    // returns 0 for such a line if it somehow appears.
    const futureEnd   = new Date("2026-12-31T23:59:59.000Z")
    const futureStart = new Date("2026-06-01T00:00:00.000Z")

    const sched = makeSchedule({
      periodStart: futureStart,
      periodEnd:   futureEnd,
      status:      "scheduled",
    })
    m().findMany.mockResolvedValue([sched])

    const res = await POST(makeRequest())
    const body = await res.json()
    // calculateRecognition with asOf < periodEnd → postNow=0 → skipped.
    expect(body.data.posted).toBe(0)
    expect(body.data.skipped).toBe(1)
    expect(m().createEntry).not.toHaveBeenCalled()
  })

  // ── FIX 1: FOR UPDATE lock runs first in per-line tx ─────────────────────

  it("FIX 1: $queryRaw FOR UPDATE is the FIRST call in the per-line $transaction", async () => {
    const sched = makeSchedule({ status: "scheduled" })
    m().findMany.mockResolvedValue([sched])

    const callOrder: string[] = []

    m().transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw: (..._args: unknown[]) => {
          callOrder.push("$queryRaw")
          return Promise.resolve([])
        },
        revenueRecognitionSchedule: {
          updateMany: (..._args: unknown[]) => {
            callOrder.push("updateMany")
            return Promise.resolve({ count: 1 })
          },
          findMany: (..._args: unknown[]) => {
            callOrder.push("findMany")
            return Promise.resolve([{ id: SCHED_ID, status: "recognized" }])
          },
        },
        revenueRecognitionEntry: {
          create: (..._args: unknown[]) => {
            callOrder.push("create")
            return Promise.resolve({ id: "entry-1" })
          },
        },
        performanceObligation: {
          updateMany: (..._args: unknown[]) => {
            callOrder.push("po-updateMany")
            return Promise.resolve({ count: 1 })
          },
        },
      }
      return cb(tx)
    })

    await POST(makeRequest())
    // FOR UPDATE must be the very first call inside the tx
    expect(callOrder[0]).toBe("$queryRaw")
  })

  it("FIX 1: FOR UPDATE lock includes the contractId from the PO", async () => {
    const sched = makeSchedule({ status: "scheduled" })
    m().findMany.mockResolvedValue([sched])

    const rawCalls: unknown[][] = []

    m().transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw: (...args: unknown[]) => {
          rawCalls.push(args)
          return Promise.resolve([])
        },
        revenueRecognitionSchedule: {
          updateMany: () => Promise.resolve({ count: 1 }),
          findMany:   () => Promise.resolve([{ id: SCHED_ID, status: "recognized" }]),
        },
        revenueRecognitionEntry: { create: () => Promise.resolve({ id: "e-1" }) },
        performanceObligation: { updateMany: () => Promise.resolve({ count: 1 }) },
      }
      return cb(tx)
    })

    await POST(makeRequest())

    // Tagged-template: args[0] is TemplateStringsArray; args[1..] are interpolated values.
    expect(rawCalls.length).toBeGreaterThan(0)
    const paramValues = rawCalls[0].slice(1)
    expect(paramValues).toContain(CTR_ID)
  })

  // ── FIX 2: cron status-repair when postNow=0 but status stale ─────────────

  it("FIX 2: repairs stale partially_recognized → recognized when postNow=0 (fully posted line)", async () => {
    // postedToDate = scheduledAmount → postNow = 0, suggestedStatus = "recognized".
    // Status is "partially_recognized" (stale) → FIX 2 must repair it via CAS.
    const sched = makeSchedule({
      scheduledAmount: makeDecimalLike("500.00"),
      entries: [{ recognizedAmount: makeDecimalLike("500.00") }],
      status: "partially_recognized", // stale — should be "recognized"
    })
    m().findMany.mockResolvedValue([sched])

    // Track calls via explicit spies in a custom tx implementation
    const updateManySchedSpy = vi.fn().mockResolvedValue({ count: 1 })
    const findSiblingsSpy    = vi.fn().mockResolvedValue([{ id: SCHED_ID, status: "recognized" }])
    const updateManyPoSpy    = vi.fn().mockResolvedValue({ count: 1 })
    const createEntrySpy     = vi.fn()

    m().transaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw:                   vi.fn().mockResolvedValue([]),
        revenueRecognitionSchedule: {
          updateMany: updateManySchedSpy,
          findMany:   findSiblingsSpy,
        },
        revenueRecognitionEntry: { create: createEntrySpy },
        performanceObligation:   { updateMany: updateManyPoSpy },
      }
      return cb(tx)
    })

    const res = await POST(makeRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    // Line was repaired, counts as posted (status changed)
    expect(body.data.posted).toBe(1)
    expect(body.data.skipped).toBe(0)

    // CAS updateMany: partially_recognized → recognized with recognizedAt set
    expect(updateManySchedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: SCHED_ID, status: "partially_recognized" }),
        data:  expect.objectContaining({ status: "recognized", recognizedAt: expect.any(Date) }),
      })
    )
    // No new entry should be created (status-only repair, no new money)
    expect(createEntrySpy).not.toHaveBeenCalled()
  })

  it("FIX 2: skips (pure skip) when postNow=0 AND status is already correct (recognized)", async () => {
    // postedToDate = scheduledAmount → postNow = 0, suggestedStatus = "recognized".
    // Status already "recognized" (terminal) → suggestedStatus === currentStatus → pure skip.
    const sched = makeSchedule({
      scheduledAmount: makeDecimalLike("500.00"),
      entries: [{ recognizedAmount: makeDecimalLike("500.00") }],
      status: "recognized", // already correct
    })
    m().findMany.mockResolvedValue([sched])

    const res = await POST(makeRequest())
    const body = await res.json()
    expect(body.data.skipped).toBe(1)
    expect(body.data.posted).toBe(0)
    expect(m().updateManySched).not.toHaveBeenCalled()
    expect(m().createEntry).not.toHaveBeenCalled()
  })

  // ── FIX 3: PO transitions to in_progress on FIRST recognition ─────────────

  it("FIX 3: PO moves scheduled→in_progress after first recognition even when 2nd sibling not done", async () => {
    // 2-line PO: first line recognized, second still scheduled → PO must go in_progress
    const PO_ID_2 = "po-2line"
    const sched = makeSchedule({
      performanceObligation: {
        id:                PO_ID_2,
        organizationId:    ORG,
        contractId:        CTR_ID,
        status:            "scheduled", // not yet in_progress
        recognitionMethod: "point_in_time",
        schedules: [
          { id: SCHED_ID,  status: "scheduled" },
          { id: "sched-2", status: "scheduled" },
        ],
      },
    })
    m().findMany.mockResolvedValue([sched])

    const updateManyPoSpy    = vi.fn().mockResolvedValue({ count: 1 })
    const updateManySchedSpy = vi.fn().mockResolvedValue({ count: 1 })
    // After posting: first line recognized, second still scheduled (not all terminal)
    const findSiblingsSpy = vi.fn().mockResolvedValue([
      { id: SCHED_ID,  status: "recognized" },
      { id: "sched-2", status: "scheduled" },
    ])

    m().transaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw:                   vi.fn().mockResolvedValue([]),
        revenueRecognitionSchedule: { updateMany: updateManySchedSpy, findMany: findSiblingsSpy },
        revenueRecognitionEntry:    { create: vi.fn().mockResolvedValue({ id: "e-1" }) },
        performanceObligation:      { updateMany: updateManyPoSpy },
      }
      return cb(tx)
    })

    await POST(makeRequest())

    // Must see scheduled → in_progress transition
    expect(updateManyPoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: PO_ID_2, status: "scheduled" }),
        data:  expect.objectContaining({ status: "in_progress" }),
      })
    )

    // Must NOT see in_progress → completed (second sibling still scheduled)
    const completedCall = updateManyPoSpy.mock.calls.find(
      (c: unknown[]) => ((c[0] as { data?: { status?: string } }).data?.status) === "completed"
    )
    expect(completedCall).toBeUndefined()
  })

  it("FIX 3: PO moves scheduled→in_progress→completed when ALL siblings recognized in one shot", async () => {
    // Single-line PO: the only line gets recognized → PO goes in_progress then completed
    const sched = makeSchedule({
      performanceObligation: {
        id:                PO_ID,
        organizationId:    ORG,
        contractId:        CTR_ID,
        status:            "scheduled",
        recognitionMethod: "point_in_time",
        schedules:         [{ id: SCHED_ID, status: "scheduled" }],
      },
    })
    m().findMany.mockResolvedValue([sched])

    const updateManyPoSpy    = vi.fn().mockResolvedValue({ count: 1 })
    const updateManySchedSpy = vi.fn().mockResolvedValue({ count: 1 })
    const findSiblingsSpy    = vi.fn().mockResolvedValue([{ id: SCHED_ID, status: "recognized" }])

    m().transaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw:                   vi.fn().mockResolvedValue([]),
        revenueRecognitionSchedule: { updateMany: updateManySchedSpy, findMany: findSiblingsSpy },
        revenueRecognitionEntry:    { create: vi.fn().mockResolvedValue({ id: "e-1" }) },
        performanceObligation:      { updateMany: updateManyPoSpy },
      }
      return cb(tx)
    })

    await POST(makeRequest())

    // scheduled → in_progress
    expect(updateManyPoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "scheduled" }),
        data:  expect.objectContaining({ status: "in_progress" }),
      })
    )
    // in_progress → completed
    expect(updateManyPoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "in_progress" }),
        data:  expect.objectContaining({ status: "completed" }),
      })
    )
  })
})
