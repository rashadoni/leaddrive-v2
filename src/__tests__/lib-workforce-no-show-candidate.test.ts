import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma");
  return { prisma: makeMtmPrismaMock() };
});

import { prisma } from "@/lib/prisma";
import { readWorkforceNoShowCandidate } from "@/lib/workforce/no-show-candidate";
import { workforcePolicyDefinitionHash } from "@/lib/workforce/policy-definition";
import { workforceShiftDefinitionHash } from "@/lib/workforce/shift-definition";

const ORGANIZATION_ID = "org-no-show";
const AGENT_ID = "agent-no-show";
const WORK_DATE = "2026-09-01";
const AS_OF = new Date("2026-09-01T05:15:00.000Z");
const SHIFT_DEFINITION = {
  startTime: "09:00",
  endTime: "18:00",
  timezone: "Asia/Baku",
  daysOfWeek: [1, 2, 3, 4, 5],
};
const POLICY_DEFINITION = {
  expectedWorkSeconds: 8 * 60 * 60,
  lateGraceSeconds: 15 * 60,
  undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0,
  longPauseThresholdSeconds: 60 * 60,
};

function configureCompleteCandidateRead() {
  const template = {
    id: "shift-published",
    teamId: null,
    isDefault: true,
    version: 1,
    status: "ACTIVE",
    timezone: "Asia/Baku",
    activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    retiredAt: null,
    definition: SHIFT_DEFINITION,
    definitionHash: workforceShiftDefinitionHash(SHIFT_DEFINITION),
  };
  const policy = {
    id: "policy-published",
    teamId: null,
    version: 1,
    status: "ACTIVE",
    name: "Baku standard",
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveTo: null,
    activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    retiredAt: null,
    definition: POLICY_DEFINITION,
    definitionHash: workforcePolicyDefinitionHash(POLICY_DEFINITION),
  };
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: AGENT_ID,
    teamId: "team-historical",
  } as never);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([
    {
      id: "membership-historical",
      teamId: "team-historical",
      effectiveAt: new Date("2026-08-01T00:00:00.000Z"),
    },
  ] as never);
  vi.mocked(prisma.workforceShiftAssignment.findMany).mockResolvedValue(
    [] as never,
  );
  vi.mocked(prisma.workforceShiftDefaultAssignment.findMany).mockResolvedValue([
    {
      id: "default-published",
      template,
    },
  ] as never);
  vi.mocked(prisma.workforcePolicy.findMany).mockResolvedValue([
    policy,
  ] as never);
  vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue({
    id: "segment-start",
  } as never);
}

describe("Workforce no-show candidate reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureCompleteCandidateRead();
  });

  it("creates only a review draft after complete historical configuration/calendar/workday reads", async () => {
    await expect(
      readWorkforceNoShowCandidate(prisma as never, {
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        workDate: WORK_DATE,
        asOf: AS_OF,
      }),
    ).resolves.toMatchObject({
      outcome: "REVIEW_CANDIDATE",
      expectedStartAt: "2026-09-01T05:00:00.000Z",
      caseDraft: {
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        kind: "NO_SHOW",
        links: { segmentId: "segment-start", expectedWorkDate: WORK_DATE },
      },
    });
    expect(prisma.mtmAgentWorkday.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        workDate: new Date("2026-09-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled();
    expect(prisma.mtmAuditLog.create).not.toHaveBeenCalled();
  });

  it("never proposes a case when the exact employee/day already has a workday", async () => {
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "existing-workday",
    } as never);

    await expect(
      readWorkforceNoShowCandidate(prisma as never, {
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        workDate: WORK_DATE,
        asOf: AS_OF,
      }),
    ).resolves.toMatchObject({
      outcome: "DO_NOT_CREATE",
      proposal: { code: "WORKFORCE_NO_SHOW_WORKDAY_EXISTS" },
    });
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled();
  });

  it("does not invent a generic case subject for an unsegmented published shift", async () => {
    vi.mocked(prisma.workforceShiftSegment.findFirst).mockResolvedValue(
      null as never,
    );

    await expect(
      readWorkforceNoShowCandidate(prisma as never, {
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        workDate: WORK_DATE,
        asOf: AS_OF,
      }),
    ).resolves.toEqual({
      outcome: "NOT_READY",
      code: "WORKFORCE_NO_SHOW_EXPECTATION_SUBJECT_UNAVAILABLE",
    });
    expect(prisma.workforceExceptionCase.create).not.toHaveBeenCalled();
  });

  it("does not query calendar or workday state on an unscheduled weekday", async () => {
    await expect(
      readWorkforceNoShowCandidate(prisma as never, {
        organizationId: ORGANIZATION_ID,
        agentId: AGENT_ID,
        workDate: "2026-09-05",
        asOf: new Date("2026-09-05T05:15:00.000Z"),
      }),
    ).resolves.toEqual({
      outcome: "NOT_READY",
      code: "WORKFORCE_NO_SHOW_EXPECTED_SHIFT_UNSCHEDULED",
    });
    expect(prisma.mtmWorkCalendarDay.findMany).not.toHaveBeenCalled();
    expect(prisma.mtmAgentWorkday.findFirst).not.toHaveBeenCalled();
  });
});
