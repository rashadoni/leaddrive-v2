import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { featureFlagsToArray } from "@/lib/modules"
import { SUPPORT_AI_DISABLED_FEATURE } from "@/lib/ai/feature-keys"
import {
  hasSupportAiSettingsEntitlement,
  isSupportAiSettingsRole,
} from "@/lib/ai/support-settings-access"

export const dynamic = "force-dynamic"

function readAuditedSupportState(value: unknown): boolean | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const enabled = (value as { supportAiEnabled?: unknown }).supportAiEnabled
  return typeof enabled === "boolean" ? enabled : null
}

/** Read-only settings projection with the latest persisted change evidence. */
export const GET = withRlsAuth("ai", "read", async (_req, auth) => {
  if (!isSupportAiSettingsRole(auth.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  }
  if (!(await hasSupportAiSettingsEntitlement(auth.orgId))) {
    return NextResponse.json({ error: "Support and AI add-ons required" }, { status: 403 })
  }

  const [organization, latestAudit] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: auth.orgId },
      select: { id: true, name: true, features: true },
    }),
    prisma.auditLog.findFirst({
      where: {
        organizationId: auth.orgId,
        entityType: "organization",
        entityId: auth.orgId,
        entityName: SUPPORT_AI_DISABLED_FEATURE,
        action: { in: ["feature_flag_enabled", "feature_flag_disabled"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        oldValue: true,
        newValue: true,
        createdAt: true,
      },
    }),
  ])

  if (!organization) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  }

  const actor = latestAudit?.userId
    ? await prisma.user.findFirst({
        where: { id: latestAudit.userId, organizationId: auth.orgId },
        select: { name: true, email: true },
      })
    : null

  return NextResponse.json({
    data: {
      enabled: !featureFlagsToArray(organization.features).includes(SUPPORT_AI_DISABLED_FEATURE),
      organization: { id: organization.id, name: organization.name },
      latestChange: latestAudit
        ? {
            id: latestAudit.id,
            actor: actor?.name || actor?.email || latestAudit.userId || null,
            previousEnabled: readAuditedSupportState(latestAudit.oldValue),
            newEnabled: readAuditedSupportState(latestAudit.newValue),
            changedAt: latestAudit.createdAt.toISOString(),
          }
        : null,
    },
  })
})
