// Canary "bd-snapshot-ids" (read-only).
// Owner asked for provider-side proof of TikTok keyword search. Prints the
// Bright-Data-issued snapshot ids (externalRunId) + dataset ids of recent
// TikTok DISCOVER runs — the owner can find the SAME ids in their own Bright
// Data dashboard logs. Ids/counts only, no tokens, no content.
import { makeScriptPrisma } from "../_rls.mjs"

const prisma = await makeScriptPrisma()
const SLUG = "brandprotection"

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: SLUG }, select: { id: true } })
  if (!org) throw new Error(`no tenant slug=${SLUG}`)
  const runs = await prisma.socialProviderRun.findMany({
    where: {
      organizationId: org.id,
      providerKey: "bright-data",
      externalRunId: { not: null },
      createdAt: { gte: new Date(Date.now() - 3 * 3600 * 1000) },
      source: { platform: "tiktok" },
    },
    select: {
      createdAt: true, phase: true, status: true, externalRunId: true,
      datasetId: true, receivedCount: true, acceptedCount: true,
      source: { select: { handle: true, query: true, sourceType: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
  })
  console.log(`[bd-snapshot-ids] tiktok bright-data runs with provider snapshot ids (72h): ${runs.length}`)
  for (const r of runs) {
    const q = r.source?.query || r.source?.handle || "?"
    console.log(`  ${r.createdAt.toISOString().slice(5, 16)} ${r.phase} ${r.status} query="${q}" recv=${r.receivedCount} snapshot=${r.externalRunId} dataset=${r.datasetId}`)
  }
}

main()
  .catch((err) => { console.error("[bd-snapshot-ids] FAILED:", err); process.exit(1) })
  .finally(() => prisma.$disconnect())
