import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { SettingsUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { MTM_SETTING_DEFAULTS, getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { coerceMtmContactRequiredFields } from "@/lib/mtm/contact-required-fields"
import { parseMtmRouteTargetTypes } from "@/lib/mtm/route-target-types"

export const GET = withRls(async (_req: NextRequest, { orgId }) => {
  try {
    // Single source of truth: getMtmSettings merges org rows over the schema
    // defaults AND coerces types — the old inline DEFAULT_SETTINGS copy had
    // already drifted from the schema.
    const result = await getMtmSettings(orgId)
    return NextResponse.json({ success: true, data: result })
  } catch (e) {
    console.error("[MTM/settings GET]", e)
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 })
  }
})

export const PUT = withRlsAuth(undefined, undefined, async (req, auth) => {
  const ALLOWED_ROLES = ["admin", "manager", "superadmin"]
  if (!ALLOWED_ROLES.includes(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const orgId = auth.orgId
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const raw = await req.json()
    const parsed = parseBody(SettingsUpdateSchema, raw)
    if (!parsed.ok) return parsed.response
    // Whitelist to schema keys — the old endpoint persisted ANY key, which let
    // the UI save settings nothing ever read (decorative toggles). Unknown keys
    // are silently dropped so stale clients don't hard-fail.
    const body = Object.fromEntries(
      Object.entries(parsed.data).filter(([key, value]) => key in MTM_SETTING_DEFAULTS && value !== undefined)
    )
    if (typeof body.supportEmail === "string") body.supportEmail = body.supportEmail.trim()
    if (typeof body.supportPhone === "string") body.supportPhone = body.supportPhone.trim()
    if (body.contactRequiredFields !== undefined) {
      if (!Array.isArray(body.contactRequiredFields)) {
        return NextResponse.json({ error: "Contact required fields must be an array" }, { status: 400 })
      }
      body.contactRequiredFields = coerceMtmContactRequiredFields(body.contactRequiredFields)
    }
    if (body.routeTargetTypes !== undefined) {
      const targetTypes = parseMtmRouteTargetTypes(body.routeTargetTypes)
      if (!targetTypes.success) {
        return NextResponse.json({ error: targetTypes.error }, { status: 400 })
      }
      body.routeTargetTypes = targetTypes.data
    }
    if (body.timezone !== undefined && !isValidTimezone(body.timezone)) {
      return NextResponse.json({ error: "Invalid IANA timezone" }, { status: 400 })
    }
    if (
      body.supportEmail !== undefined
      && (
        typeof body.supportEmail !== "string"
        || body.supportEmail.length > 200
        || (body.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.supportEmail))
      )
    ) {
      return NextResponse.json({ error: "Invalid support email" }, { status: 400 })
    }
    if (
      body.supportPhone !== undefined
      && (typeof body.supportPhone !== "string" || body.supportPhone.length > 100)
    ) {
      return NextResponse.json({ error: "Invalid support phone" }, { status: 400 })
    }
    if (
      body.teamScheduleVisibilityEnabled !== undefined
      && typeof body.teamScheduleVisibilityEnabled !== "boolean"
    ) {
      return NextResponse.json({ error: "Team schedule visibility must be a boolean" }, { status: 400 })
    }
    if (body.routeTravelEnabled !== undefined && typeof body.routeTravelEnabled !== "boolean") {
      return NextResponse.json({ error: "Route travel must be a boolean" }, { status: 400 })
    }
    if (body.routeTravelNavigationEnabled !== undefined && typeof body.routeTravelNavigationEnabled !== "boolean") {
      return NextResponse.json({ error: "Route travel navigation must be a boolean" }, { status: 400 })
    }

    const previousTeamScheduleVisibility = body.teamScheduleVisibilityEnabled !== undefined
      ? (await getMtmSettings(orgId)).teamScheduleVisibilityEnabled
      : undefined

    const updates = Object.entries(body).map(([key, value]) => {
      const jsonValue = value as Prisma.InputJsonValue
      return prisma.mtmSetting.upsert({
        where: { organizationId_key: { organizationId: orgId, key } },
        create: { organizationId: orgId, key, value: jsonValue },
        update: { value: jsonValue },
      })
    })
    await Promise.all(updates)

    await writeMtmAudit({
      organizationId: orgId,
      agentId: null,
      action: "SETTINGS_UPDATE",
      entity: "settings",
      entityId: orgId,
      metadataKind: "settings_update",
      oldData: previousTeamScheduleVisibility === undefined
        ? undefined
        : { teamScheduleVisibilityEnabled: previousTeamScheduleVisibility },
      newData: {
        keys: Object.keys(body),
        ...(previousTeamScheduleVisibility === undefined
          ? {}
          : {
              teamScheduleVisibilityEnabled: body.teamScheduleVisibilityEnabled,
              actor: { userId: auth.userId, role: auth.role },
            }),
      },
      req,
    }).catch((e) => console.warn("[MTM/settings PUT] audit failed", e))

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update settings"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})
