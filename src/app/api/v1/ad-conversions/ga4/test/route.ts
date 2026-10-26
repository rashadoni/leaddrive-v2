/**
 * «Test hadisəsi göndər» for GA4: one custom `leaddrive_test` event in debug
 * mode. It shows in GA4 → Admin → DebugView within a minute and is not a lead
 * event, so no conversion counts it. It is the only proof that the API secret
 * is right: Google's collect endpoint answers 2xx either way.
 */
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { decryptDestinationSecret, findDestination } from "@/lib/ad-conversions/destination"
import { ga4TestBody, sendGa4Event } from "@/lib/ad-conversions/ga4"

export const POST = withRlsAuth("settings", "write", async (_req, auth) => {
  const destination = await findDestination(auth.orgId, "ga4")
  if (!destination) return NextResponse.json({ error: "Not configured", code: "NOT_CONFIGURED" }, { status: 409 })
  try {
    await sendGa4Event({ measurementId: destination.publicId, apiSecret: decryptDestinationSecret(auth.orgId, destination.secretCiphertext), body: ga4TestBody(new Date()) })
    return NextResponse.json({ success: true })
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Send failed"
    return NextResponse.json({ error: reason, reason }, { status: 502 })
  }
})
