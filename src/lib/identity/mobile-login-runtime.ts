import type { PrismaClient } from "@prisma/client"
import { normalizeIdentityPhone } from "./contract"
import { identityRuntimeKeys } from "./runtime-keys"
import { authenticateIdentityMobilePassword, type IdentityMobilePasswordInput } from "./mobile-password-auth"
import { readIdentityMobileState, withIdentityMobileReadSnapshot } from "./mobile-session-resolver"
import { verifyIdentityMobileSession } from "./mobile-session"
import { readIdentityMobileTenantPolicy } from "./tenant-policy"

/** Called only after the existing distributed IP/principal login limits and
 * server-side tenant resolution. `LEGACY` is allowed only before irreversible
 * cutover; canonical refusal never retries an old card/User password. */
export async function identityMobileLogin(client: Pick<PrismaClient, "$transaction">, organizationId: string,
  input: IdentityMobilePasswordInput) {
  const phone = normalizeIdentityPhone(input.phone)
  if (!phone) return { status: "DENIED" as const }
  const selected = await withIdentityMobileReadSnapshot(client, organizationId, async tx => {
    const claim = await tx.identityPhoneClaim.findUnique({ where: { organizationId_normalizedPhone: { organizationId, normalizedPhone: phone } },
      select: { account: { select: { cutoverAt: true } } } })
    return !!claim?.account.cutoverAt
  })
  if (!selected.value) return { status: "LEGACY" as const }
  let ring
  try { ring = identityRuntimeKeys().mobile } catch { return { status: "UNAVAILABLE" as const } }
  if (!ring) return { status: "UNAVAILABLE" as const }
  const signed = await authenticateIdentityMobilePassword(client, organizationId, { ...input, phone }, ring.active)
  if (!signed) return { status: "DENIED" as const }
  const snapshot = await withIdentityMobileReadSnapshot(client, organizationId, async tx => {
    const state = await readIdentityMobileState(tx, organizationId, signed.context.userId, input.application, readIdentityMobileTenantPolicy)
    const card = await tx.mtmAgent.findFirst({ where: { organizationId, id: signed.context.actorId, userId: signed.context.userId },
      select: { id: true, name: true, email: true, role: true, avatar: true, attendanceParticipant: true, attendanceExcluded: true } })
    const company = await tx.organization.findFirst({ where: { id: organizationId }, select: { name: true } })
    if (!state || !card || !company || card.role !== state.grant?.role
      || (input.application === "TIME" && (card.role !== "EMPLOYEE" || !card.attendanceParticipant || card.attendanceExcluded))
      || (input.application === "ROUTE_FIELD" && card.role === "EMPLOYEE")) return null
    return { state, agent: { id: card.id, name: card.name, email: card.email, phone, role: card.role, avatar: card.avatar,
      organizationId, organizationName: company.name } }
  })
  if (!snapshot.value || !verifyIdentityMobileSession(signed.token, input.application, snapshot.value.state, ring.resolve, snapshot.now)) return { status: "DENIED" as const }
  return { status: "AUTHENTICATED" as const, data: { token: signed.token, agent: snapshot.value.agent, application: input.application } }
}
