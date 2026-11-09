import { NextRequest, NextResponse } from "next/server"

import { requireCronAuth } from "@/lib/cron-auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Loads Da Vinci's chat code into this process before anyone asks it a
 * question. The deploy calls it right after the new web process listens.
 *
 * Measured 2026-11-08 on production: the first question after a deploy
 * waited 13.2 s for its first word, the next one 1.2 s. A route's modules load
 * on its first request, and the chat route pulls in the whole tool layer —
 * 1.7 s in a fresh process on production, measured 2026-11-09. An anonymous
 * request cannot do this for us: the proxy answers it with a redirect to
 * /login before the route is ever loaded, which is why the deploy's other
 * warm-ups (the phone station's routes) do not cover the chat.
 *
 * Nothing is read and the model is not called: warming must cost nothing and
 * touch no tenant. The server bundle shares one module cache, so the chat
 * route finds these modules already evaluated.
 */
export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const started = Date.now()
  try {
    await Promise.all([
      import("@/app/api/v1/ai/chat/route"),
      // Loaded lazily by the tool executor on the first read tool call.
      import("@/lib/ai/read-tool-executor"),
    ])
  } catch (error) {
    console.error("[ai-chat-warm] failed:", error instanceof Error ? error.message : typeof error)
    return NextResponse.json({ outcome: "failed", ms: Date.now() - started }, { status: 502 })
  }
  return NextResponse.json({ outcome: "warm", ms: Date.now() - started })
}
