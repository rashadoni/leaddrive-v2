import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { setOrgFeatureFlag } from "@/lib/org-features"
import { featureFlagsToArray } from "@/lib/modules"
import { isToggleableFeatureFlag } from "@/lib/ai-feature-flags"

/**
 * GET /api/v1/settings/ai-features — list current features
 * PATCH /api/v1/settings/ai-features — add/remove a feature flag
 *
 * GET intentionally stays on `withRls` rather than matching PATCH's
 * `withRlsAuth("settings", …)`: reading your own org's flag list is what the
 * inbox chatbot-rules and social-monitoring pages do to render their toggles,
 * and every role below admin has `settings: []` in ROLE_PERMISSIONS — gating
 * the read would blank those pages for managers. The asymmetry is the point,
 * not an oversight.
 */
export const GET = withRls(async (_req, { orgId }) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { features: true },
  })

  return NextResponse.json({
    data: { features: featureFlagsToArray(org?.features) },
  })
})

/**
 * Admin-only: `Organization.features` is the authoritative paid-module grant
 * (`moduleRecordFromOrgFields` → `hasModule` → `requireAuth`), so an unguarded
 * write here lets any signed-in member entitle their own tenant to a module.
 * `withRlsAuth("settings", "write")` matches the 20 sibling routes under
 * /api/v1/settings; the explicit role check keeps holding if ROLE_PERMISSIONS
 * ever grants settings:write more broadly.
 */
export const PATCH = withRlsAuth("settings", "write", async (req, auth) => {
  if (auth.role !== "admin" && auth.role !== "superadmin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  }
  const orgId = auth.orgId
  const body = await req.json().catch(() => null)
  const { feature, action } = (body ?? {}) as { feature?: unknown; action?: unknown }

  if (typeof feature !== "string" || !feature || typeof action !== "string" || !["add", "remove"].includes(action)) {
    return NextResponse.json({ error: "feature and action (add/remove) required" }, { status: 400 })
  }

  if (!isToggleableFeatureFlag(feature)) {
    // Echoed (truncated) on purpose: a legitimate new toggle that was not added
    // to the allowlist should be obvious in the UI, not a silent no-op.
    return NextResponse.json(
      { error: `Feature flag "${feature.slice(0, 64)}" is not toggleable` },
      { status: 400 },
    )
  }

  // Atomic toggle — no read-modify-write race (two concurrent saves can't drop a flag).
  await setOrgFeatureFlag(orgId, feature, action === "add")

  await logAudit(
    orgId,
    action === "add" ? "feature_flag_enabled" : "feature_flag_disabled",
    "organization",
    orgId,
    feature,
    { userId: auth.userId },
  )

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { features: true },
  })
  const features = featureFlagsToArray(org?.features)
  return NextResponse.json({ data: { features } })
})
