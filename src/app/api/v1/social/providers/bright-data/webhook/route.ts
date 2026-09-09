import { NextRequest, NextResponse } from "next/server"
import {
  applyBrightDataWebhook,
  decodeBrightDataWebhookBody,
  validateBrightDataWebhookTransport,
} from "@/lib/social/bright-data-webhook"

export async function POST(request: NextRequest) {
  const transport = validateBrightDataWebhookTransport(request.headers)
  if (!transport.valid) {
    return NextResponse.json({ error: transport.reason }, { status: transport.status })
  }
  const runId = request.nextUrl.searchParams.get("runId")?.trim() ?? ""
  let payload: unknown
  try {
    payload = decodeBrightDataWebhookBody(new Uint8Array(await request.arrayBuffer()))
  } catch (error) {
    const reason = error instanceof Error ? error.message : "bright_data_webhook_payload_invalid"
    return NextResponse.json({ error: reason }, {
      status: reason === "bright_data_webhook_payload_too_large" ? 413 : 400,
    })
  }
  const result = await applyBrightDataWebhook({
    runId,
    authorizationHeader: request.headers.get("authorization"),
    payload,
  })
  if (result.status === "UNAUTHORIZED") {
    return NextResponse.json({ error: "invalid_webhook" }, { status: 401 })
  }
  if (result.status === "INVALID_PAYLOAD") {
    return NextResponse.json({ error: result.reason }, { status: 400 })
  }
  if (result.status === "STALE") {
    return NextResponse.json({ error: result.reason }, { status: 409 })
  }
  return NextResponse.json({ success: true, data: result })
}
