import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findFirst: vi.fn() } },
}))

import { matchInboundLeadId } from "@/lib/inbound-lead-match"
import { prisma } from "@/lib/prisma"

const ff = () => vi.mocked(prisma.lead.findFirst)

describe("matchInboundLeadId (two-tier)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ff().mockResolvedValue(null as any)
  })

  it("returns undefined when neither phone nor email given (no DB call)", async () => {
    const r = await matchInboundLeadId("org-1", {})
    expect(r).toBeUndefined()
    expect(ff()).not.toHaveBeenCalled()
  })

  it("Tier 1: an indexed EXACT match returns immediately (no fuzzy Tier 2 query)", async () => {
    ff().mockResolvedValueOnce({ id: "lead-5" } as any)
    const r = await matchInboundLeadId("org-1", { phone: "+994501112233" })
    expect(r).toBe("lead-5")
    expect(ff()).toHaveBeenCalledTimes(1) // Tier 2 skipped
    const where = ff().mock.calls[0][0]!.where as any
    expect(where.organizationId).toBe("org-1")
    // Tier 1 OR is exact-only (no substring `contains`) so it can use the index
    expect(JSON.stringify(where.OR)).not.toContain("contains")
    expect(where.OR.some((c: any) => c.phoneWhatsApp)).toBe(true)
  })

  it("Tier 2: when exact misses, falls back to a fuzzy last-9 `contains` query", async () => {
    ff().mockResolvedValueOnce(null as any).mockResolvedValueOnce({ id: "lead-7" } as any)
    const r = await matchInboundLeadId("org-1", { phone: "+994 50 111 22 33" })
    expect(r).toBe("lead-7")
    expect(ff()).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(ff().mock.calls[0][0]!.where)).not.toContain("contains") // Tier 1 exact
    expect(JSON.stringify(ff().mock.calls[1][0]!.where)).toContain("contains")     // Tier 2 fuzzy
  })

  it("email match is case-insensitive and lives in Tier 1", async () => {
    ff().mockResolvedValueOnce({ id: "lead-e" } as any)
    const r = await matchInboundLeadId("org-1", { email: "A@B.com" })
    expect(r).toBe("lead-e")
    expect(JSON.stringify(ff().mock.calls[0][0]!.where.OR)).toContain("insensitive")
  })

  it("returns undefined when both tiers miss", async () => {
    const r = await matchInboundLeadId("org-1", { phone: "+994501112233" })
    expect(r).toBeUndefined()
    expect(ff()).toHaveBeenCalledTimes(2) // exact then fuzzy, both null
  })

  it("email-only input does not trigger a fuzzy Tier 2 (no phone → no last9)", async () => {
    const r = await matchInboundLeadId("org-1", { email: "nobody@x.com" })
    expect(r).toBeUndefined()
    expect(ff()).toHaveBeenCalledTimes(1) // no phone → no Tier 2
  })

  it("matches a lead by Telegram handle in Tier 1 (bare + @-prefixed variants)", async () => {
    ff().mockResolvedValueOnce({ id: "lead-tg" } as any)
    const r = await matchInboundLeadId("org-1", { telegramHandle: "johndoe" })
    expect(r).toBe("lead-tg")
    expect(ff()).toHaveBeenCalledTimes(1) // exact only, no fuzzy
    const orJson = JSON.stringify(ff().mock.calls[0][0]!.where.OR)
    expect(orJson).toContain("telegramHandle")
    expect(orJson).toContain("@johndoe") // both "johndoe" and "@johndoe" tried
  })

  it("strips a leading @ and matches case-insensitively", async () => {
    await matchInboundLeadId("org-1", { telegramHandle: "@Alice" })
    const orJson = JSON.stringify(ff().mock.calls[0][0]!.where.OR)
    expect(orJson).toContain('"equals":"Alice"')   // bare (leading @ stripped)
    expect(orJson).toContain('"equals":"@Alice"')  // @-prefixed variant
    expect(orJson).toContain('"mode":"insensitive"')
  })
})
