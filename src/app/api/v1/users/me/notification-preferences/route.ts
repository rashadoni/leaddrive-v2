/**
 * GET  /api/v1/users/me/notification-preferences
 *   → { success: true, data: { sections: SectionRow[] } }
 *
 * PUT  /api/v1/users/me/notification-preferences
 *   body: { section: string, push?: boolean, types?: Record<string, boolean> }
 *   → { success: true, data: { section: SectionRow } }
 *
 * Accessibility-aware: sections the viewer's role+org-feature can't access are
 * returned with accessible=false (GET) and are rejected with 400 (PUT).
 * The stored prefs are merged into UserPreference.data.notificationPreferences,
 * preserving other keys (favorites/recents/etc.).
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getOrgModuleContext } from "@/lib/api-auth"
import { withRlsSessionAuth } from "@/lib/with-rls"
import type { Role } from "@/lib/permissions"
import {
  NAV_GROUP_ORDER,
  kindsForSection,
} from "@/lib/notifications/taxonomy"
import { canNotifySection } from "@/lib/notifications/access"
import {
  type NotificationPrefs,
  DEFAULT_SECTION_PUSH,
} from "@/lib/notifications/prefs"

const putSchema = z.object({
  section: z.string().min(1),
  push: z.boolean().optional(),
  types: z.record(z.string(), z.boolean()).optional(),
})

/** Build one SectionRow from stored prefs + access ctx. */
function buildSectionRow(
  section: string,
  stored: NotificationPrefs,
  accessible: boolean
) {
  const kinds = kindsForSection(section)
  return {
    key: section,
    accessible,
    push: stored[section]?.push ?? DEFAULT_SECTION_PUSH[section] ?? false,
    types: kinds.map((k) => ({
      key: k,
      enabled: stored[section]?.types?.[k] ?? true,
    })),
  }
}

export const GET = withRlsSessionAuth(async (req, session) => {
  const { userId, orgId, role } = session

  try {
    const orgCtx = await getOrgModuleContext(orgId)
    const ctx = { role: role as Role, ...orgCtx }

    const pref = await prisma.userPreference.findUnique({ where: { userId } })
    const stored: NotificationPrefs =
      ((pref?.data as any)?.notificationPreferences as NotificationPrefs) ?? {}

    const sections = NAV_GROUP_ORDER.filter(
      (section) => kindsForSection(section).length > 0
    ).map((section) =>
      buildSectionRow(section, stored, canNotifySection(ctx, section))
    )

    return NextResponse.json({ success: true, data: { sections } })
  } catch (e) {
    console.error("[notification-preferences GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsSessionAuth(async (req, session) => {
  const { userId, orgId, role } = session

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { section, push, types } = parsed.data

  // FIX E: validate types keys against kindsForSection; reject unknown keys with 400.
  if (types !== undefined) {
    const validKinds = new Set(kindsForSection(section))
    const unknownKeys = Object.keys(types).filter((k) => !validKinds.has(k))
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        {
          error: "Validation error",
          message: `Unknown notification type key(s): ${unknownKeys.join(", ")}. Valid keys for section "${section}": ${[...validKinds].join(", ") || "(none)"}`,
        },
        { status: 400 }
      )
    }
  }

  try {
    const orgCtx = await getOrgModuleContext(orgId)
    const ctx = { role: role as Role, ...orgCtx }

    if (!canNotifySection(ctx, section)) {
      return NextResponse.json(
        { error: "Cannot set preferences for an inaccessible section" },
        { status: 400 }
      )
    }

    // Load current stored prefs to do a deep merge (preserve other data keys).
    const existing = await prisma.userPreference.findUnique({ where: { userId } })
    const existingData: Record<string, unknown> = (existing?.data as Record<string, unknown>) ?? {}
    const storedPrefs: NotificationPrefs =
      (existingData.notificationPreferences as NotificationPrefs) ?? {}

    // Merge: only overwrite what was provided in the body.
    const currentSection = storedPrefs[section] ?? {}
    const updatedSection: { push: boolean; types?: Record<string, boolean> } = {
      push: push !== undefined ? push : (currentSection.push ?? DEFAULT_SECTION_PUSH[section] ?? false),
      types: types !== undefined
        ? { ...(currentSection.types ?? {}), ...types }
        : currentSection.types,
    }

    const updatedPrefs: NotificationPrefs = {
      ...storedPrefs,
      [section]: updatedSection,
    }

    await prisma.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        organizationId: orgId,
        data: {
          ...existingData,
          notificationPreferences: updatedPrefs,
        },
      },
      update: {
        data: {
          ...existingData,
          notificationPreferences: updatedPrefs,
        },
      },
    })

    const sectionRow = buildSectionRow(section, updatedPrefs, true)
    return NextResponse.json({ success: true, data: { section: sectionRow } })
  } catch (e) {
    console.error("[notification-preferences PUT]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
