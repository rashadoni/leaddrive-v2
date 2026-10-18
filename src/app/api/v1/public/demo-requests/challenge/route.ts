import { NextResponse } from "next/server"
import { issueDemoFormChallenge } from "@/lib/demo-center/form-challenge"
import { withDemoRequestCors } from "@/lib/demo-request-cors"

/**
 * A fresh bot check for the demo request form (src/lib/demo-center/form-challenge.ts).
 * Stateless and cheap — nothing is stored until a request arrives with it —
 * and behind the proxy's public GET limit like every other public answer.
 */
export function GET(request: Request) {
  return withDemoRequestCors(
    request,
    NextResponse.json(issueDemoFormChallenge(), { headers: { "Cache-Control": "no-store" } }),
  )
}
