import { NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { passwordPolicyError } from "@/lib/password-policy"
import { clientIp } from "@/lib/request-ip"
import { MOBILE_LOGIN_ORGANIZATION_SELECT } from "@/lib/mtm/mobile-login-phone"
import {
  linkedUserCredentials,
  mobileAppRefusal,
  mobileLoginSuccess,
  officeEmployeeMaySignIn,
  passwordSetupStillFresh,
  readPasswordSetupToken,
} from "@/lib/mtm/mobile-login-session"
import { codeFlowError, codeFlowRateLimit, readCodeFlowBody } from "@/lib/mtm/mobile-login-code-flow"

const SetPasswordSchema = z.object({
  setupToken: z.string().min(1).max(2048),
  password: z.string().min(1).max(1024),
}).strict()

function expired() {
  return codeFlowError(401, "MTM_PASSWORD_SETUP_EXPIRED", "Confirm your number again")
}

/**
 * POST /api/v1/mtm/mobile/auth/password
 * Body: { setupToken, password }
 *
 * After a code from WhatsApp: the person sets the password of their own card —
 * HR never knows it (owner, 2026-10-15). The password must pass the same
 * policy as everywhere else. Setting it changes the card's credential epoch,
 * which signs the card out on every other phone and spends the setup token;
 * then this phone is signed in exactly as the password form would sign it in.
 */
export async function POST(req: NextRequest) {
  try {
    return await runWithRlsBypass(async () => {
      const body = await readCodeFlowBody(req, SetPasswordSchema)
      if (!body.ok) return body.response
      const limited = await codeFlowRateLimit(req, "mtm-mobile-password-setup", clientIp(req), { ip: [20, 600], principal: [20, 600] })
      if (limited) return limited
      const setup = readPasswordSetupToken(body.value.setupToken)
      if (!setup) return expired()
      const weak = passwordPolicyError(body.value.password)
      if (weak) return codeFlowError(400, "MTM_PASSWORD_WEAK", weak)

      const row = await prisma.mtmAgent.findFirst({
        where: { id: setup.agentId, organizationId: setup.organizationId },
        include: { organization: { select: MOBILE_LOGIN_ORGANIZATION_SELECT } },
      })
      if (!row || row.status !== "ACTIVE" || !row.organization.isActive || !passwordSetupStillFresh(row, setup.fingerprint)) return expired()
      if (!(await officeEmployeeMaySignIn(row))) return expired()
      const refusal = mobileAppRefusal(row)
      if (refusal) return refusal

      const passwordHash = await bcrypt.hash(body.value.password, 12)
      // Compare-and-set on the old hash: two phones racing with one token set
      // one password, and the loser is told to confirm the number again.
      const changed = await prisma.mtmAgent.updateMany({
        where: { id: row.id, organizationId: row.organizationId, passwordHash: row.passwordHash },
        data: { passwordHash },
      })
      if (changed.count !== 1) return expired()
      const agent = { ...row, passwordHash }

      const linkedUser = agent.userId ? await linkedUserCredentials(agent, agent.userId) : null
      if (agent.userId && !linkedUser) return expired()
      await writeMtmAudit({
        organizationId: agent.organizationId,
        agentId: agent.id,
        action: "MOBILE_PASSWORD_SET_BY_CODE",
        entity: "agent",
        entityId: agent.id,
        metadataKind: "login_code",
        newData: { reason: "whatsapp_code" },
        req,
      }).catch(error => console.warn("[MTM/mobile/auth/password] audit failed", error))
      return mobileLoginSuccess(agent, agent.userId, linkedUser)
    })
  } catch (error) {
    console.error("[MTM/mobile/auth/password] failed", error)
    return codeFlowError(500, "MTM_PASSWORD_SETUP_FAILED", "The password could not be set")
  }
}
