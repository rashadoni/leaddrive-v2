import { NextRequest, NextResponse } from "next/server"

import { requireCronAuth } from "@/lib/cron-auth"
import { managerCanAnswer } from "@/lib/voice-agent/pharmacy/zeytun-line-host"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Whether a manager could take a transfer from Zeytun's line right now. The
 * tabs that would ring live on the web process (their shell-events streams),
 * while the line runs in its own process (pm2 `leaddrive-v2-line`), which asks
 * here on loopback. /api/cron/ is closed at nginx, so only this box can ask.
 */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const body = await req.json().catch(() => null) as { organizationId?: unknown } | null
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : ""
  if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 })
  return NextResponse.json({ canAnswer: await managerCanAnswer(organizationId, undefined, "local") })
}
