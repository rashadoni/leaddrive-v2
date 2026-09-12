import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { setOrgFeatureFlag } from "@/lib/org-features"
import { featureFlagsToArray } from "@/lib/modules"
import { isToggleableFeatureFlag } from "@/lib/ai-feature-flags"
import { SUPPORT_AI_DISABLED_FEATURE } from "@/lib/ai/feature-keys"
import { hasSupportAiSettingsEntitlement } from "@/lib/ai/support-settings-access"

/**
 * GET /api/v1/settings/ai-features — list current features
 * PATCH /api/v1/settings/ai-features — add/remove a feature flag
 *
 * GET is intentionally authorized as an AI read rather than a settings read:
 * non-admin Support/Omnichannel screens need their own organization's feature
 * state to hide disabled AI actions, while PATCH remains admin-only.
 */
export const GET = withRlsAuth("ai", "read", async (_req, { orgId }) => {
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

  if (
    feature === SUPPORT_AI_DISABLED_FEATURE
    && !(await hasSupportAiSettingsEntitlement(orgId))
  ) {
    return NextResponse.json({ error: "Support and AI add-ons required" }, { status: 403 })
  }

  const before = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { features: true },
  })
  const previousFeatures = featureFlagsToArray(before?.features)
  const previouslyPresent = previousFeatures.includes(feature)
  const shouldBePresent = action === "add"

  // Atomic toggle — no read-modify-write race (two concurrent saves can't drop a flag).
  await setOrgFeatureFlag(orgId, feature, shouldBePresent)

  if (previouslyPresent !== shouldBePresent) {
    const supportState = feature === SUPPORT_AI_DISABLED_FEATURE
      ? {
          oldValue: { supportAiEnabled: !previouslyPresent },
          newValue: { supportAiEnabled: !shouldBePresent },
        }
      : {}
    await logAudit(
      orgId,
      shouldBePresent ? "feature_flag_enabled" : "feature_flag_disabled",
      "organization",
      orgId,
      feature,
      { userId: auth.userId, ...supportState },
    )
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { features: true },
  })
  const features = featureFlagsToArray(org?.features)
  return NextResponse.json({ data: { features } })
})
