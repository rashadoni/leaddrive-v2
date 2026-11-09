import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { createActivityCommand } from "@/lib/crm-commands/activity/create-activity"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { crmCommandErrorResponse } from "@/lib/crm-commands/rest-response"
import { PAGE_SIZE } from "@/lib/constants"
import { checkPermission } from "@/lib/permissions"
import { activityWriteModules } from "@/lib/crm-commands/activity/activity-permissions"

export const GET = withRls(async (req: NextRequest, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get("companyId")
  const contactId = searchParams.get("contactId")
  const relatedType = searchParams.get("relatedType")
  const relatedId = searchParams.get("relatedId")

  try {
    const where: any = {
      organizationId: orgId,
      ...(companyId ? { companyId } : {}),
      ...(contactId ? { contactId } : {}),
      ...(relatedType ? { relatedType } : {}),
      ...(relatedId ? { relatedId } : {}),
    }

    const activities = await prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE.DEFAULT,
      include: {
        contact: { select: { fullName: true } },
        company: { select: { name: true } },
      },
    })

    // Resolve createdBy user names
    const userIds = [...new Set(activities.map((a: any) => a.createdBy).filter(Boolean))] as string[]
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds }, organizationId: orgId },
          select: { id: true, name: true },
        })
      : []
    const userMap = Object.fromEntries(users.map((u: any) => [u.id, u.name]))

    const enriched = activities.map((a: any) => ({
      ...a,
      createdByName: a.createdBy ? userMap[a.createdBy] || null : null,
    }))

    return NextResponse.json({ success: true, data: { activities: enriched } })
  } catch (e) {
    console.error("[activities GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth(undefined, undefined, async (req, auth) => {
  const body = await req.json()
  const denied = activityWriteModules(body).filter((module) => !checkPermission(auth.role, module, "write"))
  if (denied.length > 0) {
    return NextResponse.json(
      { error: "Forbidden", message: `Role "${auth.role}" cannot "write" on "${denied[0]}"` },
      { status: 403 },
    )
  }
  const actor = createRestActorContext({ organizationId: auth.orgId, userId: auth.userId, role: auth.role })
  try {
    // Одна команда с голосом (этап 3): проверка карточки, событие контакта и
    // выход из каденции после встречи — там.
    const { entity: activity } = await createActivityCommand(actor, body)
    return NextResponse.json({ success: true, data: activity }, { status: 201 })
  } catch (e) {
    if (e instanceof CrmCommandError) return crmCommandErrorResponse(e)
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
