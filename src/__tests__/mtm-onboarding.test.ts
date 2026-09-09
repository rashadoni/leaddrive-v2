/**
 * Unit tests for GET + PUT /api/v1/mtm/onboarding (M4-4)
 *
 * Tracks per-agent onboarding progress through 5 key first-time actions.
 * The endpoint is called by the mobile app and web dashboard onboarding wizard.
 *
 * Acceptance criteria:
 *   AC-1: GET for a new agent (no DB row) returns 0% progress with all steps pending
 *   AC-2: PUT {step} creates/updates the onboarding row with step marked complete
 *   AC-3: PUT with all 5 steps → completedAt is set on the row
 *   AC-4: PUT with an already-completed step is idempotent (no duplicate)
 *   AC-5: GET returns correct pctDone = completedSteps.length / TOTAL_STEPS * 100
 *   AC-6: Unauthorized request (no orgId) returns 401
 *   AC-7: PUT with unknown step returns 400
 *
 * Strategy: mock prisma + getOrgId; import handler functions directly (not via
 * Next.js runtime) to keep tests fast and environment-agnostic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/mobile-auth", () => ({
  getMobileAuth: vi.fn(),
}))

import { GET, PUT } from "@/app/api/v1/mtm/onboarding/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { getMobileAuth } from "@/lib/mobile-auth"

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = "org-mars-1"
const AGENT_ID = "agent-rep-1"

/** All 5 onboarding steps */
const ALL_STEPS = ["profile_complete", "first_checkin", "first_photo", "first_task", "tutorial_video_watched"]

function makeRequest(method: "GET" | "PUT", body?: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/v1/mtm/onboarding`, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue(ORG_ID)
  vi.mocked(getMobileAuth).mockReturnValue({ agentId: AGENT_ID, orgId: ORG_ID } as never)
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: GET for new agent → 0% progress
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /mtm/onboarding — AC-1: new agent returns empty progress", () => {
  it("returns 0% pctDone and all steps pending for a new agent", async () => {
    vi.mocked(prisma.mtmOnboarding.findUnique).mockResolvedValue(null)

    const res = await GET(makeRequest("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.pctDone).toBe(0)
    expect(body.completedSteps).toEqual([])
    expect(body.totalSteps).toBe(5)
    expect(body.completedAt).toBeNull()
    // All steps are in pendingSteps
    expect(body.pendingSteps).toHaveLength(5)
    expect(body.pendingSteps).toEqual(expect.arrayContaining(ALL_STEPS))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-5: GET computes pctDone correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /mtm/onboarding — AC-5: pctDone = completedSteps/5 * 100", () => {
  it("returns 60% when 3 of 5 steps are complete", async () => {
    vi.mocked(prisma.mtmOnboarding.findUnique).mockResolvedValue({
      id: "onb-1",
      agentId: AGENT_ID,
      organizationId: ORG_ID,
      completedSteps: JSON.stringify(["profile_complete", "first_checkin", "first_photo"]),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const res = await GET(makeRequest("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.pctDone).toBe(60)
    expect(body.completedSteps).toHaveLength(3)
    expect(body.pendingSteps).toHaveLength(2)
  })

  it("returns 100% when all 5 steps complete", async () => {
    vi.mocked(prisma.mtmOnboarding.findUnique).mockResolvedValue({
      id: "onb-1",
      agentId: AGENT_ID,
      organizationId: ORG_ID,
      completedSteps: JSON.stringify(ALL_STEPS),
      completedAt: new Date("2026-05-24T10:00:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const res = await GET(makeRequest("GET"))
    const body = await res.json()

    expect(body.pctDone).toBe(100)
    expect(body.completedAt).toBeTruthy()
    expect(body.pendingSteps).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-6: Unauthorized
// ─────────────────────────────────────────────────────────────────────────────

describe("GET + PUT /mtm/onboarding — AC-6: 401 when not authorized", () => {
  it("GET returns 401 when getOrgId returns null", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET(makeRequest("GET"))
    expect(res.status).toBe(401)
  })

  it("PUT returns 401 when getOrgId returns null", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await PUT(makeRequest("PUT", { step: "first_photo" }))
    expect(res.status).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: PUT marks step complete
// ─────────────────────────────────────────────────────────────────────────────

describe("PUT /mtm/onboarding — AC-2: marks step complete", () => {
  it("upserts with the new step added to completedSteps", async () => {
    vi.mocked(prisma.mtmOnboarding.findUnique).mockResolvedValue(null) // no prior record
    vi.mocked(prisma.mtmOnboarding.upsert).mockResolvedValue({
      id: "onb-1",
      agentId: AGENT_ID,
      organizationId: ORG_ID,
      completedSteps: JSON.stringify(["first_photo"]),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const res = await PUT(makeRequest("PUT", { step: "first_photo" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.completedSteps).toContain("first_photo")
    // Confirm upsert was called
    expect(vi.mocked(prisma.mtmOnboarding.upsert)).toHaveBeenCalledOnce()
    const upsertCall = vi.mocked(prisma.mtmOnboarding.upsert).mock.calls[0][0] as {
      create: { completedSteps: string }
    }
    expect(JSON.parse(upsertCall.create.completedSteps)).toContain("first_photo")
  })

  it("returns updated progress including pctDone", async () => {
    vi.mocked(prisma.mtmOnboarding.findUnique).mockResolvedValue({
      id: "onb-1",
      agentId: AGENT_ID,
      organizationId: ORG_ID,
      completedSteps: JSON.stringify(["profile_complete", "first_checkin"]),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    vi.mocked(prisma.mtmOnboarding.upsert).mockResolvedValue({
      id: "onb-1",
      agentId: AGENT_ID,
      organizationId: ORG_ID,
      completedSteps: JSON.stringify(["profile_complete", "first_checkin", "first_photo"]),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const res = await PUT(makeRequest("PUT", { step: "first_photo" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.pctDone).toBe(60)
    expect(body.completedSteps).toHaveLength(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: All 5 steps → completedAt set
// ─────────────────────────────────────────────────────────────────────────────

describe("PUT /mtm/onboarding — AC-3: completedAt set when all steps done", () => {
  it("upserts with completedAt when the last step is marked", async () => {
    const fourDone = ALL_STEPS.slice(0, 4)
    vi.mocked(prisma.mtmOnboarding.findUnique).mockResolvedValue({
      id: "onb-1",
      agentId: AGENT_ID,
      organizationId: ORG_ID,
      completedSteps: JSON.stringify(fourDone),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const allDone = [...fourDone, "tutorial_video_watched"]
    vi.mocked(prisma.mtmOnboarding.upsert).mockResolvedValue({
      id: "onb-1",
      agentId: AGENT_ID,
      organizationId: ORG_ID,
      completedSteps: JSON.stringify(allDone),
      completedAt: new Date("2026-05-24T12:00:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const res = await PUT(makeRequest("PUT", { step: "tutorial_video_watched" }))
    const body = await res.json()

    expect(body.pctDone).toBe(100)
    expect(body.completedAt).toBeTruthy()

    // Confirm upsert was called with completedAt set (not null)
    const upsertCall = vi.mocked(prisma.mtmOnboarding.upsert).mock.calls[0][0] as {
      update: { completedAt: Date | null }
    }
    expect(upsertCall.update.completedAt).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: Already-completed step is idempotent
// ─────────────────────────────────────────────────────────────────────────────

describe("PUT /mtm/onboarding — AC-4: idempotent re-completion", () => {
  it("does not duplicate step when already in completedSteps", async () => {
    vi.mocked(prisma.mtmOnboarding.findUnique).mockResolvedValue({
      id: "onb-1",
      agentId: AGENT_ID,
      organizationId: ORG_ID,
      completedSteps: JSON.stringify(["first_photo"]),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    vi.mocked(prisma.mtmOnboarding.upsert).mockResolvedValue({
      id: "onb-1",
      agentId: AGENT_ID,
      organizationId: ORG_ID,
      completedSteps: JSON.stringify(["first_photo"]), // still only one
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    await PUT(makeRequest("PUT", { step: "first_photo" }))

    const upsertCall = vi.mocked(prisma.mtmOnboarding.upsert).mock.calls[0][0] as {
      create: { completedSteps: string }
    }
    const steps = JSON.parse(upsertCall.create.completedSteps) as string[]
    // Must have exactly one "first_photo", not two
    expect(steps.filter(s => s === "first_photo")).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-7: Unknown step → 400
// ─────────────────────────────────────────────────────────────────────────────

describe("PUT /mtm/onboarding — AC-7: unknown step returns 400", () => {
  it("returns 400 for unrecognized step name", async () => {
    const res = await PUT(makeRequest("PUT", { step: "hack_the_planet" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("step")
  })

  it("returns 400 when step param is missing", async () => {
    const res = await PUT(makeRequest("PUT", {}))
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Non-agent user (supervisor/admin) — GET returns { applicable: false }, PUT 403
// ─────────────────────────────────────────────────────────────────────────────

describe("GET + PUT /mtm/onboarding — non-agent user (supervisor/admin)", () => {
  beforeEach(() => {
    // Supervisor tokens have no agentId — getMobileAuth returns null
    vi.mocked(getMobileAuth).mockReturnValue(null as never)
  })

  it("GET returns { applicable: false } and does NOT query the DB", async () => {
    const res = await GET(makeRequest("GET"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.applicable).toBe(false)
    // Wizard is hidden — no DB round-trip needed
    expect(vi.mocked(prisma.mtmOnboarding.findUnique)).not.toHaveBeenCalled()
  })

  it("PUT returns 403 because onboarding is agent-only", async () => {
    const res = await PUT(makeRequest("PUT", { step: "first_photo" }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Resilience: corrupted completedSteps JSON in DB row
// ─────────────────────────────────────────────────────────────────────────────

describe("PUT /mtm/onboarding — resilience: corrupted completedSteps", () => {
  it("treats a non-JSON completedSteps as empty array and proceeds without 500", async () => {
    vi.mocked(prisma.mtmOnboarding.findUnique).mockResolvedValue({
      id: "onb-corrupt",
      agentId: AGENT_ID,
      organizationId: ORG_ID,
      completedSteps: "not-valid-json",   // simulates corruption
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    vi.mocked(prisma.mtmOnboarding.upsert).mockResolvedValue({
      id: "onb-corrupt",
      agentId: AGENT_ID,
      organizationId: ORG_ID,
      completedSteps: JSON.stringify(["first_photo"]),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const res = await PUT(makeRequest("PUT", { step: "first_photo" }))

    // Must recover gracefully — not 500
    expect(res.status).toBe(200)
    // upsert was still called, treating the step as the first one
    expect(vi.mocked(prisma.mtmOnboarding.upsert)).toHaveBeenCalledOnce()
    const upsertCall = vi.mocked(prisma.mtmOnboarding.upsert).mock.calls[0][0] as {
      create: { completedSteps: string }
    }
    expect(JSON.parse(upsertCall.create.completedSteps)).toContain("first_photo")
  })
})
