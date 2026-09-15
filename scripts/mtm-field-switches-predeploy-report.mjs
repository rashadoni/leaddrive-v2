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
// The flag is parsed like getMtmSettings does (src/lib/mtm/setting-values.ts):
// boolean as is, a string is on only when it is "true", a missing row is ON.
//
// Second report, same deploy: check-in now clamps a geofence radius to the
// NEAREST bound of 25..10000 m in every path (web used the raw value, sync
// turned anything out of range into 100 m). It counts, per organization,
// customers and the organization geofenceRadius setting outside that range.
//
// Prints organization id, name and counts only — no people.
//
// Env: DATABASE_URL, CONFIRM_PROD=1 when pointing at production.
// Run:  CONFIRM_PROD=1 node scripts/mtm-field-switches-predeploy-report.mjs
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
    // Same rule as coerceMtmBooleanSetting(value, true).
    .filter((row) => row.value != null && (typeof row.value === "boolean" ? !row.value : typeof row.value === "string" && row.value !== "true"))
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

  // ── Geofence radii outside 25..10000 m ────────────────────────────────────
  const outOfRange = { OR: [{ geofenceRadius: { lt: 25 } }, { geofenceRadius: { gt: 10_000 } }] }
  const customerGroups = await prisma.mtmCustomer.groupBy({
    by: ["organizationId"],
    where: { deletedAt: null, geofenceRadius: { not: null }, ...outOfRange },
    _count: { _all: true },
    _min: { geofenceRadius: true },
    _max: { geofenceRadius: true },
  })
  const orgRadiusRows = await prisma.mtmSetting.findMany({
    where: { key: "geofenceRadius" },
    select: { organizationId: true, value: true },
  })
  const badOrgRadius = orgRadiusRows.filter((row) => {
    if (row.value == null) return false
    const n = Number(row.value)
    return Number.isFinite(n) && (n < 25 || n > 10_000)
  })
  const geofenceOrgIds = [...new Set([...customerGroups.map((g) => g.organizationId), ...badOrgRadius.map((r) => r.organizationId)])]
  const geofenceOrgs = geofenceOrgIds.length
    ? await prisma.organization.findMany({ where: { id: { in: geofenceOrgIds } }, select: { id: true, name: true } })
    : []
  if (!geofenceOrgs.length) {
    console.log("No customer or organization geofence radius outside 25..10000 m.")
  } else {
    console.log("Geofence radius outside 25..10000 m (clamped to the nearest bound after deploy):")
    console.table(geofenceOrgs.map((org) => {
      const group = customerGroups.find((g) => g.organizationId === org.id)
      const setting = badOrgRadius.find((r) => r.organizationId === org.id)
      return {
        organizationId: org.id,
        name: org.name,
        customersOutOfRange: group?._count._all ?? 0,
        customerMinRadius: group?._min.geofenceRadius ?? null,
        customerMaxRadius: group?._max.geofenceRadius ?? null,
        orgGeofenceRadiusSetting: setting ? setting.value : null,
      }
    }))
  }
} finally {
  await prisma.$disconnect()
}
