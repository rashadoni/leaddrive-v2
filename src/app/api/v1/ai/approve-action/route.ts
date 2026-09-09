import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { executeTool } from "@/lib/ai/tool-executor"
import { withRls } from "@/lib/with-rls"

/**
 * Resolve a parked high-risk AI action (`create_deal`, `send_email`,
 * `update_contact` — see TOOL_META.requiresApproval).
 *
 * The transition out of "pending" is a single guarded UPDATE, never a
 * read-then-write. Two clients approving the same card concurrently used to
 * both pass the `findFirst(status:"pending")` check and both reach
 * `executeTool` — for `send_email` that is two messages to a real customer.
 * `updateMany({where:{…status:"pending"}})` lets exactly one caller win;
 * everyone else sees count 0 and gets a 409.
 *
 * Failure is TERMINAL ("failed"), not a reset to "pending". A tool that failed
 * mid-flight may have already had a side effect (the SMTP handoff is the
 * obvious one), so re-arming the same card for another click is how you get a
 * duplicate send. A genuinely retryable action is re-requested from the
 * assistant, which parks a fresh card.
 */
export const POST = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { userId } = session

  const { actionId, decision } = await req.json()
  if (!actionId || !decision) {
    return NextResponse.json({ error: "actionId and decision required" }, { status: 400 })
  }
  if (!["approve", "reject"].includes(decision)) {
    return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 })
  }

  // Read for the payload + expiry only — exclusivity comes from the claim below.
  const pending = await prisma.aiPendingAction.findFirst({
    where: { id: actionId, organizationId: orgId, status: "pending" },
  })
  if (!pending) {
    return NextResponse.json({ error: "Pending action not found or already resolved" }, { status: 404 })
  }

  if (new Date() > pending.expiresAt) {
    await prisma.aiPendingAction.updateMany({
      where: { id: actionId, organizationId: orgId, status: "pending" },
      data: { status: "expired" },
    })
    return NextResponse.json({ error: "Action has expired" }, { status: 410 })
  }

  if (decision === "reject") {
    const claimed = await prisma.aiPendingAction.updateMany({
      where: { id: actionId, organizationId: orgId, status: "pending" },
      data: { status: "rejected", resolvedAt: new Date(), resolvedBy: userId },
    })
    if (claimed.count !== 1) {
      return NextResponse.json({ error: "Action already resolved" }, { status: 409 })
    }
    await logAudit(
      orgId,
      "ai_action_rejected",
      pending.toolName,
      actionId,
      `AI action rejected: ${pending.toolName}`,
      { userId },
    )
    return NextResponse.json({ success: true, data: { status: "rejected" } })
  }

  // Claim BEFORE executing — this is the line that makes double-execution impossible.
  const claimed = await prisma.aiPendingAction.updateMany({
    where: { id: actionId, organizationId: orgId, status: "pending" },
    data: { status: "executing", resolvedAt: new Date(), resolvedBy: userId },
  })
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "Action already resolved" }, { status: 409 })
  }

  const toolInput = pending.toolInput as Record<string, any>
  let result: Awaited<ReturnType<typeof executeTool>>
  try {
    result = await executeTool(pending.toolName, toolInput, orgId, pending.userId, true)
  } catch (err: any) {
    // executeTool swallows tool-level errors, so reaching here means an
    // infrastructure failure. The card stays claimed and terminal either way.
    result = { success: false, error: err?.message || "Execution failed" }
  }

  await prisma.aiPendingAction.updateMany({
    where: { id: actionId, organizationId: orgId, status: "executing" },
    data: { status: result.success ? "approved" : "failed" },
  })

  // userId = who APPROVED it. The action still executes as pending.userId (its
  // author), so the audit trail needs both to be reconstructable.
  await logAudit(
    orgId,
    result.success ? "ai_action_approved" : "ai_action_failed",
    pending.toolName,
    actionId,
    `AI action ${result.success ? "approved" : "failed"}: ${pending.toolName}`,
    { userId, newValue: { requestedBy: pending.userId, error: result.error ?? null } },
  )

  return NextResponse.json({
    success: result.success,
    data: {
      status: result.success ? "approved" : "failed",
      result: result.data,
      error: result.error,
    },
  })
})
