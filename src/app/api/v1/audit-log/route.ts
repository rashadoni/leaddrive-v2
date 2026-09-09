import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/constants"
import { withRls } from "@/lib/with-rls"

const SYSTEM_PAID_RUN_AUDIT_ENTITY = "social_paid_run_authorization"
const SYSTEM_RESET_BOUNDARY_ACTION = "reset_boundary"
const SYSTEM_VOICE_PERMISSION_AUDIT_ENTITY = "lead_voice_permission"

const createAuditLogSchema = z.object({
  userId: z.string().optional(),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().optional(),
  entityName: z.string().optional(),
  oldValue: z.record(z.string(), z.any()).optional(),
  newValue: z.record(z.string(), z.any()).optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
})

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")
  const entityType = searchParams.get("entityType") || ""
  const entityId = searchParams.get("entityId") || ""

  try {
    const where = {
      organizationId: orgId,
      // Clean-slate enforcement snapshots are an internal budget ledger, not
      // tenant-facing audit history. In particular, never expose their
      // carry-forward payload through this generic endpoint.
      NOT: {
        OR: [
          {
            entityType: SYSTEM_PAID_RUN_AUDIT_ENTITY,
            action: SYSTEM_RESET_BOUNDARY_ACTION,
          },
          { entityType: SYSTEM_VOICE_PERMISSION_AUDIT_ENTITY },
        ],
      },
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.auditLog.count({ where }),
    ])

    const actorIds = Array.from(new Set(
      logs.map((log) => log.userId).filter((id): id is string => Boolean(id)),
    ))
    const actors = actorIds.length > 0
      ? await prisma.user.findMany({
          where: { organizationId: orgId, id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
      : []
    const actorsById = new Map(actors.map((actor) => [actor.id, actor]))
    const logsWithActors = logs.map((log) => {
      const actor = log.userId ? actorsById.get(log.userId) : undefined
      return {
        ...log,
        actorName: actor?.name || null,
        actorEmail: actor?.email || null,
      }
    })

    return NextResponse.json({
      success: true,
      data: { logs: logsWithActors, total, page, limit },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdmin(session.role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createAuditLogSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  if (
    parsed.data.entityType === SYSTEM_PAID_RUN_AUDIT_ENTITY
    || parsed.data.entityType === SYSTEM_VOICE_PERMISSION_AUDIT_ENTITY
  ) {
    // These entries affect immutable budget or voice-permission enforcement.
    // They may only be emitted by their trusted server-side workflows.
    return NextResponse.json({ error: "Reserved system audit entity" }, { status: 403 })
  }

  try {
    const log = await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        ...parsed.data,
      },
    })
    return NextResponse.json({ success: true, data: log }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
