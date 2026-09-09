/**
 * G2 Identity Resolution — Wave 2A resolve mutation.
 *
 * POST /api/v1/identity-merge-queue/[id]/resolve
 *   body: { action: "merge" | "reject", reviewNote?: string }
 *
 * Closes the human-in-the-loop: the operator reviews a pending
 * ProfileMergeCandidate and either MERGES (fold secondary → primary) or REJECTS.
 * The heavy lifting + transaction is in lib/unified-profile/merge-candidate-resolver;
 * this route handles auth, validation, re-aggregation of the merged primary, and
 * the durable audit-log entry (the candidate row is cascade-removed on merge).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { resolveMergeCandidate } from "@/lib/unified-profile/merge-candidate-resolver"
import { reaggregateProfile } from "@/lib/unified-profile/profile-builder"

const bodySchema = z.object({
  action: z.enum(["merge", "reject"]),
  reviewNote: z.string().max(2000).optional(),
})

export const POST = withRlsAuth("data-cloud", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  // Destructive op (deletes a profile) — gate on a WRITE permission, not just
  // org membership. Module is "data-cloud" — the module this path resolves to
  // in permissions.ts (the CDP block) — so a manager with data-cloud:write is
  // allowed and an API key must carry write:data-cloud scope.
  const orgId = auth.orgId
  const reviewedBy = auth.userId || "system"
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const parsed = bodySchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { action, reviewNote } = parsed.data

  try {
    const result = await resolveMergeCandidate(prisma, {
      orgId,
      candidateId: id,
      action,
      reviewedBy,
      reviewNote,
    })

    if (result.status === "not_found") {
      return NextResponse.json({ error: "Candidate or profile not found" }, { status: 404 })
    }
    if (result.status === "already_resolved") {
      return NextResponse.json({ error: "Candidate already resolved" }, { status: 409 })
    }

    if (result.status === "merged" && result.primaryProfileId) {
      // Recompute the primary's rollups now that it owns the secondary's sources.
      // Idempotent + healed by the hourly cron — don't fail the (already-committed)
      // merge if the recompute errors.
      await reaggregateProfile(prisma, orgId, result.primaryProfileId).catch((e) =>
        console.error("[merge-queue/resolve] reaggregate failed (cron will heal)", e),
      )
      logAudit(
        orgId,
        "merge",
        "unified_profile",
        result.primaryProfileId,
        `merged ${result.secondaryProfileId} via candidate ${id} (by ${reviewedBy})`,
      )
    } else {
      logAudit(orgId, "reject", "profile_merge_candidate", id, `rejected by ${reviewedBy}`)
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error("[identity-merge-queue/resolve] error:", e)
    return NextResponse.json({ error: "Failed to resolve candidate" }, { status: 500 })
  }
})
