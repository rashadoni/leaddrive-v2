import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sendOtp } from "@/lib/sms"
import { getOrgId } from "@/lib/api-auth"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { checkRateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/request-ip"

const schema = z.object({
  phone: z.string().min(7).max(20).regex(/^\+?[\d\s-()]+$/, "Invalid phone"),
  purpose: z.enum(["login", "2fa", "verification", "sensitive_action"]),
})

// Anti-SMS-bombing limits: a phone can receive at most 3 codes per 10 min,
// and a single IP can trigger at most 10 sends per 10 min across all phones.
const OTP_WINDOW_MS = 10 * 60 * 1000
const PER_PHONE_LIMIT = 3
const PER_IP_LIMIT = 10

/**
 * POST /api/v1/auth/sms-otp/send
 * Sends a one-time code to the given phone number.
 * orgId is optional — pre-auth flows (signup) may omit it.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const normalizedPhone = parsed.data.phone.replace(/[\s\-()]/g, "")
  // clientIp(), not x-forwarded-for. nginx appends to XFF rather than replacing
  // it, so element [0] is whatever the caller sent — a fresh `otp:ip:` bucket
  // per request, i.e. no per-IP ceiling at all, and this endpoint spends real
  // money per SMS. clientIp() reads x-real-ip (set from $remote_addr) and only
  // honours cf-connecting-ip when the peer is genuinely a Cloudflare address.
  const ip = clientIp(req)

  // Per-phone throttle — prevents spamming one number
  const phoneOk = checkRateLimit(`otp:phone:${normalizedPhone}`, {
    maxRequests: PER_PHONE_LIMIT,
    windowMs: OTP_WINDOW_MS,
  })
  if (!phoneOk) {
    return NextResponse.json(
      { error: "Too many codes requested for this number. Try again later." },
      { status: 429 }
    )
  }

  // Per-IP throttle — prevents one attacker spamming many numbers
  const ipOk = checkRateLimit(`otp:ip:${ip}`, {
    maxRequests: PER_IP_LIMIT,
    windowMs: OTP_WINDOW_MS,
  })
  if (!ipOk) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 }
    )
  }

  const orgId = await getOrgId(req).catch(() => null)

  // The OTP write runs under tenant context when an orgId is present; the pre-auth
  // signup path (no orgId) runs under runWithRlsBypass so the otp_codes INSERT
  // (organizationId=null) passes the RLS WITH CHECK once RLS is enabled on otp_codes.
  // Without the bypass, the no-org OTP send would fail-closed under RLS.
  const doSend = () => sendOtp({
    phone: normalizedPhone,
    purpose: parsed.data.purpose,
    organizationId: orgId || undefined,
  })
  const result = orgId ? await runWithTenant(orgId, doSend) : await runWithRlsBypass(doSend)

  if (!result.success) {
    return NextResponse.json({ error: result.error || "Failed to send code" }, { status: 500 })
  }

  // In development we echo the code to aid local testing. Never in production.
  return NextResponse.json({
    success: true,
    ...(result.debugCode ? { debugCode: result.debugCode } : {}),
  })
}
