import { describe, it, expect, vi, beforeEach } from "vitest"

const { updateMany } = vi.hoisted(() => ({ updateMany: vi.fn(async (..._a: unknown[]) => ({ count: 1 })) }))
vi.mock("@/lib/prisma", () => ({ prisma: { ticket: { updateMany } } }))

import { reflectSurveyRatingOnTicket } from "@/lib/surveys/reflect-rating"

beforeEach(() => { updateMany.mockReset(); updateMany.mockResolvedValue({ count: 1 }) })

describe("reflectSurveyRatingOnTicket", () => {
  it("copies score+comment onto the ticket, ORG-SCOPED (a cross-org ticketId can't touch another tenant)", async () => {
    await reflectSurveyRatingOnTicket({ orgId: "o1", ticketId: "tk1", score: 5, surveyType: "csat", comment: "great" })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "tk1", organizationId: "o1" },
      data: { satisfactionRating: 5, satisfactionComment: "great" },
    })
  })
  it("uses null comment when none given, and never throws (best-effort)", async () => {
    await reflectSurveyRatingOnTicket({ orgId: "o1", ticketId: "tk1", score: 4, surveyType: "csat" })
    expect((updateMany.mock.calls[0][0] as any).data.satisfactionComment).toBeNull()
    updateMany.mockRejectedValueOnce(new Error("db down"))
    await expect(reflectSurveyRatingOnTicket({ orgId: "o1", ticketId: "tk1", score: 4, surveyType: "csat" })).resolves.toBeUndefined()
  })
})
