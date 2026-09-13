import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma");
  return { prisma: makeMtmPrismaMock() };
});

import { prisma } from "@/lib/prisma";
import { readWorkforceMissedFinishCandidate } from "@/lib/workforce/missed-finish-candidate";

const INPUT = {
  organizationId: "org-missed-finish",
  agentId: "agent-missed-finish",
  workdayId: "workday-missed-finish",
  asOf: new Date("2026-09-01T14:30:00.000Z"),
  timing: {
    privateReminderAfterSeconds: 15 * 60,
    reviewAfterSeconds: 2 * 60 * 60,
  },
};

function configureOpenWorkday() {
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
    id: INPUT.workdayId,
    status: "STARTED",
  } as never);
  vi.mocked(prisma.workforceShiftSnapshot.findFirst).mockResolvedValue({
    plannedEndAt: new Date("2026-09-01T14:00:00.000Z"),
  } as never);
}

describe("Workforce missed-finish candidate reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureOpenWorkday();
  });

  it("returns only a private generic reminder candidate after exact immutable reads", async () => {
    await expect(
      readWorkforceMissedFinishCandidate(prisma as never, INPUT),
    ).resolves.toEqual({
      outcome: "ACTION_CANDIDATE",
      workdayId: INPUT.workdayId,
      proposal: {
        outcome: "PROPOSE_PRIVATE_REMINDER",
        code: "WORKFORCE_MISSED_FINISH_REMINDER_DUE",
        notificationPayload: "GENERIC_OPEN_WORKDAY_REMINDER",
      },
    });
    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledWith({
      where: {
        id: INPUT.workdayId,
        organizationId: INPUT.organizationId,
        agentId: INPUT.agentId,
      },
      select: { id: true, status: true },
    });
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled();
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled();
  });

  it("does not read or act on a completed workday", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: INPUT.workdayId,
      status: "COMPLETED",
    } as never);

    await expect(
      readWorkforceMissedFinishCandidate(prisma as never, INPUT),
    ).resolves.toEqual({
      outcome: "DO_NOT_ACT",
      code: "WORKFORCE_MISSED_FINISH_WORKDAY_NOT_OPEN",
    });
    expect(prisma.workforceShiftSnapshot.findFirst).not.toHaveBeenCalled();
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled();
  });

  it("fails closed when the immutable shift snapshot is unavailable", async () => {
    vi.mocked(prisma.workforceShiftSnapshot.findFirst).mockResolvedValue(
      null as never,
    );

    await expect(
      readWorkforceMissedFinishCandidate(prisma as never, INPUT),
    ).resolves.toEqual({
      outcome: "NOT_READY",
      code: "WORKFORCE_MISSED_FINISH_SNAPSHOT_UNAVAILABLE",
    });
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled();
  });

  it("can only propose review after the explicit caller-supplied review threshold", async () => {
    await expect(
      readWorkforceMissedFinishCandidate(prisma as never, {
        ...INPUT,
        asOf: new Date("2026-09-01T16:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      outcome: "ACTION_CANDIDATE",
      proposal: {
        outcome: "PROPOSE_REVIEW_CASE",
        code: "WORKFORCE_MISSED_FINISH_STALE_OPEN_WORKDAY",
        automaticFinish: "FORBIDDEN",
        correction: "REQUIRES_HUMAN_REVIEW",
      },
    });
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled();
  });
});
