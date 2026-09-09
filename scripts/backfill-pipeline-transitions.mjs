// One-shot backfill: reconstruct pipeline_stage_transition rows from the
// CURRENT state of existing deals, so the Pipeline Waterfall (/forecast/
// waterfall) reflects deals that were won/lost (or created) BEFORE the
// forward-only A12 recorder shipped — or that were seeded directly into the
// DB and therefore never emitted a transition event.
//
// IMPORTANT — what this can and cannot do (honest limits):
//   • It reconstructs ONE transition per deal, from its CURRENT stage:
//       won stage  → a 'won'  transition (+valueAmount)
//       lost stage → a 'lost' transition (-valueAmount)
//       open stage → a 'created' transition (toStage = current), ONLY with --include-open
//   • It does NOT know the deal's intermediate journey (LEAD→QUALIFIED→WON
//     shows up as a single 'won', not three rows). fromStage is left null.
//   • transitionedAt = stageChangedAt (when the stage last changed) ?? createdAt.
//   • The analyzer only uses toAmount for won/lost/created, so fromStage/
//     fromAmount being unknown does not skew the numbers
//     (src/lib/revenue-intelligence/waterfall-analyzer.ts: won=+toAmount,
//      lost=-toAmount, created=toAmount).
//
// Idempotent: a deal that ALREADY has ANY transition row is skipped — so
// re-runs are no-ops and deals moved live (post-fix) keep their real events.
// Rows written here carry reason="backfill:v1" + metadata.backfill=true.
//
// Org-scoped on purpose (no accidental all-tenant write). Run per server
// (each client box has its own DB — see clients/registry.json):
//   node scripts/backfill-pipeline-transitions.mjs --org=<slug-or-id>                 # dry-run
//   node scripts/backfill-pipeline-transitions.mjs --org=<slug-or-id> --execute       # write won/lost
//   node scripts/backfill-pipeline-transitions.mjs --org=<slug-or-id> --include-open --execute
//
// NOTE — backfilled rows carry the deal's REAL historical date
// (stageChangedAt ?? createdAt), which may predate the 180-day UI presets.
// View them via the "All time" period button on /forecast/waterfall.
//
// Rollback (precise, reverses ONLY this backfill for one org):
//   DELETE FROM pipeline_stage_transitions
//   WHERE "organizationId" = '<org-id>' AND reason = 'backfill:v1';

import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()

const args = process.argv.slice(2)
const execute = args.includes("--execute")
const includeOpen = args.includes("--include-open")
const orgArg = (args.find((a) => a.startsWith("--org=")) || "").split("=")[1]

if (!orgArg) {
  console.error("✗ --org=<slug-or-id> is required (refusing to run all-tenant).")
  process.exit(1)
}

const REASON = "backfill:v1"

function isWonName(n) {
  return /^won$/i.test(n) || /qazan/i.test(n) || /выигр/i.test(n)
}
function isLostName(n) {
  return /^lost$/i.test(n) || /itiril/i.test(n) || /проигр/i.test(n)
}

async function main() {
  const org = await prisma.organization.findFirst({
    where: { OR: [{ slug: orgArg }, { id: orgArg }] },
    select: { id: true, slug: true, name: true },
  })
  if (!org) {
    console.error(`✗ Organization not found for --org="${orgArg}"`)
    process.exit(1)
  }
  console.log(`Org: ${org.name} (${org.slug} / ${org.id})`)

  // Stage classification: prefer the pipeline's isWon/isLost flags; fall back
  // to name heuristics for the default seeded "WON"/"LOST" stages.
  const stages = await prisma.pipelineStage.findMany({
    where: { organizationId: org.id },
    select: { name: true, isWon: true, isLost: true, sortOrder: true, pipelineId: true },
    orderBy: { sortOrder: "asc" },
  })
  const wonNames = new Set(stages.filter((s) => s.isWon).map((s) => s.name))
  const lostNames = new Set(stages.filter((s) => s.isLost).map((s) => s.name))

  // The DB CHECK (pipeline_stage_transitions_created_coherence_check) requires
  // non-'created' rows to carry a non-null fromStage + fromAmount. We don't
  // know the true prior stage, so reconstruct it as the deal's last OPEN
  // (non-won/lost) pipeline stage by sortOrder — the most likely path into a
  // close. The waterfall analyzer scores won/lost purely on toAmount, so the
  // reconstructed fromStage never affects its numbers; and the velocity report
  // (/forecast/velocity) explicitly excludes reason='backfill:v1' rows, so the
  // fabricated stage is not surfaced there either. Per-pipeline + a global
  // fallback for deals whose pipeline has no usable stages.
  const isTerminal = (s) =>
    s.isWon || s.isLost || isWonName(s.name) || isLostName(s.name)
  const lastOpenByPipeline = new Map()
  for (const s of stages) {
    if (isTerminal(s)) continue
    lastOpenByPipeline.set(s.pipelineId, s.name) // asc order → last wins = highest sortOrder
  }
  const globalLastOpen =
    [...lastOpenByPipeline.values()].pop() || "NEGOTIATION"
  const priorStageFor = (d) =>
    lastOpenByPipeline.get(d.pipelineId) || globalLastOpen

  // Track stages classified by NAME heuristic (not by the isWon/isLost flag)
  // so they can be eyeballed in the dry-run report.
  const byHeuristic = new Set()
  const classify = (stage) => {
    if (wonNames.has(stage)) return "won"
    if (lostNames.has(stage)) return "lost"
    if (isWonName(stage)) {
      byHeuristic.add(`${stage} → won`)
      return "won"
    }
    if (isLostName(stage)) {
      byHeuristic.add(`${stage} → lost`)
      return "lost"
    }
    return includeOpen ? "created" : null
  }

  // Only deals with ZERO existing transitions are eligible (idempotent +
  // never duplicates a live-recorded event).
  const deals = await prisma.deal.findMany({
    where: { organizationId: org.id, stageTransitions: { none: {} } },
    select: {
      id: true,
      stage: true,
      valueAmount: true,
      currency: true,
      pipelineId: true,
      stageChangedAt: true,
      createdAt: true,
    },
  })

  const rows = []
  const counts = { won: 0, lost: 0, created: 0, skipped: 0 }
  for (const d of deals) {
    const type = classify(d.stage)
    if (!type) {
      counts.skipped++ // open deal + no --include-open
      continue
    }
    counts[type]++
    // 'created' must have NULL fromStage/fromAmount; won/lost must have BOTH
    // non-null (DB coherence CHECK). A stage move doesn't reprice, so
    // fromAmount = valueAmount (= toAmount).
    const isCreated = type === "created"
    rows.push({
      organizationId: org.id,
      dealId: d.id,
      pipelineId: d.pipelineId ?? null,
      fromStage: isCreated ? null : priorStageFor(d),
      toStage: d.stage,
      fromAmount: isCreated ? null : d.valueAmount,
      toAmount: d.valueAmount,
      currency: d.currency ?? "AZN",
      transitionedAt: d.stageChangedAt ?? d.createdAt,
      transitionType: type,
      reason: REASON,
      metadata: { backfill: true },
    })
  }

  console.log(
    `Eligible deals (no existing transition): ${deals.length}\n` +
      `  → won: ${counts.won}  lost: ${counts.lost}  created: ${counts.created}` +
      `  (open skipped, no --include-open: ${counts.skipped})`,
  )
  if (byHeuristic.size > 0) {
    console.log(
      `  ⚠ classified by NAME heuristic (not isWon/isLost flag) — verify: ${[...byHeuristic].join(", ")}`,
    )
  }
  // A few samples for sanity.
  for (const r of rows.slice(0, 5)) {
    console.log(
      `    sample: deal ${r.dealId}  ${r.transitionType}  ${r.toAmount} ${r.currency}  @ ${new Date(r.transitionedAt).toISOString().slice(0, 10)}`,
    )
  }

  if (!execute) {
    console.log("\nDRY-RUN — nothing written. Re-run with --execute to insert.")
    return
  }
  if (rows.length === 0) {
    console.log("\nNothing to write.")
    return
  }
  const res = await prisma.pipelineStageTransition.createMany({ data: rows })
  console.log(`\n✓ Inserted ${res.count} transition row(s) for ${org.slug}.`)
}

main()
  .catch((e) => {
    console.error("✗ Backfill failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
