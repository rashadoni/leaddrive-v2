import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getDemoModules } from "@/lib/demo-center/catalog"
import { getDemoJourneyScenario } from "@/lib/demo-center/journey"
import { sendDemoAccessEmail } from "@/lib/demo-center/email"
import { issueCapabilityToken } from "@/lib/demo-center/security"
import { demoGrantIssueSchema } from "@/lib/demo-center/validation"
import { runWithRlsBypass } from "@/lib/rls-context"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { demoCallAgentReady } from "@/lib/demo-center/demo-call"

const REVOCABLE_STATUSES = ["ISSUING", "SENT", "OTP_SENT", "OTP_VERIFIED", "ACTIVE", "DELIVERY_FAILED"]

class DemoGrantTransitionConflict extends Error {}

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

  // A live call needs the agent to speak as LeadDrive, which it does only once
  // the PBX asks for each call's own prompt. Refused here too, not only in
  // the admin screen, so a crafted request cannot tick it early.
  if (parsed.data.liveCallEnabled && !(await demoCallAgentReady())) {
    return NextResponse.json(
      { success: false, error: "A live call is not available yet: the PBX does not ask for a per-call prompt" },
      { status: 409 },
    )
  }

  const { id: requestId } = await params
  const demoRequest = await runWithRlsBypass(() =>
    prisma.demoRequest.findUnique({ where: { id: requestId } }),
  )
  if (!demoRequest) return NextResponse.json({ success: false, error: "Demo request not found" }, { status: 404 })
  if (demoRequest.status === "REJECTED") {
    return NextResponse.json({ success: false, error: "Rejected requests cannot be issued" }, { status: 409 })
  }

  const now = new Date()
  const linkExpiresAt = new Date(now.getTime() + parsed.data.linkValidDays * 86_400_000)
  const issued = issueCapabilityToken()
  const moduleManifests = getDemoModules(parsed.data.moduleIds)
  // Validation already refused an unknown id and refused both/neither, so a
  // scenario here is one the server itself approves.
  const scenario = parsed.data.scenarioId ? getDemoJourneyScenario(parsed.data.scenarioId) : null

  const grant = await runWithRlsBypass(() => prisma.$transaction(async (tx) => {
    // Lock the request row first in every issue/finalize path. This serializes
    // concurrent clicks with rejection and prevents a stale issue from
    // resurrecting a request that an administrator has already rejected.
    const claimedRequest = await tx.demoRequest.updateMany({
      where: { id: requestId, status: { not: "REJECTED" } },
      data: { status: "UNDER_REVIEW", reviewedBy: actor.userId, reviewedAt: now, rejectionReason: null },
    })
    if (!claimedRequest.count) return null

    const revoked = await tx.demoGrant.findMany({
      where: { requestId, status: { in: REVOCABLE_STATUSES } },
      select: { id: true },
    })
    if (revoked.length) {
      await tx.demoGrant.updateMany({
        where: { id: { in: revoked.map((item) => item.id) }, status: { in: REVOCABLE_STATUSES } },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokedBy: actor.userId,
          revocationReason: "Superseded by a newly issued demo",
          verificationHash: null,
          verificationExpiresAt: null,
          sessionHash: null,
        },
      })
      await tx.demoAccessEvent.createMany({
        data: revoked.map((item) => ({
          grantId: item.id,
          eventType: "REVOKED",
          metadata: { reason: "superseded" },
        })),
      })
    }

    return tx.demoGrant.create({
      data: {
        requestId,
        tokenHash: issued.tokenHash,
        tokenHint: issued.tokenHint,
        moduleIds: parsed.data.moduleIds,
        scenarioId: scenario?.scenarioId ?? null,
        // Pinned, not resolved at open time: a prospect finishes the manifest
        // they were granted even if a newer version ships mid-session.
        scenarioVersion: scenario?.version ?? null,
        // The admin allowed one real AI call to the prospect's proven phone,
        // and is the one on whose behalf it is placed.
        liveCallEnabled: Boolean(scenario) && parsed.data.liveCallEnabled,
        locale: parsed.data.locale,
        watermark: `${demoRequest.company} • ${demoRequest.email}`,
        linkExpiresAt,
        sessionDurationMinutes: parsed.data.sessionDurationMinutes,
        inactivityMinutes: parsed.data.inactivityMinutes,
        createdBy: actor.userId,
        events: {
          create: {
            eventType: "ISSUED",
            metadata: {
              scenarioId: scenario?.scenarioId ?? null,
              scenarioVersion: scenario?.version ?? null,
              moduleCount: parsed.data.moduleIds.length,
              liveCallEnabled: Boolean(scenario) && parsed.data.liveCallEnabled,
              linkValidDays: parsed.data.linkValidDays,
              sessionDurationMinutes: parsed.data.sessionDurationMinutes,
              inactivityMinutes: parsed.data.inactivityMinutes,
            },
          },
        },
      },
    })
  }))

  if (!grant) {
    return NextResponse.json({ success: false, error: "The request was rejected while access was being issued" }, { status: 409 })
  }

  const delivery = await sendDemoAccessEmail({
    to: demoRequest.email,
    name: demoRequest.name,
    company: demoRequest.company,
    token: issued.token,
    moduleNames: scenario ? [scenario.title] : moduleManifests.map((module) => module.title),
    linkExpiresAt,
  })

  if (!delivery.success) {
    const recordedFailure = await runWithRlsBypass(() => prisma.$transaction(async (tx) => {
      const updated = await tx.demoGrant.updateMany({
        where: { id: grant.id, status: "ISSUING" },
        data: { status: "DELIVERY_FAILED", deliveryError: delivery.error || "Email delivery failed" },
      })
      if (!updated.count) return false
      await tx.demoAccessEvent.create({
        data: { grantId: grant.id, eventType: "DELIVERY_FAILED", metadata: { providerError: delivery.error || "unknown" } },
      })
      return true
    }))
    if (!recordedFailure) {
      return NextResponse.json(
        { success: false, error: "Access was revoked while the email was being prepared" },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { success: false, error: "The access email could not be delivered. No usable link was stored; retry to issue a fresh link." },
      { status: 502 },
    )
  }

  const finalized = await runWithRlsBypass(() => prisma.$transaction(async (tx) => {
    // Request-first locking matches reject/reissue ordering. Throwing on the
    // second compare-and-set rolls this update back instead of reviving a
    // grant that was revoked while the provider was sending the email.
    const requestUpdated = await tx.demoRequest.updateMany({
      where: { id: requestId, status: "UNDER_REVIEW" },
      data: { status: "FULFILLED" },
    })
    if (!requestUpdated.count) throw new DemoGrantTransitionConflict()

    const grantUpdated = await tx.demoGrant.updateMany({
      where: { id: grant.id, status: "ISSUING" },
      data: { status: "SENT", sentAt: new Date(), deliveryMessageId: delivery.messageId || null, deliveryError: null },
    })
    if (!grantUpdated.count) throw new DemoGrantTransitionConflict()

    await tx.demoAccessEvent.create({ data: { grantId: grant.id, eventType: "SENT" } })
    return true
  })).catch((error) => {
    if (error instanceof DemoGrantTransitionConflict) return false
    throw error
  })

  if (!finalized) {
    return NextResponse.json(
      { success: false, error: "The email may have been delivered, but access was concurrently revoked. Issue a fresh link if needed." },
      { status: 409 },
    )
  }

  return NextResponse.json({ success: true, grantId: grant.id, status: "SENT" }, { status: 201 })
}
