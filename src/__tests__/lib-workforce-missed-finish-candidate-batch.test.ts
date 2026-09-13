import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma");
  return { prisma: makeMtmPrismaMock() };
});

vi.mock("@/lib/workforce/missed-finish-candidate", () => ({
  readWorkforceMissedFinishCandidate: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  readWorkforceMissedFinishCandidateBatch,
  WORKFORCE_MISSED_FINISH_CANDIDATE_BATCH_MAX,
} from "@/lib/workforce/missed-finish-candidate-batch";
import { readWorkforceMissedFinishCandidate } from "@/lib/workforce/missed-finish-candidate";

const INPUT = {
  organizationId: "org-missed-finish-batch",
  asOf: new Date("2026-09-01T14:30:00.000Z"),
  timing: {
    privateReminderAfterSeconds: 15 * 60,
    reviewAfterSeconds: 2 * 60 * 60,
  },
};

describe("Workforce missed-finish candidate batch reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([
      { id: "workday-a", agentId: "agent-a" },
      { id: "workday-b", agentId: "agent-b" },
      { id: "workday-c", agentId: "agent-c" },
    ] as never);
    vi.mocked(readWorkforceMissedFinishCandidate)
      .mockResolvedValueOnce({
        outcome: "DO_NOT_ACT",
        proposal: {
          outcome: "DO_NOT_ACT",
          code: "WORKFORCE_MISSED_FINISH_GRACE_NOT_EXPIRED",
        },
      })
      .mockResolvedValueOnce({
        outcome: "ACTION_CANDIDATE",
        workdayId: "workday-b",
        proposal: {
          outcome: "PROPOSE_PRIVATE_REMINDER",
          code: "WORKFORCE_MISSED_FINISH_REMINDER_DUE",
          notificationPayload: "GENERIC_OPEN_WORKDAY_REMINDER",
        },
      });
  });

  it("reads bounded open-workday rows and returns only in-memory continuation metadata", async () => {
    await expect(
      readWorkforceMissedFinishCandidateBatch(prisma as never, {
        ...INPUT,
        afterWorkdayId: "workday-0",
        limit: 2,
      }),
    ).resolves.toMatchObject({
      morePending: true,
      nextCursorWorkdayId: "workday-b",
      candidates: [
        { workdayId: "workday-a", agentId: "agent-a", result: { outcome: "DO_NOT_ACT" } },
        { workdayId: "workday-b", agentId: "agent-b", result: { outcome: "ACTION_CANDIDATE" } },
      ],
    });
    expect(prisma.mtmAgentWorkday.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: INPUT.organizationId,
        status: { in: ["STARTED", "PAUSED"] },
        id: { gt: "workday-0" },
      },
      orderBy: { id: "asc" },
      take: 3,
      select: { id: true, agentId: true },
    });
    expect(readWorkforceMissedFinishCandidate).toHaveBeenNthCalledWith(1, prisma, {
      organizationId: INPUT.organizationId,
      agentId: "agent-a",
      workdayId: "workday-a",
      asOf: INPUT.asOf,
      timing: INPUT.timing,
    });
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled();
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled();
  });

  it("rejects an oversized batch before querying any open workday", async () => {
    await expect(
      readWorkforceMissedFinishCandidateBatch(prisma as never, {
        ...INPUT,
        limit: WORKFORCE_MISSED_FINISH_CANDIDATE_BATCH_MAX + 1,
      }),
    ).rejects.toThrow("limit must be from");
    expect(prisma.mtmAgentWorkday.findMany).not.toHaveBeenCalled();
    expect(readWorkforceMissedFinishCandidate).not.toHaveBeenCalled();
  });

  it("stops and propagates an incomplete workday read instead of treating later rows as a complete reminder scan", async () => {
    vi.mocked(readWorkforceMissedFinishCandidate).mockReset();
    vi.mocked(readWorkforceMissedFinishCandidate).mockRejectedValueOnce(
      new Error("immutable shift snapshot unavailable"),
    );

    await expect(
      readWorkforceMissedFinishCandidateBatch(prisma as never, {
        ...INPUT,
        limit: 2,
      }),
    ).rejects.toThrow("immutable shift snapshot unavailable");

    // No future scheduler may interpret a partial read as a completed scan;
    // it must record the incomplete observation and leave all workdays alone.
    expect(readWorkforceMissedFinishCandidate).toHaveBeenCalledTimes(1);
    expect(readWorkforceMissedFinishCandidate).toHaveBeenCalledWith(prisma, {
      organizationId: INPUT.organizationId,
      agentId: "agent-a",
      workdayId: "workday-a",
      asOf: INPUT.asOf,
      timing: INPUT.timing,
    });
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled();
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled();
  });
});
