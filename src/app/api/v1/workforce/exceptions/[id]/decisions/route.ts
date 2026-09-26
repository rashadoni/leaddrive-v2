import { NextResponse } from "next/server"
import { withWorkforceSessionAuth } from "@/lib/with-workforce-rls-auth"
import { workforceSensitiveResponseHeaders } from "@/lib/workforce/sensitive-response"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * The early C6 foundation accepted a database case id in the URL. Manager
 * actions now use the fixed, body-only `/workforce/exception-decisions`
 * endpoint and an encrypted action/revision token issued by the scoped queue.
 * Keep this tombstone indistinguishable for every id so old callers cannot
 * retain a tokenless mutation path or use it as a case-existence oracle.
 */
export const POST = withWorkforceSessionAuth<RouteContext>("write", async () => NextResponse.json({
  error: "This Workforce exception decision endpoint is unavailable",
  code: "WORKFORCE_EXCEPTION_DECISION_ACTION_TOKEN_REQUIRED",
}, { status: 404, headers: workforceSensitiveResponseHeaders }))
