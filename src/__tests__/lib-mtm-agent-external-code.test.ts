/**
 * The agent's code given in sequence (owner, 2026-10-20, on the agent form:
 * «тут код агента чтоб автоматически задавался. последовательно»). The codes
 * below are invented; their shapes are the ones organizations really use.
 */
import { describe, expect, it } from "vitest"
import { Prisma } from "@prisma/client"
import { isMtmAgentCodeConflict, nextMtmAgentCode, splitMtmAgentCode } from "@/lib/mtm/agent-external-code"

describe("the next agent code", () => {
  it("starts at AG-001 where no agent has a code", () => {
    expect(nextMtmAgentCode([])).toBe("AG-001")
    expect(nextMtmAgentCode([null, null])).toBe("AG-001")
  })

  it("continues the sequence most codes are in, past its highest number, however the cards were ordered", () => {
    // Newest card first: one typed by hand in another shape does not start a sequence of its own.
    expect(nextMtmAgentCode(["AG-016", null, "NZ-001", "AG-007"])).toBe("AG-017")
    expect(nextMtmAgentCode(["XY-5", "AG-016", "AG-021", "AG-003"])).toBe("AG-022")
  })

  it("keeps the organization's own shape: its prefix, its width, digits alone", () => {
    expect(nextMtmAgentCode(["m-4", "m-12"])).toBe("m-13")
    expect(nextMtmAgentCode(["000123", "000122"])).toBe("000124")
    expect(nextMtmAgentCode(["AG-999", "AG-998"])).toBe("AG-1000")
  })

  it("on a tie, follows the sequence given last", () => {
    expect(nextMtmAgentCode(["BK-2", "AG-001", "BK-1", "AG-002"])).toBe("BK-3")
  })

  it("passes over codes that end in no number", () => {
    expect(nextMtmAgentCode(["DEMO-ALPHA", "AG-002"])).toBe("AG-003")
    expect(nextMtmAgentCode(["DEMO-ALPHA"])).toBe("AG-001")
  })

  it("reads a number written with more or fewer zeros as the same number", () => {
    expect(nextMtmAgentCode(["AG-17", "AG-016"])).toBe("AG-18")
    expect(splitMtmAgentCode(" AG-0042 ")).toEqual({ prefix: "AG-", number: 42, width: 4 })
    expect(splitMtmAgentCode("AG-")).toBeNull()
  })
})

describe("which refusal is a taken code", () => {
  const unique = (target: unknown) => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6", meta: { target } })

  it("is the organization's unique code, named as fields or as the index", () => {
    expect(isMtmAgentCodeConflict(unique(["organizationId", "externalCode"]))).toBe(true)
    expect(isMtmAgentCodeConflict(unique("mtm_agents_organizationId_externalCode_key"))).toBe(true)
  })

  it("is not another unique field, another error, or anything thrown that is not Prisma's", () => {
    expect(isMtmAgentCodeConflict(unique(["organizationId", "email"]))).toBe(false)
    expect(isMtmAgentCodeConflict(new Prisma.PrismaClientKnownRequestError("x", { code: "P2003", clientVersion: "6", meta: { target: ["externalCode"] } }))).toBe(false)
    expect(isMtmAgentCodeConflict(new Error("externalCode"))).toBe(false)
  })
})
