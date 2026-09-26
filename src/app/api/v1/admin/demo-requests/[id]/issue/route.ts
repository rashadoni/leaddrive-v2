import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { issueDemoGrant } from "@/lib/demo-center/issue-grant"
import { demoGrantIssueSchema } from "@/lib/demo-center/validation"
import { runWithRlsBypass } from "@/lib/rls-context"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { demoCallAgentReady } from "@/lib/demo-center/demo-call"
import { normalizeDemoPhone } from "@/lib/demo-center/phone-verification"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSuperAdmin(request)
  if (actor instanceof NextResponse) return actor

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 })
  }
  const parsed = demoGrantIssueSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Check the demo settings" },
      { status: 400 },
    )
  }

  // A live call needs the agent to speak with the demo's own script. It does
  // by default; the gate closes only after an answered demo call went without
  // it (demoCallAgentReady). Refused here too, not only in the admin screen,
  // so a crafted request cannot tick it while paused.
  if (parsed.data.liveCallEnabled && !(await demoCallAgentReady())) {
    return NextResponse.json(
      { success: false, error: "Live calls are paused: the last answered demo call did not get the demo script" },
      { status: 409 },
    )
  }

  const { id: requestId } = await params
  const demoRequest = await runWithRlsBypass(() =>
    prisma.demoRequest.findUnique({ where: { id: requestId } }),
  )
  if (!demoRequest) return NextResponse.json({ success: false, error: "Demo request not found" }, { status: 404 })
  // The live call only ever rings the phone on the request (owner decision
  // 2026-09-22). With no Azerbaijani mobile there it cannot happen at all, so
  // it is not offered to the prospect as a button that can only fail.
  if (parsed.data.liveCallEnabled && !normalizeDemoPhone(demoRequest.phone ?? "")) {
    return NextResponse.json(
      { success: false, error: "This request has no Azerbaijani mobile number, and the live call only ever rings the request's own phone" },
      { status: 409 },
    )
  }
  if (demoRequest.status === "REJECTED") {
    return NextResponse.json({ success: false, error: "Rejected requests cannot be issued" }, { status: 409 })
  }

  const result = await issueDemoGrant({
    request: demoRequest,
    actorUserId: actor.userId,
    options: {
      scenarioId: parsed.data.scenarioId,
      moduleIds: parsed.data.moduleIds,
      linkValidDays: parsed.data.linkValidDays,
      sessionDurationMinutes: parsed.data.sessionDurationMinutes,
      inactivityMinutes: parsed.data.inactivityMinutes,
      locale: parsed.data.locale,
      liveCallEnabled: parsed.data.liveCallEnabled,
    },
  })
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true, grantId: result.grantId, status: "SENT" }, { status: 201 })
}
