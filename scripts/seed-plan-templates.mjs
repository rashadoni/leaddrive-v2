// scripts/seed-plan-templates.mjs
// Idempotent + NON-DESTRUCTIVE: inserts the 3 legacy plans only if their key is absent.
// Never overwrites an operator-edited plan. Safe to run on every deploy.
// Usage: node scripts/seed-plan-templates.mjs
import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()

// GROUP-module vocabulary (MC-T7): features carry group ids from
// src/lib/modules.ts GROUP_MODULE_IDS + the extra feature flags
// (whatsapp/complaints_register); addons carry bundle/flag ids. Fresh installs
// get group-shaped plans; existing rows are translated by
// scripts/migrate-plan-templates-group-modules.mjs. Operators can edit later
// in /admin/plans.
const LEGACY = [
  { key: "starter", name: "Starter", features: ["crm", "sales", "settings"], addons: [], maxUsers: 3, maxContacts: 500, sortOrder: 0 },
  { key: "professional", name: "Professional", features: ["crm", "sales", "contracts", "marketing", "loyalty", "omnichannel", "support", "finance", "analytics", "settings", "whatsapp", "complaints_register"], addons: ["ai", "channels"], maxUsers: 25, maxContacts: 10000, sortOrder: 1 },
  { key: "enterprise", name: "Enterprise", features: ["crm", "sales", "contracts", "marketing", "loyalty", "omnichannel", "social", "voip", "support", "finance", "analytics", "mtm", "health", "insurance", "public-sector", "media", "energy", "settings", "whatsapp", "complaints_register"], addons: ["ai", "channels", "finance", "mtm", "voip"], maxUsers: -1, maxContacts: -1, sortOrder: 2 },
]

async function main() {
  for (const p of LEGACY) {
    const existing = await prisma.planTemplate.findUnique({ where: { key: p.key } })
    if (existing) {
      console.log(`skip ${p.key} (exists, not overwriting)`)
      continue
    }
    await prisma.planTemplate.create({ data: p })
    console.log(`created ${p.key}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
