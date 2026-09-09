// Canary "disable" step (runbook Step 6 part 2, confirm-gated). Returns the
// brandprotection paid-run policy to the safe posture: manual runs off,
// emergency stop on, all caps 0. Pair with step=routing-off (env flags).

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true, settings: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)
  const admin = await prisma.user.findFirst({
    where: { organizationId: org.id, role: { in: ["admin", "superadmin"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  const actorId = admin?.id ?? "canary-ci-operator"
  const settings = org.settings && typeof org.settings === "object" && !Array.isArray(org.settings) ? org.settings : {}
  const current = settings.socialMonitoringPaidRuns && typeof settings.socialMonitoringPaidRuns === "object" ? settings.socialMonitoringPaidRuns : {}
  const nowIso = new Date().toISOString()
  const next = {
    ...current,
    manualRunsEnabled: false,
    emergencyStopped: true,
    maxPerRunUsd: 0,
    dailyBudgetUsd: 0,
    monthlyBudgetUsd: 0,
    policyVersion: Math.max(1, Math.trunc(Number(current.policyVersion) || 1)) + 1,
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
      oldValue: current, newValue: { ...next, via: "canary-disable" },
    },
  })
  console.log(`[disable] policy back to safe posture (caps 0, emergency stop on) v${next.policyVersion}`)
}

main()
  .catch((err) => { console.error("[disable] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
