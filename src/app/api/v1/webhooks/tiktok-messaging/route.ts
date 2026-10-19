import { NextRequest, NextResponse } from "next/server"
import { messagingConfig } from "@/lib/tiktok-messaging/config"
import { parseMessagingInbound, verifyMessagingWebhook } from "@/lib/tiktok-messaging/webhook"
import { ingestMessagingInbound } from "@/lib/tiktok-messaging/ingest"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  let config: ReturnType<typeof messagingConfig>
  try { config = messagingConfig() } catch { return NextResponse.json({ error: "Unavailable" }, { status: 503 }) }
  // Bound reads even without Content-Length (chunked requests).
  const reader = request.body?.getReader()
  if (!reader) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 1_048_576) { await reader.cancel(); return NextResponse.json({ error: "Body too large" }, { status: 413 }) }
      chunks.push(value)
    }
  } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }) }
  const envelope = verifyMessagingWebhook(Buffer.concat(chunks).toString("utf8"), request.headers.get("tiktok-signature"), config.clientSecret)
  if (!envelope || envelope.client_key !== config.clientId) return NextResponse.json({ error: "Invalid signature or app" }, { status: 401 })
  const event = parseMessagingInbound(envelope, config.clientId)
  if (!event) return NextResponse.json({ success: true, ignored: true })
  try {
    await ingestMessagingInbound(event, config.clientId)
    return NextResponse.json({ success: true })
  } catch {
    // Acknowledging a failed durable write would discard the message. Never log payloads.
    return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 })
  }
}
