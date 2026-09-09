/**
 * C5 Account Engagement — single account lifecycle transitions.
 *
 * PATCH /api/v1/account-engagement/:id
 *   Body: { lifecycleStage: string }
 *   Returns: { account, deal? }
 *
 * Validates the transition using the slice-1 state machine, writes the new
 * stage + immutable milestone timestamp (only stamped once per stage visit),
 * and — when the new stage is "sql" — triggers the Sales-Marketing handoff
 * (auto-creates a CRM Deal in the org's default pipeline, assigned to the
 * account owner).
 *
 * The handoff is best-effort: a missing default pipeline or deal-create error
 * does not roll back the stage transition.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { transitionAccount } from "@/lib/account-engagement/state-machine"
import { type AccountLifecycleStage } from "@/lib/account-engagement/types"
import { performSqlHandoff } from "@/lib/account-engagement/sql-handoff"
import { enrollAccountInJourneys } from "@/lib/account-engagement/abm-enrollment"
import { withRlsAuth } from "@/lib/with-rls"

/* ── Validation ─────────────────────────────────────────────────────────── */

const PATCH_SCHEMA = z.object({
  lifecycleStage: z.enum([
    "target",
    "engaged",
    "mql",
    "sql",
    "opportunity",
    "customer",
    "churned",
  ]),
})

/* ── Milestone timestamp map ────────────────────────────────────────────── */

/**
 * Stage → column that records when the account first reached that stage.
 * Timestamps are written only once (immutable-once-set semantics enforced
 * here; the DB has no UPDATE trigger for these columns).
 */
const MILESTONE_COLUMN: Partial<Record<AccountLifecycleStage, string>> = {
  engaged: "becameEngagedAt",
  mql: "becameMqlAt",
  sql: "becameSqlAt",
  opportunity: "becameOpportunityAt",
  customer: "becameCustomerAt",
  churned: "churnedAt",
}

/* ── PATCH handler ─────────────────────────────────────────────────────── */

export const PATCH = withRlsAuth("account-engagement", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params

  // Parse body.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = PATCH_SCHEMA.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const newStage = parsed.data.lifecycleStage

  // Load current account (tenant-scoped).
  const account = await prisma.marketingAccount.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      accountName: true,
      lifecycleStage: true,
      companyId: true,
      ownerUserId: true,
      becameEngagedAt: true,
      becameMqlAt: true,
      becameSqlAt: true,
      becameOpportunityAt: true,
      becameCustomerAt: true,
      churnedAt: true,
    },
  })
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 })
  }

  // Validate transition.
  const fromStage = account.lifecycleStage as AccountLifecycleStage
  if (newStage === fromStage) {
    return NextResponse.json(
      { error: `Account is already in stage '${fromStage}'` },
      { status: 409 },
    )
  }
  const transition = transitionAccount(fromStage, newStage)
  if (!transition.ok) {
    return NextResponse.json(
      { error: transition.error ?? "Invalid stage transition" },
      { status: 422 },
    )
  }

  // Build milestone timestamp update (only set if not already stamped).
  const milestoneCol = MILESTONE_COLUMN[newStage]
  const alreadyStamped =
    milestoneCol && account[milestoneCol as keyof typeof account] != null
  const milestoneUpdate =
    milestoneCol && !alreadyStamped ? { [milestoneCol]: new Date() } : {}

  // Persist the transition.
  const updated = await prisma.marketingAccount.update({
    where: { id },
    data: {
      lifecycleStage: newStage,
      ...milestoneUpdate,
    },
    select: {
      id: true,
      accountName: true,
      lifecycleStage: true,
      engagementScore: true,
      grade: true,
      icpTier: true,
      companyId: true,
      ownerUserId: true,
      becameEngagedAt: true,
      becameMqlAt: true,
      becameSqlAt: true,
      becameOpportunityAt: true,
      becameCustomerAt: true,
      churnedAt: true,
      updatedAt: true,
    },
  })

  // Sales-Marketing handoff — triggered only on sql transition.
  let deal: { id: string; name: string; stage: string } | null = null
  if (newStage === "sql") {
    const handoff = await performSqlHandoff(
      {
        accountId: updated.id,
        accountName: updated.accountName,
        companyId: updated.companyId,
        ownerUserId: updated.ownerUserId,
        organizationId: orgId,
      },
      prisma,
    )
    deal = handoff.deal
    if (handoff.skipped) {
      console.warn(
        `[account-engagement/${id}] SQL handoff skipped: ${handoff.reason}`,
      )
    }
  }

  // Phase 6 — auto-enroll into matching active ABM journeys for the new
  // stage/tier (best-effort; @@unique + skipDuplicates make it idempotent).
  try {
    await enrollAccountInJourneys(orgId, updated.id, {
      icpTier: updated.icpTier,
      lifecycleStage: updated.lifecycleStage,
    })
  } catch (e) {
    console.warn(
      `[account-engagement/${id}] ABM enroll skipped: ${e instanceof Error ? e.message : "unknown"}`,
    )
  }

  return NextResponse.json({
    success: true,
    account: updated,
    ...(deal ? { deal } : {}),
  })
})
