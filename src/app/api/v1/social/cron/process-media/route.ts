import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { processMediaQueue } from "@/lib/social/media-pipeline"

export async function POST(request: NextRequest) {
  const authError = requireCronAuth(request)
  if (authError) return authError
  const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? "20")
  const data = await runWithRlsBypass(() => processMediaQueue(rawLimit))
  return NextResponse.json({ success: data.failed === 0, data }, { status: data.failed === 0 ? 200 : 207 })
}
