import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = {
  socialLegalCase: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  socialLegalCandidate: { update: vi.fn() },
  socialLegalEvidence: { updateMany: vi.fn() },
  socialLegalEvent: { create: vi.fn() },
  socialLegalAction: { create: vi.fn() },
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialMention: { findFirst: vi.fn() },
    socialLegalPolicy: { upsert: vi.fn() },
    socialLegalCandidate: { upsert: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    socialLegalEvidence: { upsert: vi.fn() },
    aiInteractionLog: { create: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  },
}))

vi.mock("@/lib/ai/budget", () => ({
  checkAiBudget: vi.fn(async () => ({ allowed: false })),
  calculateAiCost: vi.fn(() => 0),
}))

vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: vi.fn(() => ({ messages: { create: vi.fn() } })),
}))

vi.mock("@/lib/ai/social-agent", () => ({
  getSubjectSocialAgentPersona: vi.fn(async () => null),
}))

import { prisma } from "@/lib/prisma"
import { createLegalCandidate, listLegalCandidates, promoteLegalCandidate } from "@/lib/social/legal-workflow"

const mention = {
  id: "mention-1",
  organizationId: "org-1",
  platform: "instagram",
  sourceType: "comment",
  text: "This brand is a scammer",
  url: "https://instagram.com/p/1/c/2",
  canonicalUrl: "https://instagram.com/p/1/c/2",
  authorName: "Author",
  authorHandle: "author",
  publishedAt: new Date("2026-07-11T10:00:00Z"),
  createdAt: new Date("2026-07-11T10:00:00Z"),
  contentVersion: 1,
  subjectMatches: [{
    id: "match-1",
    subjectId: "subject-1",
    status: "MATCHED",
    reason: "exact_alias_match",
    subject: { id: "subject-1", name: "Brand", type: "BRAND", assignedAgentId: "agent-1", legalPolicy: {} },
  }],
}

const policy = {
  id: "policy-1",
  organizationId: "org-1",
  enabled: true,
  candidateThreshold: 0.65,
  autoPromote: false,
  requireHumanReview: true,
  allowedCategories: ["insult", "defamation", "false_accusation", "threat"],
  policyVersion: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.socialMention.findFirst).mockResolvedValue(mention as never)
  vi.mocked(prisma.socialLegalPolicy.upsert).mockResolvedValue(policy as never)
  vi.mocked(prisma.socialLegalCandidate.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.socialLegalCandidate.upsert).mockResolvedValue({
    id: "candidate-1", organizationId: "org-1", mentionId: "mention-1", subjectId: "subject-1",
    status: "HUMAN_REVIEW", category: "defamation", classifierVersion: "human-v1",
  } as never)
  vi.mocked(prisma.socialLegalCandidate.create).mockResolvedValue({
    id: "candidate-1", organizationId: "org-1", mentionId: "mention-1", subjectId: "subject-1",
    status: "HUMAN_REVIEW", category: "defamation", classifierVersion: "social-legal-candidate-v3",
  } as never)
  vi.mocked(prisma.socialLegalCandidate.updateMany).mockResolvedValue({ count: 0 })
  vi.mocked(prisma.socialLegalEvidence.upsert).mockResolvedValue({ id: "evidence-1" } as never)
  tx.socialLegalCase.findFirst.mockResolvedValue(null)
  tx.socialLegalCase.create.mockResolvedValue({ id: "case-1", status: "open" })
  tx.socialLegalCandidate.update.mockResolvedValue({})
  tx.socialLegalEvidence.updateMany.mockResolvedValue({ count: 1 })
  tx.socialLegalEvent.create.mockResolvedValue({})
  tx.socialLegalAction.create.mockResolvedValue({})
})

describe("legal candidate workflow", () => {
  it("excludes stale automated official publications from the candidate list without hiding human flags", async () => {
    vi.mocked(prisma.socialLegalCandidate.findMany).mockResolvedValue([])

    await expect(listLegalCandidates("org-1")).resolves.toEqual([])

    const query = vi.mocked(prisma.socialLegalCandidate.findMany).mock.calls[0]?.[0]
    expect(query?.where).toEqual(expect.objectContaining({
      organizationId: "org-1",
      NOT: {
        AND: [
          { createdBy: null },
          { classifierVersion: { startsWith: "social-legal-candidate-" } },
          { mention: { is: expect.any(Object) } },
        ],
      },
    }))
    expect(JSON.stringify(query?.where)).toContain("officialArchive")
    expect(JSON.stringify(query?.where)).toContain("official_author")
    const automatedGuard = (query?.where?.NOT as { AND?: unknown[] } | undefined)?.AND
    const mentionGuard = (automatedGuard?.[2] as {
      mention?: { is?: { AND?: unknown[] } }
    } | undefined)?.mention?.is?.AND
    expect(mentionGuard?.[0]).toEqual({
      OR: [
        { contentKind: null },
        { contentKind: { notIn: ["COMMENT", "REPLY"] } },
      ],
    })
    expect(mentionGuard?.[1]).toEqual({
      OR: [
        { sourceType: null },
        { sourceType: { notIn: ["comment", "reply"] } },
      ],
    })
  })

  it("does not create an automated candidate for an official direct publication", async () => {
    vi.mocked(prisma.socialMention.findFirst).mockResolvedValue({
      ...mention,
      // Global-search rows historically used this legacy representation for
      // direct social publications.
      sourceType: "mention",
      contentKind: "MENTION",
      sourceMetadata: { ownership: "external" },
      subjectMatches: [{
        ...mention.subjectMatches[0],
        status: "REJECTED",
        reason: "official_author",
      }],
    } as never)

    await expect(createLegalCandidate({
      organizationId: "org-1",
      mentionId: "mention-1",
      runAi: false,
    })).resolves.toBeNull()

    expect(prisma.socialLegalCandidate.updateMany).not.toHaveBeenCalled()
    expect(prisma.socialLegalCandidate.create).not.toHaveBeenCalled()
    expect(prisma.socialLegalCandidate.upsert).not.toHaveBeenCalled()
    expect(prisma.socialLegalEvidence.upsert).not.toHaveBeenCalled()
  })

  it("keeps explicit human flagging available for an official publication", async () => {
    vi.mocked(prisma.socialMention.findFirst).mockResolvedValue({
      ...mention,
      sourceType: "post",
      contentKind: "VIDEO",
      sourceMetadata: { officialArchive: true },
      subjectMatches: [{
        ...mention.subjectMatches[0],
        status: "REJECTED",
        reason: "official_author",
      }],
    } as never)

    await expect(createLegalCandidate({
      organizationId: "org-1",
      mentionId: "mention-1",
      requestedBy: "reviewer-1",
      category: "reputation_risk",
      runAi: false,
    })).resolves.toMatchObject({ id: "candidate-1" })

    expect(prisma.socialLegalCandidate.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        createdBy: "reviewer-1",
        classifierVersion: "human-v1",
        subjectId: "subject-1",
      }),
    }))
    expect(prisma.socialLegalEvidence.upsert).toHaveBeenCalled()
  })

  it.each(["DISMISSED", "PROMOTED"] as const)(
    "does not reopen an automated %s candidate",
    async (status) => {
      const terminalCandidate = {
        id: "candidate-terminal",
        organizationId: "org-1",
        mentionId: "mention-1",
        subjectId: "subject-1",
        status,
        category: "defamation",
        classifierVersion: "human-v1",
      }
      vi.mocked(prisma.socialLegalCandidate.findFirst).mockResolvedValueOnce(
        terminalCandidate as never,
      )

      await expect(createLegalCandidate({
        organizationId: "org-1",
        mentionId: "mention-1",
        runAi: false,
      })).resolves.toEqual(terminalCandidate)

      expect(prisma.socialLegalCandidate.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: "org-1",
          mentionId: "mention-1",
          status: { in: ["DISMISSED", "PROMOTED"] },
        },
      })
      expect(prisma.socialLegalCandidate.upsert).not.toHaveBeenCalled()
      expect(prisma.socialLegalEvidence.upsert).not.toHaveBeenCalled()
    },
  )

  it("does not reopen a candidate terminally reviewed during automated classification", async () => {
    const terminalCandidate = {
      id: "candidate-terminal-race",
      organizationId: "org-1",
      mentionId: "mention-1",
      subjectId: "subject-1",
      status: "DISMISSED",
      category: "defamation",
      classifierVersion: "human-v1",
    }
    vi.mocked(prisma.socialLegalCandidate.create).mockRejectedValueOnce({ code: "P2002" })
    vi.mocked(prisma.socialLegalCandidate.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(terminalCandidate as never)

    await expect(createLegalCandidate({
      organizationId: "org-1",
      mentionId: "mention-1",
      runAi: false,
    })).resolves.toEqual(terminalCandidate)

    expect(prisma.socialLegalCandidate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        mentionId: "mention-1",
        status: { notIn: ["DISMISSED", "PROMOTED"] },
      }),
    }))
    expect(prisma.socialLegalCandidate.upsert).not.toHaveBeenCalled()
    expect(prisma.socialLegalEvidence.upsert).not.toHaveBeenCalled()
  })

  it("captures a human-reviewed candidate and immutable mention evidence without auto promotion", async () => {
    const candidate = await createLegalCandidate({
      organizationId: "org-1",
      mentionId: "mention-1",
      requestedBy: "user-1",
      category: "defamation",
      notes: "Needs counsel review",
      runAi: false,
    })

    expect(candidate).toMatchObject({ id: "candidate-1", status: "HUMAN_REVIEW" })
    expect(prisma.socialLegalCandidate.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        status: "HUMAN_REVIEW",
        classifierVersion: "human-v1",
        subjectId: "subject-1",
      }),
    }))
    expect(prisma.socialLegalEvidence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ evidenceType: "MENTION_SNAPSHOT", legalHold: true }),
    }))
    expect(tx.socialLegalCase.create).not.toHaveBeenCalled()
  })

  it("promotes only through an explicit reviewer and creates event plus action alternatives", async () => {
    vi.mocked(prisma.socialLegalCandidate.findFirst).mockResolvedValue({
      id: "candidate-1",
      organizationId: "org-1",
      mentionId: "mention-1",
      subjectId: "subject-1",
      status: "HUMAN_REVIEW",
      category: "defamation",
      classifierVersion: "human-v1",
      classifierSnapshot: {},
      mention,
      evidences: [{ id: "evidence-1" }],
    } as never)

    const legalCase = await promoteLegalCandidate({
      organizationId: "org-1",
      candidateId: "candidate-1",
      reviewedBy: "reviewer-1",
    })

    expect(legalCase).toEqual({ id: "case-1", status: "open" })
    expect(tx.socialLegalCandidate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PROMOTED", reviewedBy: "reviewer-1" }),
    }))
    expect(tx.socialLegalEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "CANDIDATE_PROMOTED", actorType: "USER" }),
    }))
    expect(tx.socialLegalAction.create).toHaveBeenCalledTimes(3)
  })

  it("keeps a reported case included when a reviewer flags it again", async () => {
    vi.mocked(prisma.socialLegalCandidate.findFirst).mockResolvedValue({
      id: "candidate-1",
      organizationId: "org-1",
      mentionId: "mention-1",
      subjectId: "subject-1",
      status: "HUMAN_REVIEW",
      category: "defamation",
      classifierVersion: "human-v1",
      classifierSnapshot: {},
      mention,
      evidences: [{ id: "evidence-1" }],
    } as never)
    tx.socialLegalCase.findFirst.mockResolvedValue({ id: "case-1", status: "included", notes: "reported" })
    tx.socialLegalCase.update.mockResolvedValue({ id: "case-1", status: "included" })

    const legalCase = await promoteLegalCandidate({
      organizationId: "org-1",
      candidateId: "candidate-1",
      reviewedBy: "reviewer-1",
      category: "insult",
    })

    expect(legalCase).toEqual({ id: "case-1", status: "included" })
    expect(tx.socialLegalCase.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ category: "insult", status: "included", aiSuggested: false }),
    }))
  })
})
