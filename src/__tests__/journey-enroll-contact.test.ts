/**
 * Enrolling a contact in a journey writes only columns the model has, on the
 * journey's first step, due now — what the journey engine needs to run it.
 *
 * The AI payment reminder (api/cron/ai-auto-actions) used to write
 * `currentStepIndex: 0`, a column JourneyEnrollment does not have. The client
 * is typed `any` here, so nothing caught it before Prisma refused the write at
 * run time — inside a `catch {}` that said nothing, ending the run. The written
 * keys are checked against Prisma's own list of the model's columns.
 */
import { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  journey: { findFirst: vi.fn(), updateMany: vi.fn() },
  journeyEnrollment: { findFirst: vi.fn(), create: vi.fn() },
  journeyStep: { update: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))

import { enrollContactInJourney } from "@/lib/journey-enroll"

const NOW = new Date("2026-10-17T09:00:00.000Z")
const COLUMNS = new Set(Object.values(Prisma.JourneyEnrollmentScalarFieldEnum))

beforeEach(() => {
  vi.clearAllMocks()
  db.journey.findFirst.mockResolvedValue({ id: "j-1", steps: [{ id: "step-1", stepOrder: 0 }] })
  db.journeyEnrollment.findFirst.mockResolvedValue(null)
  db.journeyEnrollment.create.mockResolvedValue({ id: "enr-1" })
})

describe("enrollContactInJourney", () => {
  it("writes a due enrollment on the first step, with columns the model has", async () => {
    const id = await enrollContactInJourney({ organizationId: "org-1", journeyId: "j-1", contactId: "c-1", now: NOW })
    expect(id).toBe("enr-1")
    const data = db.journeyEnrollment.create.mock.calls[0][0].data as Record<string, unknown>
    for (const key of Object.keys(data)) expect(COLUMNS.has(key as never), `JourneyEnrollment has no column «${key}»`).toBe(true)
    expect(data).toMatchObject({ organizationId: "org-1", journeyId: "j-1", contactId: "c-1", currentStepId: "step-1", status: "active", nextActionAt: NOW })
    // The journey's and the step's counters move with it, as on the enroll API.
    expect(db.journey.updateMany).toHaveBeenCalledWith({
      where: { id: "j-1", organizationId: "org-1" },
      data: { entryCount: { increment: 1 }, activeCount: { increment: 1 } },
    })
    expect(db.journeyStep.update).toHaveBeenCalledWith({ where: { id: "step-1" }, data: { statsEntered: { increment: 1 } } })
  })

  it("does not enroll twice: active or paused counts as enrolled", async () => {
    db.journeyEnrollment.findFirst.mockResolvedValue({ id: "enr-0" })
    expect(await enrollContactInJourney({ organizationId: "org-1", journeyId: "j-1", contactId: "c-1" })).toBeNull()
    expect(db.journeyEnrollment.findFirst.mock.calls[0][0].where).toMatchObject({ status: { in: ["active", "paused"] }, contactId: "c-1" })
    expect(db.journeyEnrollment.create).not.toHaveBeenCalled()
  })

  it("enrolls no one in a journey without steps", async () => {
    db.journey.findFirst.mockResolvedValue({ id: "j-1", steps: [] })
    expect(await enrollContactInJourney({ organizationId: "org-1", journeyId: "j-1", contactId: "c-1" })).toBeNull()
    expect(db.journeyEnrollment.create).not.toHaveBeenCalled()
  })

  it("enrolls no one in another organisation's journey", async () => {
    db.journey.findFirst.mockResolvedValue(null)
    expect(await enrollContactInJourney({ organizationId: "org-2", journeyId: "j-1", contactId: "c-1" })).toBeNull()
    expect(db.journey.findFirst.mock.calls[0][0].where).toEqual({ id: "j-1", organizationId: "org-2" })
  })
})
