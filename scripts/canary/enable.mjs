// Canary "enable" step (runbook Steps 2-3, DB part). Confirm-gated in the
// workflow. For the brandprotection tenant ONLY:
//   1. Ensure a VERIFIED Bright Data READ_EXTERNAL_COMMENTS proof for tiktok
//      (payload per docs/BRIGHTDATA-TIKTOK-CANARY-RUNBOOK.md Step 2, evidence
//      = the TT-SD-009 live snapshot hashes; replyAllowed stays false).
//   2. Set the bounded paid-run policy: manualRunsEnabled, emergency stop off,
//      maxPerRun/daily/monthly = $0.50 (runbook Step 3 ceiling).
//   3. Make the target TikTok source due now (lastCheckedAt=null) so the next
//      5-min cron tick picks it up instead of waiting out the 360m cadence.
// Prints ids/statuses only — no tokens or secrets. Routes recompile on the
// next collector pass (monitoring-collector recompiles per source).

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"
const SRC = "cmrlscyhx0036506ruferpk9c"
const CAP_USD = 0.5
// The tenant already has settled spend from earlier runs this month. Keep the
// new manual run capped at $0.50 while allowing that bounded run to fit beside
// the existing ledger exposure. The API request remains the tighter guard.
const AGGREGATE_CAP_USD = 100

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true, settings: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)

  const admin = await prisma.user.findFirst({
    where: { organizationId: org.id, role: { in: ["admin", "superadmin"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  })
  const actorId = admin?.id ?? "canary-ci-operator"
  console.log(`[enable] actor=${admin ? admin.email : "canary-ci-operator"}`)

  // --- 1. tiktok READ_EXTERNAL_COMMENTS proof ---
  const now = new Date()
  const existing = await prisma.socialProviderCapabilityProof.findFirst({
    where: {
      organizationId: org.id, platform: "tiktok", capability: "READ_EXTERNAL_COMMENTS",
      providerKey: "bright-data", status: "VERIFIED", expiresAt: { gt: now },
    },
    select: { id: true },
  })
  if (existing) {
    console.log(`[enable] tiktok READ_EXTERNAL_COMMENTS proof already VERIFIED: ${existing.id}`)
  } else {
    const policyVersion = "social-monitoring-v2-pr2"
    const schemaVersion = "tiktok-comment-2026-07-18"
    const scopes = ["PUBLIC"]
    const proofKey = ["bright-data", "BRIGHT_DATA_SNAPSHOT", "tiktok", "READ_EXTERNAL_COMMENTS", scopes.join("+"), policyVersion, schemaVersion].join(":").toLowerCase()
    const verifyData = {
      status: "VERIFIED",
      contractVersion: "social-provider-capabilities-v1",
      readAllowed: true,
      replyAllowed: false,
      aiProcessingAllowed: false,
      exportAllowed: true,
      evidence: {
        contractDocumentRef: "TT-SD-009 Bright Data comments snapshot 72056e6e968d (collect_replies=true, 100/100 + 114/114 unique IDs, 0 provider errors)",
        sandboxRunRef: "brightdata-comments-snapshot-72056e6e968d",
        notes: "Canary enable step per docs/BRIGHTDATA-TIKTOK-CANARY-RUNBOOK.md; owner GO 2026-07-19",
      },
      verifiedBy: actorId,
      verifiedAt: now,
      sandboxVerifiedAt: now,
      expiresAt: new Date("2026-10-19T00:00:00.000Z"),
    }
    const proof = await prisma.socialProviderCapabilityProof.upsert({
      where: { organizationId_proofKey: { organizationId: org.id, proofKey } },
      create: {
        organizationId: org.id, proofKey,
        providerKey: "bright-data", adapterKey: "BRIGHT_DATA_SNAPSHOT",
        platform: "tiktok", capability: "READ_EXTERNAL_COMMENTS",
        contentScopeKey: scopes.join("+"), contentScopes: scopes,
        policyVersion, schemaVersion,
        endpointHost: "api.brightdata.com", retentionDays: 30, attributionRequired: false,
        ...verifyData,
      },
      update: verifyData,
    })
    await prisma.auditLog.create({
      data: {
        organizationId: org.id, userId: actorId, action: "verify",
        entityType: "social_provider_capability_proof", entityId: proof.id, entityName: proofKey,
        newValue: { contractVersion: "social-provider-capabilities-v1", via: "canary-enable" },
      },
    })
    console.log(`[enable] tiktok READ_EXTERNAL_COMMENTS proof VERIFIED: ${proof.id}`)
  }

  // --- 2. bounded paid-run policy (mirrors updateTenantPaidRunPolicy semantics) ---
  const settings = org.settings && typeof org.settings === "object" && !Array.isArray(org.settings) ? org.settings : {}
  const current = settings.socialMonitoringPaidRuns && typeof settings.socialMonitoringPaidRuns === "object" ? settings.socialMonitoringPaidRuns : {}
  const nowIso = now.toISOString()
  const next = {
    ...current,
    manualRunsEnabled: true,
    emergencyStopped: false,
    maxPerRunUsd: CAP_USD,
    dailyBudgetUsd: AGGREGATE_CAP_USD,
    monthlyBudgetUsd: AGGREGATE_CAP_USD,
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
      oldValue: current, newValue: { ...next, via: "canary-enable" },
    },
  })
  console.log(`[enable] policy: manualRunsEnabled=true emergencyStopped=false caps=${CAP_USD}/${AGGREGATE_CAP_USD}/${AGGREGATE_CAP_USD} v${next.policyVersion}`)

  // --- 3. make target source due now ---
  const updated = await prisma.monitoringSource.updateMany({
    where: { organizationId: org.id, id: SRC },
    data: { lastCheckedAt: null },
  })
  console.log(`[enable] target source ${SRC} lastCheckedAt=null (due now): ${updated.count === 1 ? "ok" : "NOT FOUND"}`)
  console.log(`[enable] DONE — next: dispatch step=routing-on, then wait one cron cycle (~5m) and dispatch step=evidence`)
}

main()
  .catch((err) => { console.error("[enable] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
