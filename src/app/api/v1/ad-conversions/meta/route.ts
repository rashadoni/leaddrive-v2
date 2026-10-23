/**
 * Save the Meta destination. Turning sending on needs the consent statement
 * («my forms collect consent») and a token that may send to the pixel —
 * checked with Meta before anything is stored.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { isTenantPiiMasterKeyConfigured } from "@/lib/crypto/tenant-pii-encryption"
import {
  decryptDestinationSecret,
  findMetaDestination,
  metaDestinationView,
  saveMetaDestination,
} from "@/lib/ad-conversions/destination"
import { checkMetaToken, MetaApiError, metaAccessRefusal } from "@/lib/ad-conversions/meta"

const saveSchema = z.object({
  publicId: z.string().trim().regex(/^\d{5,25}$/, "INVALID_PIXEL"),
  secret: z.string().max(1000).optional(),
  testEventCode: z.string().trim().max(40).optional().nullable(),
  sendLeads: z.boolean(),
  sendWins: z.boolean(),
  isActive: z.boolean(),
  consent: z.boolean(),
}).strict()

export const PUT = withRlsAuth("settings", "write", async (req: NextRequest, auth) => {
  const parsed = saveSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message, code: parsed.error.issues[0].message === "INVALID_PIXEL" ? "INVALID_PIXEL" : "INVALID" }, { status: 400 })
  const input = parsed.data
  if (input.isActive && !input.consent) {
    return NextResponse.json({ error: "Consent statement is required", code: "CONSENT_REQUIRED" }, { status: 400 })
  }
  if (!isTenantPiiMasterKeyConfigured()) {
    return NextResponse.json({ error: "Encryption key is not configured", code: "NO_ENCRYPTION_KEY" }, { status: 503 })
  }
  const newSecret = input.secret?.trim() ? input.secret.trim() : undefined
  const existing = await findMetaDestination(auth.orgId)
  const token = newSecret ?? (existing ? decryptDestinationSecret(auth.orgId, existing.secretCiphertext) : undefined)
  if (!token) return NextResponse.json({ error: "Access token is required", code: "SECRET_REQUIRED" }, { status: 400 })

  if (input.isActive) {
    try {
      await checkMetaToken(input.publicId, token)
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Meta refused"
      if (error instanceof MetaApiError && error.code === "network") {
        return NextResponse.json({ error: reason, code: "UNREACHABLE" }, { status: 502 })
      }
      const refused = error instanceof MetaApiError ? metaAccessRefusal(error) : null
      return NextResponse.json({ error: reason, reason, code: refused === "pixel" ? "NO_PIXEL_ACCESS" : "INVALID_KEY" }, { status: 400 })
    }
  }

  await saveMetaDestination(auth.orgId, auth.userId ?? null, {
    publicId: input.publicId,
    secret: newSecret,
    testEventCode: input.testEventCode,
    sendLeads: input.sendLeads,
    sendWins: input.sendWins,
    isActive: input.isActive,
    consent: input.consent,
  })
  return NextResponse.json({ success: true, data: await metaDestinationView(auth.orgId) })
})
