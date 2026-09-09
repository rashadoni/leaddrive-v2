import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { withMobileRls } from "@/lib/with-mobile-rls"

const VALID_STATUSES = new Set(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "OVERDUE"])

type MobileTaskRow = {
  [key: string]: unknown
  status: string
  dueDate: Date | null
  sourceKey: string | null
}

export const GET = withMobileRls(async (req, auth) => {
  const { searchParams } = new URL(req.url)
  const requestedStatus = searchParams.get("status")
  const search = searchParams.get("search")?.trim().slice(0, 100) ?? ""
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit")) || 100))
  const status = requestedStatus && VALID_STATUSES.has(requestedStatus) ? requestedStatus : null

  try {
    const [tasks, settings] = await Promise.all([
      prisma.mtmTask.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: auth.agentId,
          deletedAt: null,
          ...(status ? { status: status as "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "OVERDUE" } : {}),
          ...(search ? {
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              { description: { contains: search, mode: "insensitive" as const } },
              { customer: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          } : {}),
        },
        take: limit,
        orderBy: [{ dueDate: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
        include: {
          customer: { select: { id: true, name: true, objectType: true, address: true, city: true } },
          events: {
            orderBy: { occurredAt: "desc" },
            take: 50,
            select: {
              id: true,
              clientEventId: true,
              type: true,
              occurredAt: true,
              comment: true,
              evidence: true,
              fromStatus: true,
              toStatus: true,
              oldDueDate: true,
              newDueDate: true,
            },
          },
        },
      }),
      getMtmSettings(auth.orgId),
    ])

    const now = Date.now()
    const items = tasks.map((task: MobileTaskRow) => ({
      ...task,
      persistedStatus: task.status,
      status: task.status !== "COMPLETED" && task.status !== "CANCELLED" && task.dueDate && task.dueDate.getTime() < now
        ? "OVERDUE"
        : task.status,
      canEditContent: task.sourceKey?.startsWith("mobile-self:") ?? false,
    }))

    return NextResponse.json({
      success: true,
      data: {
        tasks: items,
        capabilities: {
          createSelfTask: settings.taskSelfCreate,
          recurringTasks: settings.taskSelfCreate && settings.taskSelfRecurring,
        },
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/tasks GET]", error)
    return NextResponse.json({ error: "Failed to load mobile tasks" }, { status: 500 })
  }
})
