/**
 * Online card payment for invoices — the organization's Kapital Bank merchant
 * account (src/lib/payments/kapitalbank/config.ts).
 *
 *   GET  → { configured, isActive, isTestMode, login, hasPassword } — never the password
 *   PUT  → { login, password?, isTestMode, isActive }
 *
 * Turning payments on is checked against the bank first: the pair opens a
 * 0.01 AZN order that nobody pays (it expires at the bank). A wrong pair is
 * refused before anything is stored, so the invoice page never offers a «Pay»
 * button that the bank would turn away. Turning them off asks the bank
 * nothing.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { isTenantPiiMasterKeyConfigured } from "@/lib/crypto/tenant-pii-encryption"
import { createKapitalOrder, KapitalBankError } from "@/lib/payments/kapitalbank/client"
import { loadKapitalConfig, readKapitalSettings, saveKapitalConfig } from "@/lib/payments/kapitalbank/config"

const saveSchema = z.object({
  login: z.string().trim().min(1).max(200),
  password: z.string().max(500).optional(),
  isTestMode: z.boolean(),
  isActive: z.boolean(),
}).strict()

export const GET = withRlsAuth("settings", "read", async (_req, { orgId }) => {
  try {
    return NextResponse.json({ success: true, data: await readKapitalSettings(orgId) })
  } catch (e) {
    console.error("[settings/online-payment] read failed", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsAuth("settings", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId
  const body = await req.json().catch(() => null)
  const parsed = saveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  if (!isTenantPiiMasterKeyConfigured()) {
    return NextResponse.json({ error: "Encryption key is not configured", code: "NO_ENCRYPTION_KEY" }, { status: 503 })
  }

  try {
    const input = parsed.data
    const newPassword = input.password?.trim() ? input.password : undefined
    const stored = newPassword ? null : await loadKapitalConfig(orgId)
    const password = newPassword ?? stored?.password
    if (!password) {
      return NextResponse.json({ error: "Password is required", code: "PASSWORD_REQUIRED" }, { status: 400 })
    }

    if (input.isActive) {
      const refused = await checkWithBank({ login: input.login, password, isTestMode: input.isTestMode })
      if (refused) return refused
    }

    await saveKapitalConfig(orgId, {
      login: input.login,
      password: newPassword,
      isTestMode: input.isTestMode,
      isActive: input.isActive,
      userId: auth.userId ?? null,
    })
    return NextResponse.json({ success: true, data: await readKapitalSettings(orgId) })
  } catch (e) {
    console.error("[settings/online-payment] save failed", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/** Open a 0.01 AZN order that nobody pays. Null when the bank accepted the pair. */
async function checkWithBank(creds: { login: string; password: string; isTestMode: boolean }): Promise<NextResponse | null> {
  try {
    await createKapitalOrder(creds, {
      amount: 0.01,
      currency: "AZN",
      description: "LeadDrive connection check",
      language: "az",
      redirectUrl: `${(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "")}/`,
    })
    return null
  } catch (error) {
    if (error instanceof KapitalBankError && error.code === "InvalidLogin") {
      return NextResponse.json({ error: "Kapital Bank rejected the login or password", code: "INVALID_CREDENTIALS" }, { status: 400 })
    }
    console.error("[settings/online-payment] bank check failed", error instanceof KapitalBankError ? error.code : error)
    return NextResponse.json({ error: "Kapital Bank did not answer", code: "BANK_UNREACHABLE" }, { status: 502 })
  }
}
