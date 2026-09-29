import { describe, expect, it } from "vitest"
import { isPublicTicketStatus, isTerminalTicketStatus, publicSlaPhase } from "@/lib/ticketing/portal-ticket-presentation"

describe("customer-safe ticket presentation", () => {
  it("allows only the public lifecycle vocabulary", () => {
    for (const status of ["new", "open", "in_progress", "waiting", "resolved", "closed"]) {
      expect(isPublicTicketStatus(status)).toBe(true)
    }
    for (const internal of ["escalated", "breached", "assigned", "pending_approval"]) {
      expect(isPublicTicketStatus(internal)).toBe(false)
    }
  })

  it("uses the first-response target until the first response exists", () => {
    expect(publicSlaPhase({
      status: "open",
      firstResponseAt: null,
      slaFirstResponseDueAt: "2026-09-05T13:00:00.000Z",
      slaDueAt: "2026-09-06T13:00:00.000Z",
    })).toEqual({ kind: "firstResponse", dueAt: "2026-09-05T13:00:00.000Z" })
  })

  it("advances to resolution and hides all deadlines after completion", () => {
    expect(publicSlaPhase({
      status: "in_progress",
      firstResponseAt: "2026-09-05T12:10:00.000Z",
      slaFirstResponseDueAt: "2026-09-05T13:00:00.000Z",
      slaDueAt: "2026-09-06T13:00:00.000Z",
    })).toEqual({ kind: "resolution", dueAt: "2026-09-06T13:00:00.000Z" })
    expect(publicSlaPhase({ status: "resolved", slaDueAt: "2026-09-06T13:00:00.000Z" })).toEqual({ kind: "complete" })
    expect(publicSlaPhase({ status: "closed", slaDueAt: "2026-09-06T13:00:00.000Z" })).toEqual({ kind: "complete" })
    expect(isTerminalTicketStatus("resolved")).toBe(true)
    expect(isTerminalTicketStatus("open")).toBe(false)
  })
})
