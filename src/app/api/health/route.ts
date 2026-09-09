import { NextResponse } from "next/server"

// Shallow liveness probe for nginx / PM2. Returns 200 as long as the Next.js
// process is alive and can execute route handlers. Does NOT check database
// connectivity — a deep readiness check belongs on a separate endpoint so a
// DB flake cannot cause the process to be killed by an over-eager restart.
export async function GET() {
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  )
}
