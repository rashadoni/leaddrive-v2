// Operator script, READ-ONLY: which tenants will feel the visit-policy switch
// start working?
//
// Until this change `visitPoliciesEnabled=false` only hid the rule editor;
// active rules kept being snapshotted at check-in and kept blocking check-out.
// After it, an organization with the switch OFF gets the no-rule fallback
// (legacy `photoRequired` only). A tenant listed here has switch OFF and at
// least one active, currently effective rule — its agents will stop being
// asked for those actions on the next check-in after deploy. Decide per
// tenant before deploying: turn the switch on (keep enforcement) or accept.
//
// The flag defaults to ON, so only an explicitly stored false/"false" counts.
// Prints organization id, name and rule counts only — no people.
//
// Env: DATABASE_URL, CONFIRM_PROD=1 when pointing at production.
// Run:  CONFIRM_PROD=1 node scripts/mtm-visit-policies-disabled-with-active-rules.mjs
import { makeScriptPrisma } from "./_rls.mjs"

if (process.env.CONFIRM_PROD !== "1") {
  throw new Error("Set CONFIRM_PROD=1 to confirm the target database (this script only reads)")
}

// Cross-tenant listing → the script helper's RLS bypass session.
const prisma = await makeScriptPrisma()
try {
  const disabledRows = await prisma.mtmSetting.findMany({
    where: { key: "visitPoliciesEnabled" },
    select: { organizationId: true, value: true },
  })
  const disabledOrgIds = disabledRows
    .filter((row) => row.value === false || row.value === "false")
    .map((row) => row.organizationId)

  const now = new Date()
  const rules = disabledOrgIds.length
    ? await prisma.mtmVisitPolicy.findMany({
        where: {
          organizationId: { in: disabledOrgIds },
          isActive: true,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        },
        select: { organizationId: true, actions: { where: { mode: "REQUIRED" }, select: { id: true } } },
      })
    : []

  const byOrg = new Map()
  for (const rule of rules) {
    const entry = byOrg.get(rule.organizationId) ?? { activeRules: 0, requiredActions: 0 }
    entry.activeRules += 1
    entry.requiredActions += rule.actions.length
    byOrg.set(rule.organizationId, entry)
  }
  const orgs = byOrg.size
    ? await prisma.organization.findMany({ where: { id: { in: [...byOrg.keys()] } }, select: { id: true, name: true } })
    : []

  console.log(`visitPoliciesEnabled=false stored for ${disabledOrgIds.length} organization(s)`)
  if (!orgs.length) {
    console.log("No organization has the switch off with active rules — deploy changes nothing for anyone.")
  } else {
    console.log("Switch OFF but active rules present (enforcement stops after deploy):")
    console.table(orgs.map((org) => ({ organizationId: org.id, name: org.name, ...byOrg.get(org.id) })))
  }
} finally {
  await prisma.$disconnect()
}
