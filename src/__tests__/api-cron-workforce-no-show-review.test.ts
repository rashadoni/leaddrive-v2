import { workforceLogFailures } from "./fixtures/workforce-log-failures"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { requireCronAuth, runScheduledWorkforceNoShowReview } = vi.hoisted(
  () => ({
    requireCronAuth: vi.fn(),
    runScheduledWorkforceNoShowReview: vi.fn(),
  }),
);

vi.mock("@/lib/cron-auth", () => ({ requireCronAuth }));
vi.mock("@/lib/workforce/no-show-review-scheduler", () => ({
  runScheduledWorkforceNoShowReview,
}));

import { POST } from "@/app/api/cron/workforce-no-show-review/route";

function request() {
  return new NextRequest("http://localhost/api/cron/workforce-no-show-review", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCronAuth.mockReturnValue(null);
  runScheduledWorkforceNoShowReview.mockResolvedValue({
    skipped: null,
    cursorBusy: false,
    notDue: true,
    workDate: null,
    tenantsConsidered: 0,
    workforceTenantsConsidered: 0,
    reviewEnabledTenantsScanned: 0,
    candidatesEvaluated: 0,
    reviewCandidates: 0,
    reviewCasesRecorded: 0,
    idempotentCases: 0,
    morePending: false,
  });
});

describe("POST /api/cron/workforce-no-show-review", () => {
  it.each(workforceLogFailures)("logs only a fixed event for $kind and preserves generic no-store failure", async ({ make }) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    runScheduledWorkforceNoShowReview.mockRejectedValueOnce(make())
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    await expect(response.json()).resolves.toEqual({ error: "Workforce no-show review failed" })
    expect(runScheduledWorkforceNoShowReview).toHaveBeenCalledOnce()
    expect(log.mock.calls).toEqual([["[workforce/privacy] sensitive operation failed", { operation: "run-no-show-review" }]])
    expect(JSON.stringify(log.mock.calls)).not.toContain("WORKFORCE_PRIVATE_CANARY")
  })

  it("does not enter the write-capable worker when the shared CRON_SECRET boundary rejects", async () => {
    requireCronAuth.mockReturnValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(runScheduledWorkforceNoShowReview).not.toHaveBeenCalled();
  });

  it("returns only aggregate no-store worker status after the shared cron boundary accepts", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        notDue: true,
        candidatesEvaluated: 0,
        reviewCasesRecorded: 0,
      },
    });
    expect(runScheduledWorkforceNoShowReview).toHaveBeenCalledOnce();
  });

  it("contains an unexpected worker failure without exposing details or cacheable output", async () => {
    runScheduledWorkforceNoShowReview.mockRejectedValueOnce(new Error("sensitive tenant detail"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({ error: "Workforce no-show review failed" });
  });
});

afterEach(() => vi.restoreAllMocks())
