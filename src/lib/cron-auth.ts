// src/lib/cron-auth.ts
import { timingSafeEqual } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { enterRlsBypass } from "./rls-context"

/** Constant-time string compare — journeys/process already used timingSafeEqual; the choke point must not downgrade it. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/**
 * Shared guard for cron-shaped routes (the RLS bypass choke point — the CI
 * classifier in src/__tests__/rls-bypass-classifier.test.ts is written
 * against THIS function; do not re-inline secret checks in routes).
 *
 * Returns null on success (and binds RLS bypass to the request) or a
 * NextResponse error: 503 when CRON_SECRET is unset, 401 on mismatch.
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 })
  }
  const provided =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace("Bearer ", "")
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  enterRlsBypass()
  return null
}
