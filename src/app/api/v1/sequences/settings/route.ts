/**
 * E4 — sequence send settings (org-wide daily email cap).
 *
 * GET   → current limit + today's usage (for the queue banner).
 * PATCH → set/clear the daily limit (null clears = unlimited).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getDailyLimitStatus, readDailyEmailLimit } from "@/lib/sequence-send-limit"
import { readSingleActiveEnrollment } from "@/lib/sequence-enrollment-policy"
import { canManageSequenceSettings } from "@/lib/sequence-settings-access"

export const GET = withRls(async (_req, { orgId }) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  const status = await getDailyLimitStatus(prisma, orgId, org?.settings)
  return NextResponse.json({
    success: true,
    data: { ...status, singleActiveEnrollment: readSingleActiveEnrollment(org?.settings) },
  })
})

export const PATCH = withRls(async (req, { orgId, session }) => {
  if (!canManageSequenceSettings(session?.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    dailyEmailLimit?: number | null
    singleActiveEnrollment?: boolean
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  const settings = (org?.settings as Record<string, unknown>) || {}

  if ("dailyEmailLimit" in body) {
    const raw = body.dailyEmailLimit
    // null / absent → unlimited (clear the key); otherwise a positive int cap.
    if (raw === null || raw === undefined) {
      delete settings.sequenceDailyEmailLimit
    } else if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 100000) {
      return NextResponse.json({ error: "dailyEmailLimit must be a positive integer ≤ 100000, or null" }, { status: 400 })
    } else {
      settings.sequenceDailyEmailLimit = raw
    }
  }

  // E6 — single active enrollment toggle.
  if ("singleActiveEnrollment" in body) {
    if (typeof body.singleActiveEnrollment !== "boolean") {
      return NextResponse.json({ error: "singleActiveEnrollment must be a boolean" }, { status: 400 })
    }
    if (body.singleActiveEnrollment) settings.sequenceSingleActiveEnrollment = true
    else delete settings.sequenceSingleActiveEnrollment
  }

  await prisma.organization.update({ where: { id: orgId }, data: { settings } })

  // Echo the resolved status so the UI can update in place.
  const status = await getDailyLimitStatus(prisma, orgId, settings)
  return NextResponse.json({
    success: true,
    data: { ...status, limit: readDailyEmailLimit(settings), singleActiveEnrollment: readSingleActiveEnrollment(settings) },
  })
})
