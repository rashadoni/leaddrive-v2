import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * Returns the VAPID public key so the browser can call pushManager.subscribe.
 * Endpoint is authenticated — only CRM agents need it.
 */
export const GET = withRlsAuth("inbox", "read", async (_req, auth, ctx) => {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) {
    return NextResponse.json({ success: false, error: "VAPID not configured" }, { status: 503 })
  }
  return NextResponse.json({ success: true, data: { publicKey: key } })
})
