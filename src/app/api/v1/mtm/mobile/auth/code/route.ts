import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { runWithRlsBypass } from "@/lib/rls-context"
import { phoneDigits } from "@/lib/mtm/mobile-login-phone"
import {
  MOBILE_LOGIN_CODE_RESEND_SECONDS,
  MOBILE_LOGIN_CODE_TTL_SECONDS,
  issueMobileLoginCode,
  secondsUntilResend,
  withdrawMobileLoginCode,
} from "@/lib/mtm/mobile-login-code"
import { loginCodeSender, loginCodeTemporarilyUnavailable, sendLoginCodeToWhatsApp } from "@/lib/mtm/whatsapp-login-code"
import {
  EnteredPhone,
  NO_STORE,
  OrganizationSlug,
  auditCodeFlow,
  codeFlowError,
  codeFlowRateLimit,
  codeHolder,
  companyBySlug,
  readCodeFlowBody,
} from "@/lib/mtm/mobile-login-code-flow"

const RequestCodeSchema = z.object({
  organizationSlug: OrganizationSlug,
  phone: EnteredPhone,
  language: z.enum(["az", "ru", "en"]).optional(),
}).strict()

function sent(resendAfterSeconds: number) {
  return NextResponse.json(
    { success: true, data: { sent: true, resendAfterSeconds, expiresInSeconds: MOBILE_LOGIN_CODE_TTL_SECONDS } },
    { headers: NO_STORE },
  )
}

function unavailable() {
  return codeFlowError(503, "MTM_LOGIN_CODE_UNAVAILABLE", "Codes cannot be sent to WhatsApp right now")
}

/**
 * POST /api/v1/mtm/mobile/auth/code
 * Body: { organizationSlug, phone, language? }
 *
 * Sends a sign-in code to the WhatsApp of the person in this company with this
 * number (owner, 2026-10-15). Pre-auth, like the password form beside it.
 * The answer is «sent» whether or not the number belongs to anybody.
 */
export async function POST(req: NextRequest) {
  try {
    return await runWithRlsBypass(async () => {
      const body = await readCodeFlowBody(req, RequestCodeSchema)
      if (!body.ok) return body.response
      const { organizationSlug, phone, language } = body.value
      const limited = await codeFlowRateLimit(req, "mtm-mobile-login-code", `${organizationSlug}:${phoneDigits(phone)}`, {
        ip: [10, 600],
        principal: [5, 3600],
      })
      if (limited) return limited

      const organization = await companyBySlug(organizationSlug)
      if (!organization) return codeFlowError(404, "MTM_COMPANY_NOT_FOUND", "Company not found")
      // Decided before the number is looked at, so it says nothing about it.
      if (loginCodeTemporarilyUnavailable()) return unavailable()
      const sender = await loginCodeSender()
      if (!sender) return unavailable()

      const holder = await codeHolder(organization, phone)
      if (holder.kind === "nobody") {
        if (holder.reason !== "no_card") await auditCodeFlow(req, organization.id, null, "MOBILE_LOGIN_CODE_NOT_SENT", phone, { reason: holder.reason })
        return sent(MOBILE_LOGIN_CODE_RESEND_SECONDS)
      }
      const { agent, sendTo } = holder
      const wait = await secondsUntilResend(organization.id, sendTo)
      if (wait > 0) return sent(wait)

      const issued = await issueMobileLoginCode(organization.id, sendTo)
      const delivery = await sendLoginCodeToWhatsApp(sender, { to: sendTo, code: issued.code, language })
      if (delivery.status === "sent") {
        await auditCodeFlow(req, organization.id, agent.id, "MOBILE_LOGIN_CODE_SENT", sendTo, { messageId: delivery.messageId, language: delivery.language })
        return sent(MOBILE_LOGIN_CODE_RESEND_SECONDS)
      }
      await withdrawMobileLoginCode(issued.id)
      await auditCodeFlow(req, organization.id, agent.id, "MOBILE_LOGIN_CODE_FAILED", sendTo, { status: delivery.status, reason: delivery.reason })
      if (delivery.status === "unavailable") return unavailable()
      // Our side or the network failed — not something about the number.
      if (delivery.reason === "network" || delivery.reason === "timeout" || delivery.reason.startsWith("http_5")) {
        return codeFlowError(502, "MTM_LOGIN_CODE_SEND_FAILED", "The code could not be sent; try again")
      }
      return sent(MOBILE_LOGIN_CODE_RESEND_SECONDS)
    })
  } catch (error) {
    console.error("[MTM/mobile/auth/code] failed", error)
    return codeFlowError(500, "MTM_LOGIN_CODE_FAILED", "The code could not be sent")
  }
}
