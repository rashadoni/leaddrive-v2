import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { verifyOtp } from "@/lib/sms"
import { getOrgId } from "@/lib/api-auth"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"

const schema = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().regex(/^\d{4,8}$/, "Code must be 4-8 digits"),
  purpose: z.enum(["login", "2fa", "verification", "sensitive_action"]),
})

/**
 * POST /api/v1/auth/sms-otp/verify
 * Verifies a one-time code for the given phone+purpose.
 * Returns 200 on success, 400 on invalid, 429 after too many attempts.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const normalizedPhone = parsed.data.phone.replace(/[\s\-()]/g, "")

  // verifyOtp reads AND updates otp_codes; under RLS those ops fail-closed without
  // context. Mirror the send path: org-present (logged-in 2FA) → runWithTenant;
  // no-org (signup/login) → runWithRlsBypass so the null-org OTP row is visible +
  // updatable. Send and verify share the same request context, so this org/no-org
  // choice matches whatever created the OTP. The wrapper encloses the WHOLE call
  // (the findFirst read + the attempts/usedAt updates all hit the policy).
  const orgId = await getOrgId(req).catch(() => null)
  const doVerify = () => verifyOtp(normalizedPhone, parsed.data.code, parsed.data.purpose)
  const result = orgId ? await runWithTenant(orgId, doVerify) : await runWithRlsBypass(doVerify)

  if (!result.success) {
    const status = result.error === "Too many attempts" ? 429 : 400
    return NextResponse.json({ error: result.error || "Invalid code" }, { status })
  }

  return NextResponse.json({ success: true })
}
