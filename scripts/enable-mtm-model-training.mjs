/**
 * Enable the dormant "Model Training" feature (mtm_model_training) for ONE org.
 *
 * The flag lives as a string in Organization.features (a JSON array); the API +
 * UI gates read it via getOrgModuleContext → modules["mtm_model_training"] === true
 * (src/lib/mtm/model-training-access.ts). This script appends the flag if absent.
 *
 * IDEMPOTENT + MERGING: it reads the org's current features, adds the flag only
 * when missing, and writes the merged array back — never clobbering other flags.
 * Targets a single org by slug (default "mars"); refuses to run if not found.
 *
 * Run on the server from the immutable release with the canonical app env:
 *   node --env-file=/etc/leaddrive/app.env scripts/enable-mtm-model-training.mjs            # defaults to "mars"
 *   node --env-file=/etc/leaddrive/app.env scripts/enable-mtm-model-training.mjs <slug>
 *
 * Org cache TTL is ~60s (src/lib/api-auth.ts ORG_CACHE_INTERVAL); a PM2 restart
 * applies it immediately.
 */
import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()
const FLAG = "mtm_model_training"
const slug = process.argv[2] || "mars"

const parseFeatures = (raw) => {
  if (Array.isArray(raw)) return raw
  if (typeof raw === "string") {
    try { return JSON.parse(raw || "[]") } catch { return [] }
  }
  return []
}

try {
  const org = await prisma.organization.findFirst({
    where: { slug },
    select: { id: true, name: true, slug: true, features: true },
  })
  if (!org) {
    const all = await prisma.organization.findMany({ select: { slug: true } })
    console.error(`✗ No org with slug "${slug}". Available slugs: ${all.map(o => o.slug).join(", ")}`)
    process.exit(1)
  }

  const before = parseFeatures(org.features)
  console.log(`Org: ${org.name} (slug=${org.slug}, id=${org.id})`)
  console.log(`features BEFORE: ${JSON.stringify(before)}`)

  if (before.includes(FLAG)) {
    console.log(`✓ Already enabled — "${FLAG}" present. No change.`)
    process.exit(0)
  }

  const after = [...before, FLAG]
  await prisma.organization.update({ where: { id: org.id }, data: { features: after } })
  console.log(`features AFTER : ${JSON.stringify(after)}`)
  console.log(`✅ Enabled "${FLAG}" for "${org.slug}". (Org cache TTL ~60s; restart applies immediately.)`)
} finally {
  await prisma.$disconnect()
}
