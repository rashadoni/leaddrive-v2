import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { isTeamAdmin } from "@/lib/tasks/board-teams"
import { DEFAULT_REPORTER_KEY, resolveDefaultReporter } from "@/lib/tasks/default-reporter"

/**
 * GET /api/v1/tasks/default-reporter — who stands as «Tapşırığı verən» on a new
 * task unless its maker picks somebody else; the task windows read it to show
 * it filled in. PUT — set or clear it, by the admin («Komandalar və
 * istifadəçilər»). Rules: src/lib/tasks/default-reporter.ts.
 */
const bodySchema = z.object({ reporterId: z.string().min(1).max(64).nullable() })

export const GET = withRlsAuth("tasks", "read", async (_req, auth) => {
  const reporter = await resolveDefaultReporter(prisma, auth.orgId)
  return NextResponse.json({ success: true, data: { reporter, canManage: isTeamAdmin(auth.role) } })
})

export const PUT = withRlsAuth("tasks", "write", async (req, auth) => {
  if (!isTeamAdmin(auth.role)) {
    return NextResponse.json({ error: "Forbidden", message: "Only an admin sets the default reporter" }, { status: 403 })
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const { reporterId } = parsed.data

  let reporter: { id: string; name: string } | null = null
  if (reporterId) {
    reporter = await prisma.user.findFirst({
      where: { id: reporterId, organizationId: auth.orgId, isActive: true },
      select: { id: true, name: true },
    })
    if (!reporter) return NextResponse.json({ error: "reporterId must be an active member of this organization" }, { status: 400 })
  }

  const org = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  const settings = { ...((org?.settings ?? {}) as Record<string, unknown>) }
  if (reporter) settings[DEFAULT_REPORTER_KEY] = reporter.id
  else delete settings[DEFAULT_REPORTER_KEY]
  await prisma.organization.update({ where: { id: auth.orgId }, data: { settings: settings as object } })
  logAudit(auth.orgId, "update", "task_default_reporter", auth.orgId, reporter?.name ?? "—", { userId: auth.userId })

  return NextResponse.json({ success: true, data: { reporter, canManage: true } })
})
