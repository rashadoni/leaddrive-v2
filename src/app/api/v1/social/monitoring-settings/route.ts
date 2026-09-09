import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  getSocialMonitoringSettings,
  publicSocialMonitoringSettings,
  saveSocialMonitoringSettings,
} from "@/lib/social/monitoring-settings"
import { compileOrganizationSourceRoutePlans } from "@/lib/social/source-route-plan"
import { socialMonitoringScheduleStatus } from "@/lib/social/monitoring-schedule-status"
import {
  changesSensitiveMonitoringSettings,
  isBrowserSessionAdmin,
} from "@/lib/social/outbound-settings-access"

const settingsSchema = z.object({
  schedule: z.object({
    enabled: z.boolean().optional(),
    cadenceMinutes: z.coerce.number().int().min(15).max(31 * 24 * 60).optional(),
    reportWindowDays: z.coerce.number().int().min(1).max(31).optional(),
    timeZone: z.string().trim().min(1).max(100).optional(),
  }).optional(),
  searchIndex: z.object({
    enabled: z.boolean().optional(),
    provider: z.enum(["generic", "apify"]).optional(),
    endpoint: z.string().trim().max(2000).nullable().optional(),
    allowedHosts: z.union([z.array(z.string().max(255)), z.string()]).nullable().optional(),
    limit: z.coerce.number().int().min(1).max(100).nullable().optional(),
    includeComments: z.boolean().optional(),
    token: z.string().max(4096).nullable().optional(),
    clearToken: z.boolean().optional(),
    apifyActors: z.object({
      webSearch: z.string().trim().max(255).nullable().optional(),
      instagramProfile: z.string().trim().max(255).nullable().optional(),
      instagramHashtag: z.string().trim().max(255).nullable().optional(),
      facebookSearch: z.string().trim().max(255).nullable().optional(),
      facebookPosts: z.string().trim().max(255).nullable().optional(),
      tiktokSearch: z.string().trim().max(255).nullable().optional(),
      instagramComments: z.string().trim().max(255).nullable().optional(),
      facebookComments: z.string().trim().max(255).nullable().optional(),
      tiktokComments: z.string().trim().max(255).nullable().optional(),
    }).optional(),
  }).optional(),
  provider: z.object({
    allowedHosts: z.union([z.array(z.string().max(255)), z.string()]).nullable().optional(),
    replyAllowedHosts: z.union([z.array(z.string().max(255)), z.string()]).nullable().optional(),
  }).optional(),
}).strict()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Invalid monitoring settings"
}

export const GET = withRlsAuth("social", "read", async (_req: NextRequest, auth) => {
  const [settings, scheduleStatus] = await Promise.all([
    getSocialMonitoringSettings(auth.orgId),
    // Состояние расписания отдаётся вместе с настройками, потому что без него
    // страница показывает намерение («собирать ежедневно») и умалчивает о
    // факте — выключенный на сервере планировщик выглядел как тишина (#665).
    socialMonitoringScheduleStatus(auth.orgId).catch(error => {
      console.error("[social-monitoring-settings] schedule status failed", error)
      return null
    }),
  ])
  return NextResponse.json({
    success: true,
    data: { ...publicSocialMonitoringSettings(settings), scheduleStatus },
  })
})

export const PUT = withRlsAuth("social", "write", async (req: NextRequest, auth) => {
  const body = await req.json()
  const parsed = settingsSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  if (changesSensitiveMonitoringSettings(parsed.data) && !isBrowserSessionAdmin(auth)) {
    return NextResponse.json({ error: "browser_admin_required" }, { status: 403 })
  }

  // Остановка сбора по всему тенанту — админское действие. Переключатель в
  // интерфейсе виден только админу, и сервер обязан думать так же: иначе
  // ручку можно дёрнуть в обход UI, а по журналу потом не понять, почему
  // сбора не было.
  if (parsed.data.schedule?.enabled !== undefined && !["admin", "superadmin"].includes(auth.role)) {
    return NextResponse.json({ error: "admin_required" }, { status: 403 })
  }

  try {
    const saved = await saveSocialMonitoringSettings(auth.orgId, parsed.data)
    await compileOrganizationSourceRoutePlans(auth.orgId)
    logAudit(
      auth.orgId,
      "update",
      "social_monitoring_settings",
      auth.orgId,
      parsed.data.schedule?.enabled === undefined
        ? "monitoring providers"
        : `schedule ${parsed.data.schedule.enabled ? "enabled" : "disabled"}`,
      { userId: auth.userId },
    )
    // Ответ несёт то же состояние, что и GET: переключив расписание, страница
    // обязана сразу показать новую картину, а не потерять её до перезагрузки.
    const scheduleStatus = await socialMonitoringScheduleStatus(auth.orgId).catch(error => {
      console.error("[social-monitoring-settings] schedule status failed", error)
      return null
    })
    return NextResponse.json({
      success: true,
      data: { ...publicSocialMonitoringSettings(saved), scheduleStatus },
    })
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 })
  }
})

export const PATCH = PUT
