import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma");
  return { prisma: makeMtmPrismaMock() };
});

vi.mock("@/lib/workforce/no-show-candidate", () => ({
  readWorkforceNoShowCandidate: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  readWorkforceNoShowCandidateBatch,
  WORKFORCE_NO_SHOW_CANDIDATE_BATCH_MAX,
} from "@/lib/workforce/no-show-candidate-batch";
import { readWorkforceNoShowCandidate } from "@/lib/workforce/no-show-candidate";

const INPUT = {
  organizationId: "org-no-show-batch",
  workDate: "2026-09-01",
  asOf: new Date("2026-09-01T05:15:00.000Z"),
};

describe("Workforce no-show candidate batch reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-a" },
      { id: "agent-b" },
      { id: "agent-c" },
    ] as never);
    vi.mocked(readWorkforceNoShowCandidate)
      .mockResolvedValueOnce({
        outcome: "NOT_READY",
        code: "WORKFORCE_NO_SHOW_EMPLOYMENT_STATUS_UNAVAILABLE",
      })
      .mockResolvedValueOnce({
        outcome: "DO_NOT_CREATE",
        proposal: {
          outcome: "DO_NOT_CREATE",
          code: "WORKFORCE_NO_SHOW_WORKDAY_EXISTS",
        },
      });
  });

  it("reads one bounded tenant slice serially and returns an in-memory cursor only", async () => {
    await expect(
      readWorkforceNoShowCandidateBatch(prisma as never, {
        ...INPUT,
        afterAgentId: "agent-0",
        limit: 2,
      }),
    ).resolves.toMatchObject({
      workDate: INPUT.workDate,
      morePending: true,
      nextCursorAgentId: "agent-b",
      candidates: [
        {
          agentId: "agent-a",
          result: { outcome: "NOT_READY" },
        },
        {
          agentId: "agent-b",
          result: { outcome: "DO_NOT_CREATE" },
        },
      ],
    });
    expect(prisma.mtmAgent.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: INPUT.organizationId,
        id: { gt: "agent-0" },
      },
      orderBy: { id: "asc" },
      take: 3,
      select: { id: true },
    });
    expect(readWorkforceNoShowCandidate).toHaveBeenNthCalledWith(1, prisma, {
      ...INPUT,
      agentId: "agent-a",
    });
    expect(readWorkforceNoShowCandidate).toHaveBeenNthCalledWith(2, prisma, {
      ...INPUT,
      agentId: "agent-b",
    });
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled();
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled();
  });

  it("rejects an oversized batch before reading any employee", async () => {
    await expect(
      readWorkforceNoShowCandidateBatch(prisma as never, {
        ...INPUT,
        limit: WORKFORCE_NO_SHOW_CANDIDATE_BATCH_MAX + 1,
      }),
    ).rejects.toThrow("limit must be from");
    expect(prisma.mtmAgent.findMany).not.toHaveBeenCalled();
    expect(readWorkforceNoShowCandidate).not.toHaveBeenCalled();
  });
});
