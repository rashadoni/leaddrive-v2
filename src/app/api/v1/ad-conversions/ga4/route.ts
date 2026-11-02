/**
 * Save the Google Analytics 4 destination. Turning sending on needs the
 * consent statement and a measurement id + API secret that Google's
 * validation server accepts (it records nothing). Whether the secret itself
 * is right shows only in GA4: «Test hadisəsi göndər» puts a debug event in
 * DebugView.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { isTenantPiiMasterKeyConfigured } from "@/lib/crypto/tenant-pii-encryption"
import { decryptDestinationSecret, destinationView, findDestination, saveDestination } from "@/lib/ad-conversions/destination"
import { buildGa4Body, Ga4Error, isMeasurementId, validateGa4 } from "@/lib/ad-conversions/ga4"

const saveSchema = z.object({
  publicId: z.string().trim().toUpperCase().refine(isMeasurementId, "INVALID_MEASUREMENT_ID"),
  secret: z.string().max(200).optional(),
  sendLeads: z.boolean(),
  sendWins: z.boolean(),
  isActive: z.boolean(),
  consent: z.boolean(),
}).strict()

export const PUT = withRlsAuth("settings", "write", async (req, auth) => {
  const parsed = saveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const invalidId = parsed.error.issues.some((issue) => issue.message === "INVALID_MEASUREMENT_ID")
    return NextResponse.json({ error: parsed.error.issues[0].message, code: invalidId ? "INVALID_MEASUREMENT_ID" : "INVALID" }, { status: 400 })
  }
  const input = parsed.data
  if (input.isActive && !input.consent) return NextResponse.json({ error: "Consent statement is required", code: "CONSENT_REQUIRED" }, { status: 400 })
  if (!isTenantPiiMasterKeyConfigured()) return NextResponse.json({ error: "Encryption key is not configured", code: "NO_ENCRYPTION_KEY" }, { status: 503 })
  const newSecret = input.secret?.trim() ? input.secret.trim() : undefined
  const existing = await findDestination(auth.orgId, "ga4")
  const secret = newSecret ?? (existing ? decryptDestinationSecret(auth.orgId, existing.secretCiphertext) : undefined)
  if (!secret) return NextResponse.json({ error: "API secret is required", code: "SECRET_REQUIRED" }, { status: 400 })

  if (input.isActive) {
    try {
      await validateGa4({ measurementId: input.publicId, apiSecret: secret, body: buildGa4Body({ eventName: "lead", eventTime: new Date(), entityId: "check" }) })
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Google refused"
      const network = error instanceof Ga4Error && error.code === "network"
      return NextResponse.json({ error: reason, reason, code: network ? "UNREACHABLE" : "INVALID_KEY" }, { status: network ? 502 : 400 })
    }
  }

  await saveDestination(auth.orgId, auth.userId ?? null, "ga4", {
    publicId: input.publicId,
    secret: newSecret,
    testEventCode: null,
    sendLeads: input.sendLeads,
    sendWins: input.sendWins,
    isActive: input.isActive,
    consent: input.consent,
  })
  return NextResponse.json({ success: true, data: await destinationView(auth.orgId, "ga4") })
})
