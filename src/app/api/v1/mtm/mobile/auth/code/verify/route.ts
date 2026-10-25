import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { runWithRlsBypass } from "@/lib/rls-context"
import { phoneDigits } from "@/lib/mtm/mobile-login-phone"
import { checkMobileLoginCode } from "@/lib/mtm/mobile-login-code"
import { signPasswordSetupToken } from "@/lib/mtm/mobile-login-session"
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

const VerifyCodeSchema = z.object({
  organizationSlug: OrganizationSlug,
  phone: EnteredPhone,
  code: z.string().trim().regex(/^\d{6}$/),
}).strict()

const REFUSAL = {
  invalid: { code: "MTM_LOGIN_CODE_INVALID", error: "Wrong code" },
  expired: { code: "MTM_LOGIN_CODE_EXPIRED", error: "The code has expired; ask for a new one" },
  locked: { code: "MTM_LOGIN_CODE_LOCKED", error: "Too many wrong codes; ask for a new one" },
} as const

function refused(reason: keyof typeof REFUSAL) {
  return codeFlowError(400, REFUSAL[reason].code, REFUSAL[reason].error)
}

/**
 * POST /api/v1/mtm/mobile/auth/code/verify
 * Body: { organizationSlug, phone, code }
 *
 * The code from WhatsApp proves the number. It does not sign anybody in: it
 * buys a quarter of an hour to set one's own password (…/auth/password), and
 * that sign-in is the one the password form gives.
 */
export async function POST(req: NextRequest) {
  try {
    return await runWithRlsBypass(async () => {
      const body = await readCodeFlowBody(req, VerifyCodeSchema)
      if (!body.ok) return body.response
      const { organizationSlug, phone, code } = body.value
      const limited = await codeFlowRateLimit(req, "mtm-mobile-login-code-verify", `${organizationSlug}:${phoneDigits(phone)}`, {
        ip: [20, 600],
        principal: [10, 600],
      })
      if (limited) return limited

      const organization = await companyBySlug(organizationSlug)
      if (!organization) return codeFlowError(404, "MTM_COMPANY_NOT_FOUND", "Company not found")
      const holder = await codeHolder(organization, phone)
      // Nobody to sign in: answered as a wrong code — no code was ever sent.
      if (holder.kind === "nobody") return refused("invalid")

      const check = await checkMobileLoginCode(organization.id, holder.sendTo, code)
      if (!check.ok) {
        await auditCodeFlow(req, organization.id, holder.agent.id, "MOBILE_LOGIN_CODE_REJECTED", holder.sendTo, { reason: check.reason })
        return refused(check.reason)
      }
      await auditCodeFlow(req, organization.id, holder.agent.id, "MOBILE_LOGIN_CODE_ACCEPTED", holder.sendTo)
      return NextResponse.json({
        success: true,
        data: {
          setupToken: signPasswordSetupToken(holder.agent, holder.sendTo),
          agent: { name: holder.agent.name },
          organizationName: organization.name,
        },
      }, { headers: NO_STORE })
    })
  } catch (error) {
    console.error("[MTM/mobile/auth/code/verify] failed", error)
    return codeFlowError(500, "MTM_LOGIN_CODE_FAILED", "The code could not be checked")
  }
}
