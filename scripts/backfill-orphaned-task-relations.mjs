// One-shot backfill: null out Task.relatedType/relatedId for tasks whose
// linked entity (company/contact/deal/lead/ticket) no longer exists — the
// "dangling reference" left behind by deletes that happened BEFORE the
// forward-fix (clearTaskRelations wired into the 5 entity DELETE routes).
//
// After the forward-fix is deployed, new deletes self-clean; this run mops up
// the historical orphans. Idempotent — re-running finds nothing once clean.
//
// Cross-tenant operator script → RLS bypass (makeScriptPrisma).
//
// Usage:
//   node scripts/backfill-orphaned-task-relations.mjs            # dry-run (counts only)
//   node scripts/backfill-orphaned-task-relations.mjs --execute  # actually nulls

import { makeScriptPrisma } from "./_rls.mjs"

const MODELS = {
  company: (p) => p.company,
  contact: (p) => p.contact,
  deal: (p) => p.deal,
  lead: (p) => p.lead,
  ticket: (p) => p.ticket,
}

async function main() {
  const execute = process.argv.includes("--execute")
  const prisma = await makeScriptPrisma()
  let totalOrphans = 0
  let totalNulled = 0

  try {
    for (const [type, pick] of Object.entries(MODELS)) {
      // All tasks still pointing at this entity type.
      const tasks = await prisma.task.findMany({
        where: { relatedType: type, relatedId: { not: null } },
        select: { id: true, organizationId: true, relatedId: true },
      })
      if (tasks.length === 0) continue

      // Group referenced ids per org, then ask the entity table which still exist.
      const byOrg = new Map()
      for (const t of tasks) {
        if (!byOrg.has(t.organizationId)) byOrg.set(t.organizationId, new Set())
        byOrg.get(t.organizationId).add(t.relatedId)
      }

      const orphanTaskIds = []
      for (const [orgId, idSet] of byOrg) {
        const ids = [...idSet]
        const existing = await pick(prisma).findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true },
        })
        const alive = new Set(existing.map((e) => e.id))
        for (const t of tasks) {
          if (t.organizationId === orgId && !alive.has(t.relatedId)) orphanTaskIds.push(t.id)
        }
      }

      if (orphanTaskIds.length === 0) {
        console.log(`[backfill-orphaned-task-relations] ${type}: 0 orphans`)
        continue
      }
      totalOrphans += orphanTaskIds.length
      console.log(`[backfill-orphaned-task-relations] ${type}: ${orphanTaskIds.length} orphaned task(s)`)

      if (execute) {
        const r = await prisma.task.updateMany({
          where: { id: { in: orphanTaskIds } },
          data: { relatedType: null, relatedId: null },
        })
        totalNulled += r.count
      }
    }

    console.log("─".repeat(56))
    if (execute) {
      console.log(`[backfill-orphaned-task-relations] DONE — nulled ${totalNulled} task relation(s)`)
    } else {
      console.log(`[backfill-orphaned-task-relations] DRY-RUN — ${totalOrphans} orphan(s) found; re-run with --execute to null them`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
