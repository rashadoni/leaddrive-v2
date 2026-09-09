import { prisma } from "@/lib/prisma"
import { enrollOne } from "@/lib/sequences-enroll"
import { readSingleActiveEnrollment } from "@/lib/sequence-enrollment-policy"

/**
 * Auto-enroll a newly-created lead into every active sequence that lists the
 * lead's `source` in autoEnrollSources. MUST be awaited inside an RLS context
 * (the creating route's runWithTenant / withRls scope). Never throws — a failed
 * auto-enroll must not break lead creation. Returns the number of enrollments made.
 *
 * enrollOne resolves the owner from the lead's assignee, so auto-enrollment
 * respects lead-assignment rules; a duplicate/existing active enrollment is a no-op.
 */
export async function autoEnrollLeadIntoSequences(opts: {
  organizationId: string
  userId: string | null
  leadId: string
  source: string | null | undefined
}): Promise<number> {
  try {
    if (!opts.source) return 0
    const [sequences, org] = await Promise.all([
      prisma.salesSequence.findMany({
        where: {
          organizationId: opts.organizationId,
          isActive: true,
          autoEnrollSources: { has: opts.source },
        },
        include: { steps: { where: { isActive: true }, orderBy: { stepOrder: "asc" } } },
      }),
      prisma.organization.findUnique({ where: { id: opts.organizationId }, select: { settings: true } }),
    ])
    // E6 — when single-active is on and a lead matches several auto-enroll
    // sequences, the first wins and the rest are blocked (enrollOne sees the
    // one we just created as "another active sequence").
    const singleActiveEnrollment = readSingleActiveEnrollment(org?.settings)
    let enrolled = 0
    for (const seq of sequences) {
      if (seq.steps.length === 0) continue
      const r = await enrollOne({
        orgId: opts.organizationId,
        userId: opts.userId,
        sequenceId: seq.id,
        firstStepDelayDays: seq.steps[0].delayDays,
        entityType: "lead",
        entityId: opts.leadId,
        workdaysOnly: seq.workdaysOnly,
        singleActiveEnrollment,
      })
      if (r.outcome === "created" || r.outcome === "reenrolled") enrolled += 1
    }
    return enrolled
  } catch (err) {
    console.error("[sequences-auto-enroll] failed (non-fatal):", err)
    return 0
  }
}
