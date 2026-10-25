import { finishIdentityMobileRecovery } from "@/lib/identity/mobile-recovery-runtime"
import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { withLegacyCredentialWrite } from "@/lib/identity/legacy-credential-write"
import { readLegacyPhoneCredentialBoundaryInTransaction } from "@/lib/identity/legacy-credential-boundary"
import { readAttendanceFeature } from "@/lib/mtm/attendance-feature"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { passwordPolicyError } from "@/lib/password-policy"
import { clientIp } from "@/lib/request-ip"
import { MOBILE_LOGIN_ORGANIZATION_SELECT } from "@/lib/mtm/mobile-login-phone"
import {
  mobileAppRefusal,
  mobileLoginSuccess,
  legacyMobileMaySignIn,
  passwordSetupStillFresh,
  readPasswordSetupToken,
} from "@/lib/mtm/mobile-login-session"
import { codeFlowError, codeFlowRateLimit, readCodeFlowBody, OrganizationSlug, companyBySlug, NO_STORE } from "@/lib/mtm/mobile-login-code-flow"

const SetPasswordSchema = z.object({
  organizationSlug: OrganizationSlug.optional(),
  application: z.enum(["TIME", "ROUTE_FIELD"]).optional(),
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
      if (body.value.setupToken.startsWith("lds")) {
        const { setupToken, password, organizationSlug, application } = body.value
        if (!setupToken.startsWith("lds3.") || !organizationSlug || !application) return expired()
        const weak = passwordPolicyError(password)
        if (weak) return codeFlowError(400, "MTM_PASSWORD_WEAK", weak)
        const organization = await companyBySlug(organizationSlug)
        if (!organization) return expired()
        const recovery = await finishIdentityMobileRecovery(prisma, organization.id, { setupToken, application, password }, passwordPolicyError)
        if (recovery.status !== "AUTHENTICATED") return expired()
        return NextResponse.json({ success: true, data: recovery.data }, { headers: NO_STORE })
      }
      const setup = readPasswordSetupToken(body.value.setupToken)
      if (!setup) return expired()
      const weak = passwordPolicyError(body.value.password)
      if (weak) return codeFlowError(400, "MTM_PASSWORD_WEAK", weak)

      const row = await prisma.mtmAgent.findFirst({
        where: { id: setup.agentId, organizationId: setup.organizationId },
        include: { organization: { select: MOBILE_LOGIN_ORGANIZATION_SELECT } },
      })
      if (!row || row.status !== "ACTIVE" || !row.organization.isActive || !passwordSetupStillFresh(row, setup.fingerprint)) return expired()
      if (!(await legacyMobileMaySignIn(row, setup.phone))) return expired()
      const refusal = mobileAppRefusal(row)
      if (refusal) return refusal

      const passwordHash = await bcrypt.hash(body.value.password, 12)
      const changed = await runWithTenant(row.organizationId, () => withLegacyCredentialWrite(prisma, row.organizationId,
        [{ kind: "ACTOR", actorId: row.id }], async tx => {
          const fresh = await tx.mtmAgent.findFirst({
            where: { id: row.id, organizationId: row.organizationId },
            include: { organization: { select: MOBILE_LOGIN_ORGANIZATION_SELECT } },
          })
          if (!fresh || fresh.status !== "ACTIVE" || fresh.userId !== row.userId
            || !fresh.organization.isActive || !passwordSetupStillFresh(fresh, setup.fingerprint)) return null
          if (fresh.role === "EMPLOYEE" && (!fresh.userId || !fresh.attendanceParticipant
            || !await readAttendanceFeature(tx, fresh.organizationId))) return null
          if (mobileAppRefusal(fresh)) return null
          if (await readLegacyPhoneCredentialBoundaryInTransaction(tx, fresh.organizationId, fresh.id, setup.phone) !== "LEGACY") return null
          const linkedUser = fresh.userId ? await tx.user.findFirst({
            where: { id: fresh.userId, organizationId: fresh.organizationId, isActive: true, anonymizedAt: null },
            select: { id: true, passwordHash: true, passwordChangedAt: true },
          }) : null
          if (fresh.userId && !linkedUser) return null
          // Authority, actor ownership, setup fingerprint and CAS are checked
          // under the same transaction/tenant lock as canonical writers.
          const result = await tx.mtmAgent.updateMany({
            where: { id: fresh.id, organizationId: fresh.organizationId, passwordHash: fresh.passwordHash },
            data: { passwordHash },
          })
          if (result.count !== 1) return null
          await writeMtmAudit({
            organizationId: fresh.organizationId,
            agentId: fresh.id,
            action: "MOBILE_PASSWORD_SET_BY_CODE",
            entity: "agent",
            entityId: fresh.id,
            metadataKind: "login_code",
            newData: { reason: "whatsapp_code" },
            req,
          }, tx)
          return { agent: { ...fresh, passwordHash }, linkedUser }
        }))
      if (!changed.allowed || !changed.value) return expired()
      return mobileLoginSuccess(changed.value.agent, changed.value.agent.userId, changed.value.linkedUser)
    })
  } catch (error) {
    console.error("[MTM/mobile/auth/password] failed", error)
    return codeFlowError(500, "MTM_PASSWORD_SETUP_FAILED", "The password could not be set")
  }
}
