// Owner-authorized (2026-07-19, after the proven positive-path canary run):
// raise the brandprotection paid-run caps to effectively non-blocking values.
// The real spend bound is the prepaid Bright Data balance, topped up by the
// owner. Code ceilings (100 / 10k / 100k) still apply upstream.

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"
const CAPS = { maxPerRunUsd: 100, dailyBudgetUsd: 10000, monthlyBudgetUsd: 100000 }

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true, settings: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)
  const admin = await prisma.user.findFirst({
    where: { organizationId: org.id, role: { in: ["admin", "superadmin"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  })
  const actorId = admin?.id ?? "canary-ci-operator"
  const settings = org.settings && typeof org.settings === "object" && !Array.isArray(org.settings) ? org.settings : {}
  const current = settings.socialMonitoringPaidRuns && typeof settings.socialMonitoringPaidRuns === "object" ? settings.socialMonitoringPaidRuns : {}
  const nowIso = new Date().toISOString()
  const next = {
    ...current,
    manualRunsEnabled: true,
    emergencyStopped: false,
    ...CAPS,
    policyVersion: Math.max(1, Math.trunc(Number(current.policyVersion) || 1)) + 1,
    authorizedAt: nowIso,
    authorizedBy: actorId,
    updatedAt: nowIso,
    updatedBy: actorId,
  }
  await prisma.organization.update({
    where: { id: org.id },
    data: { settings: { ...settings, socialMonitoringPaidRuns: next } },
  })
  await prisma.auditLog.create({
    data: {
      organizationId: org.id, userId: actorId, action: "update",
      entityType: "social_paid_run_policy", entityId: org.id,
      oldValue: current, newValue: { ...next, via: "canary-raise-limits", ownerAuthorization: "chat 2026-07-19 remove limits" },
    },
  })
  console.log(`[raise-limits] caps now ${CAPS.maxPerRunUsd}/${CAPS.dailyBudgetUsd}/${CAPS.monthlyBudgetUsd} USD (perRun/day/month) v${next.policyVersion}, actor=${admin?.email ?? actorId}`)
}

main()
  .catch((err) => { console.error("[raise-limits] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
