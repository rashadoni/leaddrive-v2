// Seed realistic, BACKDATED MTM audit-log events into an existing tenant so the
// Route & Field → Activity Journal (/mtm/activity) has a populated timeline,
// period-scoped KPIs, and a non-zero compliance lens (forced check-ins + failed
// logins). No other seed writes mtm_audit_logs — those rows only appear from
// real mobile actions — so the redesigned journal is empty without this.
//
// Idempotent: every row is tagged newData._seed = MARK; re-running skips unless
// --force. Only ADDS demo rows; never edits/deletes real data.
//
// Usage (on the server, DATABASE_URL = prod):
//   CONFIRM_PROD=1 node scripts/seeds/leaddrive-activity-log.mjs --slug=leaddrive
//   CONFIRM_PROD=1 node scripts/seeds/leaddrive-activity-log.mjs --slug=leaddrive --force

import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()

if (!process.env.CONFIRM_PROD) {
  console.error("Refusing to run without CONFIRM_PROD=1. Re-run:\n  CONFIRM_PROD=1 node scripts/seeds/leaddrive-activity-log.mjs --slug=leaddrive")
  process.exit(1)
}

const getArg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? null
const hasFlag = (n) => process.argv.includes(`--${n}`)
const SLUG = getArg("slug") || "leaddrive"
const MARK = "[activity-demo]"

const org = await prisma.organization.findUnique({ where: { slug: SLUG } })
if (!org) { console.error(`Org "${SLUG}" not found.`); process.exit(1) }
const orgId = org.id
console.log(`Tenant "${SLUG}" → ${orgId}`)

const already = await prisma.mtmAuditLog.count({ where: { organizationId: orgId, newData: { path: ["_seed"], equals: MARK } } })
if (already > 0 && !hasFlag("force")) {
  console.log(`Already seeded (${already} tagged events). Pass --force to add more. Nothing to do.`)
  await prisma.$disconnect(); process.exit(0)
}

const agents = await prisma.mtmAgent.findMany({ where: { organizationId: orgId, status: "ACTIVE" }, take: 8 })
if (agents.length < 3) { console.error(`Not enough agents (${agents.length}).`); process.exit(1) }
console.log(`Using ${agents.length} agents.`)

const today = new Date()
const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d }
const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x }
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// action -> {entity, metadataKind?}. Weighted list below controls the mix.
const KINDS = {
  MOBILE_LOGIN:        { entity: "agent", kind: null },
  MOBILE_LOGIN_FAILED: { entity: "agent", kind: "login_failed" },
  CHECK_IN:            { entity: "visit", kind: null },
  CHECK_IN_FORCED:     { entity: "visit", kind: "force_checkin" },
  CHECK_OUT:           { entity: "visit", kind: null },
  PHOTO_UPLOAD:        { entity: "photo", kind: null },
  TASK_CREATE:         { entity: "task", kind: null },
  TASK_COMPLETE:       { entity: "task", kind: null },
  VISIT_UPDATE:        { entity: "visit", kind: null },
  ALERT_RESOLVE:       { entity: "alert", kind: null },
}
// Weighted bag — check-ins/outs/photos dominate; a few violations for the lens.
const BAG = [
  ...Array(10).fill("CHECK_IN"), ...Array(9).fill("CHECK_OUT"), ...Array(7).fill("PHOTO_UPLOAD"),
  ...Array(4).fill("TASK_CREATE"), ...Array(3).fill("TASK_COMPLETE"),
  ...Array(4).fill("MOBILE_LOGIN"), ...Array(2).fill("VISIT_UPDATE"), ...Array(2).fill("ALERT_RESOLVE"),
  ...Array(2).fill("CHECK_IN_FORCED"), ...Array(2).fill("MOBILE_LOGIN_FAILED"),
]

const cuidish = () => `seed${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
const rows = []
// Spread ~130 events over the last 9 days, business hours, weekends lighter.
for (let i = 0; i < 130; i++) {
  const d = daysAgo(rnd(0, 8))
  const dow = d.getDay()
  if ((dow === 0 || dow === 6) && Math.random() < 0.5) continue
  const action = pick(BAG)
  const meta = KINDS[action]
  const agent = pick(agents)
  const createdAt = at(d, rnd(8, 19), rnd(0, 59))
  rows.push({
    organizationId: orgId,
    agentId: action.startsWith("MOBILE_LOGIN") ? agent.id : agent.id,
    action,
    entity: meta.entity,
    entityId: cuidish(),
    metadataKind: meta.kind,
    newData: { _seed: MARK },
    ipAddress: action.startsWith("MOBILE_LOGIN") ? `10.0.${rnd(0, 255)}.${rnd(1, 254)}` : null,
    createdAt,
  })
}
// Guarantee a couple of TODAY events so the "today" period isn't empty on demo.
for (const action of ["CHECK_IN", "PHOTO_UPLOAD", "CHECK_IN_FORCED"]) {
  const agent = pick(agents)
  rows.push({
    organizationId: orgId, agentId: agent.id, action,
    entity: KINDS[action].entity, entityId: cuidish(), metadataKind: KINDS[action].kind,
    newData: { _seed: MARK }, ipAddress: null, createdAt: at(today, rnd(8, Math.max(9, today.getHours())), rnd(0, 59)),
  })
}

const res = await prisma.mtmAuditLog.createMany({ data: rows })
const violations = rows.filter(r => r.metadataKind).length
console.log(`SEEDED → ${res.count} audit events (${violations} violations) across last 9 days + today.`)
await prisma.$disconnect()
