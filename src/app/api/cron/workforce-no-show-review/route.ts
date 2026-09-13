import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runScheduledWorkforceNoShowReview } from "@/lib/workforce/no-show-review-scheduler";

// This endpoint is intentionally absent from the deployment cron schedule.
// Even a CRON_SECRET request cannot create a case unless the exact tenant has
// separately enabled the review-only no-show rollout fence.
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req);
  if (cronError) return cronError;

  try {
    const result = await runScheduledWorkforceNoShowReview();
    return NextResponse.json(
      { success: true, data: result },
      {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    console.error(
      "[CRON/workforce-no-show-review]",
      error instanceof Error ? error.name : "unknown",
    );
    return NextResponse.json(
      { error: "Workforce no-show review failed" },
      {
        status: 500,
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
}
