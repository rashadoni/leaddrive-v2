import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn() },
    slaPolicy: { findFirst: vi.fn() },
  },
}))

import { resolveTicketSla, normalizeTicketPriority } from "@/lib/sla-resolver"
import { prisma } from "@/lib/prisma"

const companyFindFirst = prisma.company.findFirst as unknown as ReturnType<typeof vi.fn>
const slaPolicyFindFirst = prisma.slaPolicy.findFirst as unknown as ReturnType<typeof vi.fn>

const NOW = 1_700_000_000_000 // fixed anchor so due-date math is deterministic
const HOUR = 3600000

beforeEach(() => {
  vi.clearAllMocks()
})

describe("resolveTicketSla", () => {
  it("uses the company-assigned policy and does NOT fall through to priority", async () => {
    companyFindFirst.mockResolvedValue({
      slaPolicy: { id: "p1", name: "VIP", resolutionHours: 4, firstResponseHours: 1 },
    })

    const sla = await resolveTicketSla("org1", { companyId: "c1", priority: "low", now: NOW })

    expect(sla.slaPolicyName).toBe("VIP")
    expect(sla.slaDueAt).toEqual(new Date(NOW + 4 * HOUR))
    expect(sla.slaFirstResponseDueAt).toEqual(new Date(NOW + 1 * HOUR))
    // company policy won → priority lookup must be skipped entirely
    expect(slaPolicyFindFirst).not.toHaveBeenCalled()
  })

  it("falls back to a priority-based policy when the company has none", async () => {
    companyFindFirst.mockResolvedValue({ slaPolicy: null })
    slaPolicyFindFirst.mockResolvedValue({
      id: "p2", name: "High SLA", resolutionHours: 8, firstResponseHours: 2,
    })

    const sla = await resolveTicketSla("org1", { companyId: "c1", priority: "high", now: NOW })

    expect(slaPolicyFindFirst).toHaveBeenCalledWith({
      where: { organizationId: "org1", priority: "high", isActive: true },
    })
    expect(sla.slaPolicyName).toBe("High SLA")
    expect(sla.slaDueAt).toEqual(new Date(NOW + 8 * HOUR))
  })

  it("skips the company lookup when no companyId is given", async () => {
    slaPolicyFindFirst.mockResolvedValue({
      id: "p3", name: "Medium SLA", resolutionHours: 24, firstResponseHours: 4,
    })

    const sla = await resolveTicketSla("org1", { priority: "medium", now: NOW })

    expect(companyFindFirst).not.toHaveBeenCalled()
    expect(sla.slaPolicyName).toBe("Medium SLA")
  })

  it("normalizes a non-tier priority ('normal') and an absent priority to 'medium'", async () => {
    slaPolicyFindFirst.mockResolvedValue(null)

    await resolveTicketSla("org1", { priority: "normal" })
    expect(slaPolicyFindFirst).toHaveBeenCalledWith({
      where: { organizationId: "org1", priority: "medium", isActive: true },
    })

    await resolveTicketSla("org1", {})
    expect(slaPolicyFindFirst).toHaveBeenLastCalledWith({
      where: { organizationId: "org1", priority: "medium", isActive: true },
    })
  })

  it("returns an empty object (no SLA fields) when no policy matches", async () => {
    companyFindFirst.mockResolvedValue(null)
    slaPolicyFindFirst.mockResolvedValue(null)

    const sla = await resolveTicketSla("org1", { companyId: "c1", priority: "high", now: NOW })

    expect(sla).toEqual({})
    expect(sla.slaDueAt).toBeUndefined()
  })
})

describe("normalizeTicketPriority", () => {
  it("passes through the four valid tiers (case-insensitively)", () => {
    expect(normalizeTicketPriority("low")).toBe("low")
    expect(normalizeTicketPriority("medium")).toBe("medium")
    expect(normalizeTicketPriority("high")).toBe("high")
    expect(normalizeTicketPriority("critical")).toBe("critical")
    expect(normalizeTicketPriority("HIGH")).toBe("high")
  })

  it("coerces 'normal', unknown strings, empty and null to 'medium'", () => {
    expect(normalizeTicketPriority("normal")).toBe("medium")
    expect(normalizeTicketPriority("urgent")).toBe("medium")
    expect(normalizeTicketPriority("")).toBe("medium")
    expect(normalizeTicketPriority(null)).toBe("medium")
    expect(normalizeTicketPriority(undefined)).toBe("medium")
  })
})
