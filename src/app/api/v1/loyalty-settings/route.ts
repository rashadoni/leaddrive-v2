/**
 * D8 Loyalty — per-tenant loyalty settings.
 *
 * Two admin switches, both off by default:
 *  - memberPortalEnabled → the `loyalty_portal` flag in Organization.features
 *    (shows the loyalty page/tab to portal members).
 *  - autoEarnEnabled     → `settings.loyaltyAutoEarn` (when on, a full invoice
 *    payment auto-awards points via the matching `purchase` EarnRule). This is
 *    the master switch the invoice-payment hook + applyAutoEarn gate on.
 *  - autoEarnSkipped     → `settings.loyaltyAutoEarnSkipped` (readiness-only:
 *    tenant explicitly launches without invoice auto-earn for now).
 *
 * GET  → { memberPortalEnabled, autoEarnEnabled, autoEarnSkipped }
 * PUT  { memberPortalEnabled?: boolean, autoEarnEnabled?: boolean, autoEarnSkipped?: boolean }
 *        → flips whichever is present, preserving every other feature / setting.
 *
 * Gated by the loyalty module (read/write) — a loyalty admin only.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const FLAG = "loyalty_portal"
const AUTO_EARN_KEY = "loyaltyAutoEarn"
const AUTO_EARN_SKIPPED_KEY = "loyaltyAutoEarnSkipped"

/** Org.features is a JSON string OR native string[] — normalize. */
function parseFeatures(raw: unknown): string[] {
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw || "[]")
      return Array.isArray(v) ? (v as string[]) : []
    } catch {
      return []
    }
  }
  return Array.isArray(raw) ? (raw as string[]) : []
}

/** Org.settings is JSON (object) — normalize defensively (older rows = string). */
function parseSettings(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw || "{}")
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
}

export const GET = withRlsAuth("loyalty", "read", async (_req: NextRequest, auth) => {
  const org = await prisma.organization.findFirst({
    where: { id: auth.orgId },
    select: { features: true, settings: true },
  })
  return NextResponse.json({
    success: true,
    memberPortalEnabled: parseFeatures(org?.features).includes(FLAG),
    autoEarnEnabled: parseSettings(org?.settings)[AUTO_EARN_KEY] === true,
    autoEarnSkipped: parseSettings(org?.settings)[AUTO_EARN_SKIPPED_KEY] === true,
  })
})

export const PUT = withRlsAuth("loyalty", "write", async (req: NextRequest, auth) => {
  let body: { memberPortalEnabled?: unknown; autoEarnEnabled?: unknown; autoEarnSkipped?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const hasPortal = body.memberPortalEnabled !== undefined
  const hasAuto = body.autoEarnEnabled !== undefined
  const hasAutoSkipped = body.autoEarnSkipped !== undefined
  if (hasPortal && typeof body.memberPortalEnabled !== "boolean") {
    return NextResponse.json({ error: "`memberPortalEnabled` must be a boolean" }, { status: 400 })
  }
  if (hasAuto && typeof body.autoEarnEnabled !== "boolean") {
    return NextResponse.json({ error: "`autoEarnEnabled` must be a boolean" }, { status: 400 })
  }
  if (hasAutoSkipped && typeof body.autoEarnSkipped !== "boolean") {
    return NextResponse.json({ error: "`autoEarnSkipped` must be a boolean" }, { status: 400 })
  }
  if (!hasPortal && !hasAuto && !hasAutoSkipped) {
    return NextResponse.json(
      { error: "provide `memberPortalEnabled`, `autoEarnEnabled`, and/or `autoEarnSkipped`" },
      { status: 400 },
    )
  }

  const org = await prisma.organization.findFirst({
    where: { id: auth.orgId },
    select: { features: true, settings: true },
  })

  // Build a minimal update — touch ONLY the flag(s) the caller asked for, so
  // features (which also seeds module materialisation) and every other setting
  // key are preserved.
  const data: { features?: string[]; settings?: Record<string, unknown> } = {}
  if (hasPortal) {
    const current = parseFeatures(org?.features)
    data.features = body.memberPortalEnabled
      ? Array.from(new Set([...current, FLAG]))
      : current.filter((f) => f !== FLAG)
  }
  if (hasAuto) {
    const currentSettings = parseSettings(org?.settings)
    data.settings = {
      ...currentSettings,
      [AUTO_EARN_KEY]: body.autoEarnEnabled as boolean,
      ...(body.autoEarnEnabled === true ? { [AUTO_EARN_SKIPPED_KEY]: false } : {}),
    }
  }
  if (hasAutoSkipped) {
    const currentSettings = data.settings ?? parseSettings(org?.settings)
    const effectiveAutoEarn = hasAuto ? body.autoEarnEnabled === true : currentSettings[AUTO_EARN_KEY] === true
    if (body.autoEarnSkipped === true && effectiveAutoEarn) {
      return NextResponse.json(
        { error: "`autoEarnSkipped` cannot be true while `autoEarnEnabled` is true" },
        { status: 400 },
      )
    }
    data.settings = { ...currentSettings, [AUTO_EARN_SKIPPED_KEY]: body.autoEarnSkipped as boolean }
  }

  await prisma.organization.update({ where: { id: auth.orgId }, data })

  return NextResponse.json({
    success: true,
    ...(hasPortal ? { memberPortalEnabled: body.memberPortalEnabled as boolean } : {}),
    ...(hasAuto ? { autoEarnEnabled: body.autoEarnEnabled as boolean } : {}),
    ...(hasAutoSkipped ? { autoEarnSkipped: body.autoEarnSkipped as boolean } : {}),
  })
})
