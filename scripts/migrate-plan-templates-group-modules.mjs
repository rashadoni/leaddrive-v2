// scripts/migrate-plan-templates-group-modules.mjs
// Translate PlanTemplate.features legacy ids -> group-module ids (add-only union,
// legacy ids retained for rollback; UI shows only registry ids). Dry-run default.
// Usage: node scripts/migrate-plan-templates-group-modules.mjs [--execute]
import { makeScriptPrisma } from "./_rls.mjs"
const prisma = await makeScriptPrisma()
const MAP = { core:"crm", deals:"sales", leads:"sales", tasks:"crm", quotes:"sales", offers:"sales", projects:"crm",
  campaigns:"marketing", events:"marketing", journeys:"marketing",
  loyalty:"loyalty",
  invoices:"finance", budgeting:"finance", profitability:"finance",
  tickets:"support", "knowledge-base":"support", portal:"support",
  reports:"analytics", workflows:"settings", "custom-fields":"settings", currencies:"settings",
  omnichannel:"omnichannel" }
const LOYALTY_CONTINUITY_KEYS = ["marketing", "campaigns", "events", "journeys", "segments", "account-engagement"]
async function main() {
  const execute = process.argv.includes("--execute")
  console.log(`[migrate-plan-templates] mode=${execute ? "EXECUTE" : "DRY-RUN"}`)
  const plans = await prisma.planTemplate.findMany()
  for (const p of plans) {
    const groups = p.features.map((f) => MAP[f]).filter(Boolean)
    if (p.features.some((f) => LOYALTY_CONTINUITY_KEYS.includes(f))) groups.push("loyalty")
    const target = [...new Set([...p.features, ...groups])]
    if (target.length === p.features.length) { console.log(`  ok ${p.key}`); continue }
    console.log(`  PATCH ${p.key}: +[${target.filter((t) => !p.features.includes(t)).join(", ")}]`)
    if (execute) await prisma.planTemplate.update({ where: { id: p.id }, data: { features: target } })
  }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
