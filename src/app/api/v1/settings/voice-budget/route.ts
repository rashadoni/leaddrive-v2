import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { MONTHLY_BUDGET_SECONDS } from "@/lib/ai/voice/config"
import {
  VOICE_MONTHLY_MINUTES_KEY,
  MIN_VOICE_MONTHLY_MINUTES,
  MAX_VOICE_MONTHLY_MINUTES,
  normalizeMonthlyMinutes,
} from "@/lib/ai/voice/monthly-budget"

/**
 * The organisation's monthly ceiling for the voice assistant.
 *
 * It used to be one environment variable for the whole deployment, so raising
 * a single customer's ceiling meant a release. Worse, the customer's own
 * reading — "I topped up my balance, why does it still say I am out?" — had
 * nothing to do with it: the provider balance and this budget are unrelated
 * numbers, and only one of them is ours.
 *
 * Gated on `settings:write`. This is a spending ceiling; the neighbouring
 * ai-budget route settles for any authenticated member of the org, which is a
 * hole this one does not copy.
 */

const bounds = {
  min: MIN_VOICE_MONTHLY_MINUTES,
  max: MAX_VOICE_MONTHLY_MINUTES,
  // What an organisation gets while it has set nothing of its own.
  default: Math.round(MONTHLY_BUDGET_SECONDS / 60),
}

export const GET = withRlsAuth("settings", "read", async (_req, { orgId }) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  const settings = (org?.settings ?? {}) as Record<string, unknown>
  // null means "not set" — the UI shows the deployment default as a placeholder
  // rather than pretending the organisation chose it.
  const minutes = normalizeMonthlyMinutes(settings[VOICE_MONTHLY_MINUTES_KEY])
  return NextResponse.json({ success: true, data: { minutes, ...bounds } })
})

export const PATCH = withRlsAuth("settings", "write", async (req, { orgId }) => {
  const body = await req.json().catch(() => ({}))
  const raw = (body as { minutes?: unknown }).minutes

  // Clearing the field returns the organisation to the deployment default,
  // which is a different state from "zero minutes" and has to stay expressible.
  if (raw === null || raw === "") {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } })
    const settings = { ...((org?.settings ?? {}) as Record<string, unknown>) }
    delete settings[VOICE_MONTHLY_MINUTES_KEY]
    await prisma.organization.update({ where: { id: orgId }, data: { settings } })
    return NextResponse.json({ success: true, data: { minutes: null, ...bounds } })
  }

  const minutes = normalizeMonthlyMinutes(raw)
  if (minutes === null) {
    return NextResponse.json(
      { error: `Minutes must be a whole number between ${bounds.min} and ${bounds.max}` },
      { status: 400 },
    )
  }

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } })
  const settings = { ...((org?.settings ?? {}) as Record<string, unknown>), [VOICE_MONTHLY_MINUTES_KEY]: minutes }
  await prisma.organization.update({ where: { id: orgId }, data: { settings } })

  return NextResponse.json({ success: true, data: { minutes, ...bounds } })
})
