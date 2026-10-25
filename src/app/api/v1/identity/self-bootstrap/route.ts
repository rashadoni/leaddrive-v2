import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { passwordPolicyError } from "@/lib/password-policy"
import { requireIdentityAdministrator } from "@/lib/identity/administrator-request"
import { IdentityRegistryError } from "@/lib/identity/contract"
import { identityRuntimeKeys } from "@/lib/identity/runtime-keys"
import { reviewIdentitySelfBootstrap, requestIdentitySelfBootstrap, confirmIdentitySelfBootstrap, finishIdentitySelfBootstrap,
  IdentitySelfBootstrapRequest } from "@/lib/identity/self-bootstrap"
import { dispatchStagedPhoneProof } from "@/lib/identity/phone-proof-dispatch"
import { claimStagedPhoneProofDelivery, recordStagedPhoneProofDelivery } from "@/lib/identity/phone-proof-registry"
import { codeFlowRateLimit } from "@/lib/mtm/mobile-login-code-flow"
import { loginCodeSender, loginCodeTemporarilyUnavailable, sendLoginCodeToWhatsApp } from "@/lib/mtm/whatsapp-login-code"
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" }
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), phone: z.string().min(7).max(40) }).strict(),
  IdentitySelfBootstrapRequest.extend({ action: z.literal("request"), language: z.enum(["az", "ru", "en"]).optional() }).strict(),
  z.object({ action: z.literal("confirm"), proofId: id, code: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ action: z.literal("finish"), setupToken: z.string().min(1).max(320), password: z.string().min(1).max(72) }).strict(),
])
export async function POST(req: NextRequest) {
  const administrator = await requireIdentityAdministrator(req)
  if (administrator instanceof NextResponse) return administrator
  if (administrator.mode !== "LEGACY") return NextResponse.json({ error: "IDENTITY_SELF_BOOTSTRAP_UNAVAILABLE" }, { status: 409, headers })
  const body = await readJsonRequestWithinLimit(req, 4096), parsed = body.ok ? input.safeParse(body.value) : null
  if (!parsed?.success) return NextResponse.json({ error: "IDENTITY_SELF_BOOTSTRAP_INPUT_INVALID" }, { status: !body.ok && body.reason === "too_large" ? 413 : 400, headers })
  const value = parsed.data
  const limited = await codeFlowRateLimit(req, `identity-self-bootstrap-${value.action}`, `${administrator.organizationId}:${administrator.userId}`, {
    ip: [20, 600], principal: value.action === "request" ? [5, 3600] : [20, 600],
  })
  if (limited) return limited
  try {
    return await runWithTenant(administrator.organizationId, async () => {
      const keys = identityRuntimeKeys()
      if (!keys.proof || !keys.mobile) throw new IdentityRegistryError("IDENTITY_ACTIVATION_RUNTIME_UNAVAILABLE")
      if (value.action === "review") return NextResponse.json({ success: true, data: await reviewIdentitySelfBootstrap(prisma, administrator, value.phone) }, { headers })
      if (value.action === "request") {
        if (loginCodeTemporarilyUnavailable()) throw new IdentityRegistryError("IDENTITY_CODE_DELIVERY_UNAVAILABLE")
        const sender = await loginCodeSender()
        if (!sender) throw new IdentityRegistryError("IDENTITY_CODE_DELIVERY_UNAVAILABLE")
        const { phone, sourceRevision, requestId, language } = value
        const proof = await requestIdentitySelfBootstrap(prisma, administrator, { phone, sourceRevision, requestId }, keys.proof.active)
        const delivery = await dispatchStagedPhoneProof(administrator.organizationId, proof.proofId, {
          claim: (org, id) => claimStagedPhoneProofDelivery(prisma, org, id),
          record: (org, receipt) => recordStagedPhoneProofDelivery(prisma, org, receipt), resolveKey: keys.proof.resolve,
          send: async ({ to, code, signal }) => {
            const sent = await sendLoginCodeToWhatsApp(sender, { to, code, language }, { signal })
            return sent.status === "sent" && sent.messageId ? { status: "SENT", providerMessageId: sent.messageId }
              : { status: sent.status === "unavailable" ? "FAILED" : "UNCERTAIN" }
          },
        })
        return NextResponse.json({ success: true, data: { ...proof, delivery: delivery.status } }, { headers })
      }
      if (value.action === "confirm") {
        const confirmed = await confirmIdentitySelfBootstrap(prisma, administrator, value.proofId, value.code, keys.proof.resolve)
        if (confirmed.status !== "CONFIRMED" || !("setupToken" in confirmed)) return NextResponse.json({ error: "IDENTITY_CODE_INVALID" }, { status: 401, headers })
        return NextResponse.json({ success: true, data: { setupToken: confirmed.setupToken } }, { headers })
      }
      if (passwordPolicyError(value.password)) return NextResponse.json({ error: "IDENTITY_PASSWORD_WEAK" }, { status: 400, headers })
      await finishIdentitySelfBootstrap(prisma, administrator, { setupToken: value.setupToken, password: value.password }, keys.proof.resolve, passwordPolicyError)
      // Old cookie is deliberately invalid after cutover; no session is minted.
      return NextResponse.json({ success: true, data: { signInRequired: true } }, { headers })
    })
  } catch (error) {
    const known = error instanceof IdentityRegistryError
    return NextResponse.json({ error: known ? error.code : "IDENTITY_SELF_BOOTSTRAP_FAILED" }, { status: known ? error.code === "IDENTITY_ADMIN_REQUIRED" ? 403 : 409 : 500, headers })
  }
}
