/**
 * Tests for B9 CSAT/NPS auto-surveys slice 1 — post-resolution catch-up.
 * Pure handler logic; Prisma mocked.
 */
import { describe, it, expect, vi } from "vitest"
import {
  isSurveyEligible,
  isContactSuppressed,
  runPostResolutionSurveyScan,
} from "@/lib/queue/jobs/post-resolution-survey"

describe("B9 — isSurveyEligible", () => {
  it("active + afterTicketResolve + no response → true", () => {
    expect(isSurveyEligible(
      { status: "active", triggers: { afterTicketResolve: true } },
      false
    )).toBe(true)
  })

  it("draft survey → false", () => {
    expect(isSurveyEligible(
      { status: "draft", triggers: { afterTicketResolve: true } },
      false
    )).toBe(false)
  })

  it("paused survey → false", () => {
    expect(isSurveyEligible(
      { status: "paused", triggers: { afterTicketResolve: true } },
      false
    )).toBe(false)
  })

  it("trigger not set → false", () => {
    expect(isSurveyEligible(
      { status: "active", triggers: { afterDealWon: true } },
      false
    )).toBe(false)
  })

  it("triggers undefined → false (defensive)", () => {
    expect(isSurveyEligible(
      { status: "active", triggers: undefined },
      false
    )).toBe(false)
  })

  it("triggers null → false", () => {
    expect(isSurveyEligible(
      { status: "active", triggers: null },
      false
    )).toBe(false)
  })

  it("already responded → false", () => {
    expect(isSurveyEligible(
      { status: "active", triggers: { afterTicketResolve: true } },
      true
    )).toBe(false)
  })
})

describe("B9 — isContactSuppressed", () => {
  it("no recent responses → not suppressed", () => {
    expect(isContactSuppressed([], { email: "a@b.com", phone: null })).toBe(false)
  })

  it("email match in recent responses → suppressed (case-insensitive)", () => {
    expect(isContactSuppressed(
      [{ email: "ALICE@example.com", phone: null }],
      { email: "alice@example.com", phone: null }
    )).toBe(true)
  })

  it("phone match → suppressed", () => {
    expect(isContactSuppressed(
      [{ email: null, phone: "+1234567890" }],
      { email: null, phone: "+1234567890" }
    )).toBe(true)
  })

  it("different email + null phone → not suppressed", () => {
    expect(isContactSuppressed(
      [{ email: "bob@example.com", phone: null }],
      { email: "alice@example.com", phone: null }
    )).toBe(false)
  })

  it("null contact email vs response email is not a match", () => {
    expect(isContactSuppressed(
      [{ email: "x@y.com", phone: null }],
      { email: null, phone: "+1234567890" }
    )).toBe(false)
  })
})

describe("B9 — runPostResolutionSurveyScan", () => {
  function makePrisma(overrides: any = {}) {
    return {
      ticket: { findMany: vi.fn().mockResolvedValue([]), ...overrides.ticket },
      survey: { findMany: vi.fn().mockResolvedValue([]), ...overrides.survey },
      surveyResponse: {
        findMany: vi.fn().mockResolvedValue([]),
        ...overrides.surveyResponse,
      },
    }
  }

  it("returns zero counts when no resolved tickets in window", async () => {
    const prisma = makePrisma()
    const sendInvite = vi.fn()
    const r = await runPostResolutionSurveyScan(prisma, sendInvite)
    expect(r.ticketsScanned).toBe(0)
    expect(r.surveysSent).toBe(0)
    expect(sendInvite).not.toHaveBeenCalled()
  })

  it("sends invite for resolved ticket with eligible survey", async () => {
    const prisma = makePrisma({
      ticket: {
        findMany: vi.fn().mockResolvedValue([{
          id: "t1",
          ticketNumber: "T-001",
          contactId: "c1",
          organizationId: "org1",
          source: "email",
          sourceMeta: null,
          resolvedAt: new Date(),
          contact: { id: "c1", email: "a@b.com", phone: null },
        }]),
      },
      survey: {
        findMany: vi.fn().mockResolvedValue([{
          id: "s1",
          name: "CSAT Q1",
          status: "active",
          triggers: { afterTicketResolve: true },
        }]),
      },
    })
    const sendInvite = vi.fn().mockResolvedValue(true)
    const r = await runPostResolutionSurveyScan(prisma, sendInvite)
    expect(r.ticketsScanned).toBe(1)
    expect(r.surveysSent).toBe(1)
    expect(sendInvite).toHaveBeenCalledTimes(1)
    expect(sendInvite.mock.calls[0][0]).toMatchObject({
      ticketId: "t1",
      ticketNumber: "T-001",
      surveyId: "s1",
    })
  })

  it("skips ticket whose contact was surveyed in the last 30 days", async () => {
    const prisma = makePrisma({
      ticket: {
        findMany: vi.fn().mockResolvedValue([{
          id: "t1",
          ticketNumber: "T-001",
          contactId: "c1",
          organizationId: "org1",
          source: "email",
          sourceMeta: null,
          resolvedAt: new Date(),
          contact: { id: "c1", email: "a@b.com", phone: null },
        }]),
      },
      survey: {
        findMany: vi.fn().mockResolvedValue([{
          id: "s1",
          name: "CSAT",
          status: "active",
          triggers: { afterTicketResolve: true },
        }]),
      },
      surveyResponse: {
        findMany: vi.fn()
          // first call: existing responses for (survey, ticket)
          .mockResolvedValueOnce([])
          // second call: recent responses for suppression
          .mockResolvedValueOnce([{ email: "a@b.com", phone: null }]),
      },
    })
    const sendInvite = vi.fn().mockResolvedValue(true)
    const r = await runPostResolutionSurveyScan(prisma, sendInvite)
    expect(r.suppressed).toBe(1)
    expect(r.surveysSent).toBe(0)
    expect(sendInvite).not.toHaveBeenCalled()
  })

  it("skips (ticket, survey) pair that already has a response", async () => {
    const prisma = makePrisma({
      ticket: {
        findMany: vi.fn().mockResolvedValue([{
          id: "t1",
          ticketNumber: "T-001",
          contactId: "c1",
          organizationId: "org1",
          source: "email",
          sourceMeta: null,
          resolvedAt: new Date(),
          contact: { id: "c1", email: "a@b.com", phone: null },
        }]),
      },
      survey: {
        findMany: vi.fn().mockResolvedValue([{
          id: "s1", name: "CSAT", status: "active",
          triggers: { afterTicketResolve: true },
        }]),
      },
      surveyResponse: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ surveyId: "s1", ticketId: "t1" }]) // existing
          .mockResolvedValueOnce([]),
      },
    })
    const sendInvite = vi.fn().mockResolvedValue(true)
    const r = await runPostResolutionSurveyScan(prisma, sendInvite)
    expect(r.surveysSent).toBe(0)
    expect(sendInvite).not.toHaveBeenCalled()
  })

  it("counts errors when sendInvite returns false", async () => {
    const prisma = makePrisma({
      ticket: {
        findMany: vi.fn().mockResolvedValue([{
          id: "t1", ticketNumber: "T-001", contactId: "c1",
          organizationId: "org1", source: null, sourceMeta: null,
          resolvedAt: new Date(),
          contact: { id: "c1", email: "a@b.com", phone: null },
        }]),
      },
      survey: {
        findMany: vi.fn().mockResolvedValue([{
          id: "s1", name: "X", status: "active",
          triggers: { afterTicketResolve: true },
        }]),
      },
    })
    const sendInvite = vi.fn().mockResolvedValue(false)
    const r = await runPostResolutionSurveyScan(prisma, sendInvite)
    expect(r.errors).toBe(1)
    expect(r.surveysSent).toBe(0)
  })

  it("counts errors when sendInvite throws", async () => {
    const prisma = makePrisma({
      ticket: {
        findMany: vi.fn().mockResolvedValue([{
          id: "t1", ticketNumber: "T-001", contactId: "c1",
          organizationId: "org1", source: null, sourceMeta: null,
          resolvedAt: new Date(),
          contact: { id: "c1", email: "a@b.com", phone: null },
        }]),
      },
      survey: {
        findMany: vi.fn().mockResolvedValue([{
          id: "s1", name: "X", status: "active",
          triggers: { afterTicketResolve: true },
        }]),
      },
    })
    const sendInvite = vi.fn().mockRejectedValue(new Error("smtp down"))
    const r = await runPostResolutionSurveyScan(prisma, sendInvite)
    expect(r.errors).toBe(1)
  })

  it("groups by org — surveys + suppression queried per-tenant", async () => {
    const prisma = makePrisma({
      ticket: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "t1", ticketNumber: "A-1", contactId: "c1",
            organizationId: "orgA", source: null, sourceMeta: null,
            resolvedAt: new Date(),
            contact: { id: "c1", email: "a@a.com", phone: null },
          },
          {
            id: "t2", ticketNumber: "B-1", contactId: "c2",
            organizationId: "orgB", source: null, sourceMeta: null,
            resolvedAt: new Date(),
            contact: { id: "c2", email: "b@b.com", phone: null },
          },
        ]),
      },
      survey: {
        findMany: vi.fn().mockResolvedValue([
          { id: "s1", name: "S1", status: "active", triggers: { afterTicketResolve: true } },
        ]),
      },
    })
    const sendInvite = vi.fn().mockResolvedValue(true)
    await runPostResolutionSurveyScan(prisma, sendInvite)
    // survey.findMany called once per org
    expect(prisma.survey.findMany).toHaveBeenCalledTimes(2)
  })

  it("within-run dedup: second eligible survey for same contact is suppressed", async () => {
    const prisma = makePrisma({
      ticket: {
        findMany: vi.fn().mockResolvedValue([{
          id: "t1", ticketNumber: "T-001", contactId: "c1",
          organizationId: "org1", source: null, sourceMeta: null,
          resolvedAt: new Date(),
          contact: { id: "c1", email: "a@b.com", phone: null },
        }]),
      },
      survey: {
        findMany: vi.fn().mockResolvedValue([
          { id: "s1", name: "S1", status: "active", triggers: { afterTicketResolve: true } },
          { id: "s2", name: "S2", status: "active", triggers: { afterTicketResolve: true } },
        ]),
      },
    })
    const sendInvite = vi.fn().mockResolvedValue(true)
    const r = await runPostResolutionSurveyScan(prisma, sendInvite)
    // First survey sends; second loop iteration treats the contact as just-surveyed.
    // Net: exactly 1 send, no double-firing in the same run.
    expect(r.surveysSent).toBe(1)
    expect(sendInvite).toHaveBeenCalledTimes(1)
  })

  it("custom lookback / minAge / suppression propagate to result", async () => {
    const prisma = makePrisma()
    const r = await runPostResolutionSurveyScan(prisma, vi.fn(), new Date(), 12, 45, 60)
    expect(r.lookbackHours).toBe(12)
    expect(r.minAgeMinutes).toBe(45)
    expect(r.suppressionDays).toBe(60)
  })

  it("scan window excludes tickets younger than minAgeMinutes (immediate path still has time)", async () => {
    // Capture the where clause passed to ticket.findMany
    const findMany = vi.fn().mockResolvedValue([])
    const prisma = makePrisma({ ticket: { findMany } })
    const now = new Date("2026-05-17T12:00:00Z")
    await runPostResolutionSurveyScan(prisma, vi.fn(), now, 2, 30)

    const arg = findMany.mock.calls[0][0]
    // resolvedAt range: gte = now - 2h, lte = now - 30min
    expect(arg.where.resolvedAt.gte.getTime()).toBe(now.getTime() - 2 * 60 * 60 * 1000)
    expect(arg.where.resolvedAt.lte.getTime()).toBe(now.getTime() - 30 * 60 * 1000)
  })

  it("EligibleSurveyTarget carries organizationId for the callback (no extra DB lookup)", async () => {
    const prisma = makePrisma({
      ticket: {
        findMany: vi.fn().mockResolvedValue([{
          id: "t1", ticketNumber: "T-001", contactId: "c1",
          organizationId: "org_xyz", source: null, sourceMeta: null,
          resolvedAt: new Date(),
          contact: { id: "c1", email: "a@b.com", phone: null },
        }]),
      },
      survey: {
        findMany: vi.fn().mockResolvedValue([{
          id: "s1", name: "S", status: "active",
          triggers: { afterTicketResolve: true },
        }]),
      },
    })
    const sendInvite = vi.fn().mockResolvedValue(true)
    await runPostResolutionSurveyScan(prisma, sendInvite)
    expect(sendInvite.mock.calls[0][0]).toMatchObject({ organizationId: "org_xyz" })
  })
})
