/**
 * E4 — daily send limit: settings parse, UTC-day count, status, settings API.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailLog: { count: vi.fn() },
    organization: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((v: unknown) => v instanceof Response),
}))

import {
  readDailyEmailLimit,
  utcDayStart,
  getDailyLimitStatus,
  countSequenceEmailsSentToday,
} from "@/lib/sequence-send-limit"
import { readSingleActiveEnrollment } from "@/lib/sequence-enrollment-policy"
import { canManageSequenceSettings } from "@/lib/sequence-settings-access"
import { GET as SETTINGS_GET, PATCH as SETTINGS_PATCH } from "@/app/api/v1/sequences/settings/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession } from "@/lib/api-auth"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1" as never)
  vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as never)
  vi.mocked(prisma.emailLog.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: {} } as never)
  vi.mocked(prisma.organization.update).mockResolvedValue({} as never)
})

describe("readDailyEmailLimit", () => {
  it("accepts a positive int, treats everything else as unlimited", () => {
    expect(readDailyEmailLimit({ sequenceDailyEmailLimit: 200 })).toBe(200)
    expect(readDailyEmailLimit({ sequenceDailyEmailLimit: 0 })).toBeNull()
    expect(readDailyEmailLimit({ sequenceDailyEmailLimit: -5 })).toBeNull()
    expect(readDailyEmailLimit({ sequenceDailyEmailLimit: 1.5 })).toBeNull()
    expect(readDailyEmailLimit({})).toBeNull()
    expect(readDailyEmailLimit(null)).toBeNull()
  })
})

describe("count / status", () => {
  it("counts only sent sequence emails since the UTC day start", async () => {
    vi.mocked(prisma.emailLog.count).mockResolvedValue(7 as never)
    const now = new Date("2026-07-18T15:30:00Z")
    const n = await countSequenceEmailsSentToday(prisma as never, "org-1", now)
    expect(n).toBe(7)
    const where = vi.mocked(prisma.emailLog.count).mock.calls[0][0]?.where
    expect(where).toMatchObject({ organizationId: "org-1", sequenceId: { not: null }, direction: "outbound" })
    expect(where?.status).toEqual({ in: expect.arrayContaining(["sent", "pending"]) })
    expect(where?.createdAt?.gte).toEqual(utcDayStart(now))
    expect(utcDayStart(now).toISOString()).toBe("2026-07-18T00:00:00.000Z")
  })

  it("unlimited when no limit set — no DB count issued", async () => {
    const s = await getDailyLimitStatus(prisma as never, "org-1", {})
    expect(s).toEqual({ limit: null, sentToday: 0, remaining: null, reached: false })
    expect(prisma.emailLog.count).not.toHaveBeenCalled()
  })

  it("reached=true when today's count is at/over the cap", async () => {
    vi.mocked(prisma.emailLog.count).mockResolvedValue(200 as never)
    const s = await getDailyLimitStatus(prisma as never, "org-1", { sequenceDailyEmailLimit: 200 })
    expect(s).toMatchObject({ limit: 200, sentToday: 200, remaining: 0, reached: true })
  })

  it("remaining shrinks; not reached below the cap", async () => {
    vi.mocked(prisma.emailLog.count).mockResolvedValue(120 as never)
    const s = await getDailyLimitStatus(prisma as never, "org-1", { sequenceDailyEmailLimit: 200 })
    expect(s).toMatchObject({ remaining: 80, reached: false })
  })
})

describe("settings API", () => {
  const req = (body?: unknown) =>
    new NextRequest("http://localhost/api/v1/sequences/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-organization-id": "org-1" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

  it("GET returns the status", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { sequenceDailyEmailLimit: 50 } } as never)
    vi.mocked(prisma.emailLog.count).mockResolvedValue(10 as never)
    const res = await SETTINGS_GET(new NextRequest("http://localhost/api/v1/sequences/settings", { headers: { "x-organization-id": "org-1" } }))
    const body = await res.json()
    expect(body.data).toMatchObject({ limit: 50, sentToday: 10, remaining: 40, reached: false })
  })

  it("PATCH sets a positive int", async () => {
    const res = await SETTINGS_PATCH(req({ dailyEmailLimit: 300 }))
    expect(res.status).toBe(200)
    const saved = vi.mocked(prisma.organization.update).mock.calls[0][0].data.settings as Record<string, unknown>
    expect(saved.sequenceDailyEmailLimit).toBe(300)
  })

  it("PATCH null clears the cap", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { sequenceDailyEmailLimit: 300 } } as never)
    const res = await SETTINGS_PATCH(req({ dailyEmailLimit: null }))
    expect(res.status).toBe(200)
    const saved = vi.mocked(prisma.organization.update).mock.calls[0][0].data.settings as Record<string, unknown>
    expect("sequenceDailyEmailLimit" in saved).toBe(false)
  })

  it("PATCH rejects a non-positive / non-integer value", async () => {
    expect((await SETTINGS_PATCH(req({ dailyEmailLimit: 0 }))).status).toBe(400)
    expect((await SETTINGS_PATCH(req({ dailyEmailLimit: 1.5 }))).status).toBe(400)
    expect((await SETTINGS_PATCH(req({ dailyEmailLimit: -3 }))).status).toBe(400)
  })

  it("PATCH forbidden for the read-only viewer role", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "viewer" } as never)
    const res = await SETTINGS_PATCH(req({ dailyEmailLimit: 100 }))
    expect(res.status).toBe(403)
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })

  it("PATCH allowed for a sales rep (widened gate)", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "sales" } as never)
    const res = await SETTINGS_PATCH(req({ singleActiveEnrollment: true }))
    expect(res.status).toBe(200)
    expect(prisma.organization.update).toHaveBeenCalled()
  })
})

describe("canManageSequenceSettings (gate)", () => {
  it("allows the sales floor, blocks viewers + unknowns", () => {
    for (const r of ["admin", "manager", "sales", "support"]) expect(canManageSequenceSettings(r)).toBe(true)
    for (const r of ["viewer", "member", "", null, undefined]) expect(canManageSequenceSettings(r as never)).toBe(false)
  })
})

describe("E6 single-active-enrollment policy", () => {
  it("readSingleActiveEnrollment is strict-true only", () => {
    expect(readSingleActiveEnrollment({ sequenceSingleActiveEnrollment: true })).toBe(true)
    expect(readSingleActiveEnrollment({ sequenceSingleActiveEnrollment: "true" })).toBe(false)
    expect(readSingleActiveEnrollment({ sequenceSingleActiveEnrollment: 1 })).toBe(false)
    expect(readSingleActiveEnrollment({})).toBe(false)
    expect(readSingleActiveEnrollment(null)).toBe(false)
  })

  it("GET exposes singleActiveEnrollment", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { sequenceSingleActiveEnrollment: true } } as never)
    const res = await SETTINGS_GET(new NextRequest("http://localhost/api/v1/sequences/settings", { headers: { "x-organization-id": "org-1" } }))
    expect((await res.json()).data.singleActiveEnrollment).toBe(true)
  })

  it("PATCH toggles the flag on and off", async () => {
    const on = await SETTINGS_PATCH(new NextRequest("http://localhost/api/v1/sequences/settings", {
      method: "PATCH", headers: { "content-type": "application/json", "x-organization-id": "org-1" },
      body: JSON.stringify({ singleActiveEnrollment: true }),
    }))
    expect(on.status).toBe(200)
    expect((vi.mocked(prisma.organization.update).mock.calls[0][0].data.settings as any).sequenceSingleActiveEnrollment).toBe(true)

    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { sequenceSingleActiveEnrollment: true } } as never)
    const off = await SETTINGS_PATCH(new NextRequest("http://localhost/api/v1/sequences/settings", {
      method: "PATCH", headers: { "content-type": "application/json", "x-organization-id": "org-1" },
      body: JSON.stringify({ singleActiveEnrollment: false }),
    }))
    expect(off.status).toBe(200)
    const saved = vi.mocked(prisma.organization.update).mock.calls.at(-1)![0].data.settings as any
    expect("sequenceSingleActiveEnrollment" in saved).toBe(false)
  })

  it("PATCH rejects a non-boolean flag", async () => {
    const res = await SETTINGS_PATCH(new NextRequest("http://localhost/api/v1/sequences/settings", {
      method: "PATCH", headers: { "content-type": "application/json", "x-organization-id": "org-1" },
      body: JSON.stringify({ singleActiveEnrollment: "yes" }),
    }))
    expect(res.status).toBe(400)
  })
})
