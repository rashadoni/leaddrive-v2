import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobLeaseStore } from "@/lib/cron/job-lease";

const {
  readWorkforceNoShowCandidateBatch,
  materializeAuthorizedWorkforceNoShowReviewCaseInTransaction,
} = vi.hoisted(() => ({
  readWorkforceNoShowCandidateBatch: vi.fn(),
  materializeAuthorizedWorkforceNoShowReviewCaseInTransaction: vi.fn(),
}));

vi.mock("@/lib/workforce/no-show-candidate-batch", () => ({
  readWorkforceNoShowCandidateBatch,
}));
vi.mock("@/lib/workforce/no-show-case-materializer", () => ({
  materializeAuthorizedWorkforceNoShowReviewCaseInTransaction,
}));

import {
  runScheduledWorkforceNoShowReview,
  WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME,
  type WorkforceScheduledNoShowReviewResult,
} from "@/lib/workforce/no-show-review-scheduler";

const NOW = new Date("2026-09-01T09:00:00.000Z");

function leaseStore(acquired = true): JobLeaseStore {
  return {
    acquire: vi.fn().mockResolvedValue(acquired),
    renew: vi.fn().mockResolvedValue(true),
    recordSkipped: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
  };
}

function schedulerDb(
  input: {
    cursorRows?: Array<{ cursor: string | null; version: number }>;
    cursorUpsertError?: Error;
    organizations?: Array<Record<string, unknown> | null>;
  } = {},
) {
  const organization = {
    id: "org-workforce",
    isActive: true,
    plan: "professional",
    addons: [],
    features: ["workforce-hrm", "workforce-no-show-review-v1"],
    modules: {},
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue(
      input.cursorRows ?? [
        {
          cursor: null,
          version: 1,
        },
      ],
    ),
    systemJobCursor: {
      upsert: input.cursorUpsertError
        ? vi.fn().mockRejectedValue(input.cursorUpsertError)
        : vi.fn().mockResolvedValue({ name: WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME }),
      update: vi.fn().mockResolvedValue({ name: WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME }),
    },
    organization: {
      findUnique: vi.fn().mockResolvedValue(organization),
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(input.organizations?.[0] ?? organization)
        .mockResolvedValueOnce(input.organizations?.[1] ?? null),
    },
    mtmAuditLog: {
      create: vi.fn().mockResolvedValue({ id: "audit-scheduled-review" }),
    },
  };
  const db = {
    $transaction: vi.fn(
      async (handler: (value: typeof tx) => unknown) => await handler(tx),
    ),
  };
  return { db, tx };
}

function expectCursorUpdate(
  tx: ReturnType<typeof schedulerDb>["tx"],
  state: Record<string, string | null>,
) {
  expect(tx.systemJobCursor.update).toHaveBeenCalledWith({
    where: { name: WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME },
    data: {
      cursor: JSON.stringify(state),
      version: { increment: 1 },
    },
  });
}

describe("Workforce scheduled no-show review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the lease/cursor and materializes only review candidates for an explicitly opted-in tenant", async () => {
    const { db, tx } = schedulerDb();
    readWorkforceNoShowCandidateBatch.mockResolvedValue({
      candidates: [
        { agentId: "agent-a", result: { outcome: "REVIEW_CANDIDATE" } },
        { agentId: "agent-b", result: { outcome: "DO_NOT_CREATE" } },
      ],
      morePending: true,
      nextCursorAgentId: "agent-b",
    });
    materializeAuthorizedWorkforceNoShowReviewCaseInTransaction.mockResolvedValue({
      outcome: "REVIEW_CASE_RECORDED",
      caseId: "case-a",
      idempotent: false,
      expectedStartAt: "2026-08-31T05:00:00.000Z",
    });

    const result = await runScheduledWorkforceNoShowReview({
      db: db as never,
      leaseStore: leaseStore(),
      now: NOW,
    });

    expect(result).toEqual<WorkforceScheduledNoShowReviewResult>({
      skipped: null,
      cursorBusy: false,
      notDue: false,
      workDate: "2026-08-31",
      tenantsConsidered: 1,
      workforceTenantsConsidered: 1,
      reviewEnabledTenantsScanned: 1,
      candidatesEvaluated: 2,
      reviewCandidates: 1,
      reviewCasesRecorded: 1,
      idempotentCases: 0,
      morePending: true,
    });
    expect(tx.systemJobCursor.upsert).toHaveBeenCalledWith({
      where: { name: WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME },
      create: { name: WORKFORCE_NO_SHOW_REVIEW_SCHEDULER_JOB_NAME, cursor: null },
      update: {},
    });
    expect(readWorkforceNoShowCandidateBatch).toHaveBeenCalledWith(tx, {
      organizationId: "org-workforce",
      workDate: "2026-08-31",
      asOf: NOW,
      afterAgentId: null,
      limit: 20,
    });
    expect(materializeAuthorizedWorkforceNoShowReviewCaseInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        organizationId: "org-workforce",
        agentId: "agent-a",
        workDate: "2026-08-31",
        asOf: NOW,
      }),
    );
    const authorize = materializeAuthorizedWorkforceNoShowReviewCaseInTransaction.mock
      .calls[0]?.[0]?.authorize as (input: unknown) => Promise<boolean>;
    await expect(
      authorize({
        operation: "CASE_CREATE",
        organizationId: "org-workforce",
        agentId: "agent-a",
      }),
    ).resolves.toBe(true);
    await expect(
      authorize({
        operation: "CASE_CREATE",
        organizationId: "org-workforce",
        agentId: "agent-b",
      }),
    ).resolves.toBe(false);
    await expect(
      authorize({
        operation: "DECISION_APPEND",
        organizationId: "org-workforce",
        caseId: "case-a",
        actorUserId: "user-a",
      }),
    ).resolves.toBe(false);
    expectCursorUpdate(tx, {
      activeWorkDate: "2026-08-31",
      lastCompletedWorkDate: null,
      lastOrganizationId: "org-workforce",
      lastAgentId: "agent-b",
    });
    const audit = tx.mtmAuditLog.create.mock.calls[0]?.[0]?.data;
    expect(audit.newData).toEqual({
      source: "SCHEDULED_REVIEW_ONLY",
      workDate: "2026-08-31",
      candidatesEvaluated: 2,
      reviewCandidates: 1,
      reviewCasesRecorded: 1,
      idempotentCases: 0,
    });
    expect(JSON.stringify(audit)).not.toMatch(
      /agent-a|case-a|latitude|longitude|qr|device|reason/i,
    );
  });

  it("does not read an employee or create a case when Workforce is enabled but the no-show write fence is absent", async () => {
    const { db, tx } = schedulerDb({
      organizations: [
        {
          id: "org-workforce",
          isActive: true,
          plan: "professional",
          addons: [],
          features: ["workforce-hrm"],
          modules: {},
        },
        null,
      ],
    });

    await expect(
      runScheduledWorkforceNoShowReview({
        db: db as never,
        leaseStore: leaseStore(),
        now: NOW,
      }),
    ).resolves.toMatchObject({
      workforceTenantsConsidered: 1,
      reviewEnabledTenantsScanned: 0,
      candidatesEvaluated: 0,
      reviewCasesRecorded: 0,
      morePending: false,
    });
    expect(readWorkforceNoShowCandidateBatch).not.toHaveBeenCalled();
    expect(
      materializeAuthorizedWorkforceNoShowReviewCaseInTransaction,
    ).not.toHaveBeenCalled();
    expect(tx.mtmAuditLog.create).not.toHaveBeenCalled();
    expectCursorUpdate(tx, {
      activeWorkDate: null,
      lastCompletedWorkDate: "2026-08-31",
      lastOrganizationId: null,
      lastAgentId: null,
    });
  });

  it("stays idle after it has already completed the immediately preceding UTC date", async () => {
    const { db, tx } = schedulerDb({
      cursorRows: [
        {
          cursor: JSON.stringify({
            activeWorkDate: null,
            lastCompletedWorkDate: "2026-08-31",
            lastOrganizationId: null,
            lastAgentId: null,
          }),
          version: 4,
        },
      ],
    });

    await expect(
      runScheduledWorkforceNoShowReview({
        db: db as never,
        leaseStore: leaseStore(),
        now: NOW,
      }),
    ).resolves.toMatchObject({
      notDue: true,
      workDate: null,
      tenantsConsidered: 0,
    });
    expect(tx.organization.findFirst).not.toHaveBeenCalled();
    expect(readWorkforceNoShowCandidateBatch).not.toHaveBeenCalled();
    expect(tx.systemJobCursor.update).not.toHaveBeenCalled();
  });

  it("fails closed before scanning when the shared cursor migration is absent", async () => {
    const migrationError = new Error("relation system_job_cursors does not exist");
    const { db, tx } = schedulerDb({ cursorUpsertError: migrationError });

    await expect(
      runScheduledWorkforceNoShowReview({
        db: db as never,
        leaseStore: leaseStore(),
        now: NOW,
      }),
    ).rejects.toThrow(migrationError);
    expect(tx.organization.findFirst).not.toHaveBeenCalled();
    expect(readWorkforceNoShowCandidateBatch).not.toHaveBeenCalled();
  });

  it("fails closed on malformed opaque cursor state before tenant inspection", async () => {
    const { db, tx } = schedulerDb({ cursorRows: [{ cursor: "{broken", version: 1 }] });

    await expect(
      runScheduledWorkforceNoShowReview({
        db: db as never,
        leaseStore: leaseStore(),
        now: NOW,
      }),
    ).rejects.toThrow("WORKFORCE_NO_SHOW_REVIEW_CURSOR_INVALID");
    expect(tx.organization.findFirst).not.toHaveBeenCalled();
    expect(readWorkforceNoShowCandidateBatch).not.toHaveBeenCalled();
  });

  it("returns a bounded busy result when another transaction holds the cursor row", async () => {
    const { db, tx } = schedulerDb({ cursorRows: [] });

    await expect(
      runScheduledWorkforceNoShowReview({
        db: db as never,
        leaseStore: leaseStore(),
        now: NOW,
      }),
    ).resolves.toMatchObject({
      cursorBusy: true,
      candidatesEvaluated: 0,
      reviewCasesRecorded: 0,
    });
    expect(tx.organization.findFirst).not.toHaveBeenCalled();
    expect(readWorkforceNoShowCandidateBatch).not.toHaveBeenCalled();
  });
});
