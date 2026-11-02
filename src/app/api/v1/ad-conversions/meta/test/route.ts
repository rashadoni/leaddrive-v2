/**
 * «Test hadisəsi göndər»: one Lead event with the destination's test event
 * code, so it shows under Events Manager → Test events and is not counted as
 * a real conversion. Without a test code nothing is sent.
 */
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { decryptDestinationSecret, findMetaDestination } from "@/lib/ad-conversions/destination"
import { buildMetaEvent, MetaApiError, sendMetaEvents } from "@/lib/ad-conversions/meta"

export const POST = withRlsAuth("settings", "write", async (req, auth) => {
  const destination = await findMetaDestination(auth.orgId)
  if (!destination) return NextResponse.json({ error: "Not configured", code: "NOT_CONFIGURED" }, { status: 409 })
  if (!destination.testEventCode) return NextResponse.json({ error: "Test event code is required", code: "TEST_CODE_REQUIRED" }, { status: 400 })
  const event = buildMetaEvent({
    eventId: `leaddrive:test:${Date.now()}`,
    eventName: "Lead",
    eventTime: new Date(),
    email: "test@leaddrivecrm.org",
    attribution: { userAgent: req.headers.get("user-agent") ?? "LeadDrive" },
  })
  try {
    const result = await sendMetaEvents({
      pixelId: destination.publicId,
      accessToken: decryptDestinationSecret(auth.orgId, destination.secretCiphertext),
      events: [event!],
      testEventCode: destination.testEventCode,
    })
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    const reason = error instanceof MetaApiError ? error.message : "Send failed"
    return NextResponse.json({ error: reason, reason }, { status: 502 })
  }
})
