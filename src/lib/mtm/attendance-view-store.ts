import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { AttendanceViewConfigSchema, AttendanceViewCreateSchema, AttendanceViewDeleteSchema, AttendanceViewUpdateSchema, type AttendanceView } from "@/lib/mtm/attendance-view-contract"

const ENTITY_TYPE = "mtm_attendance"
const MAX_VIEWS = 30
export class AttendanceViewError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code) }
}
const select = { id: true, name: true, filters: true, updatedAt: true } as const
function serialize(row: { id: string; name: string; filters: Prisma.JsonValue; updatedAt: Date }): AttendanceView {
  return { id: row.id, name: row.name, config: AttendanceViewConfigSchema.parse(row.filters), version: row.updatedAt.toISOString() }
}
const ownerWhere = (organizationId: string, userId: string) => ({ organizationId, userId, entityType: ENTITY_TYPE, isShared: false })

export async function readAttendanceViews(organizationId: string, userId: string) {
  return (await prisma.savedView.findMany({ where: ownerWhere(organizationId, userId), select, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(serialize)
}

/** Personal preferences only: the report independently rechecks the live scope. */
export async function saveAttendanceView(input: { organizationId: string; userId: string; value: unknown; id?: string; remove?: boolean }) {
  if (input.remove && !input.id) throw new AttendanceViewError("MTM_ATTENDANCE_VIEW_INVALID", 400)
  const schema = input.remove ? AttendanceViewDeleteSchema : input.id ? AttendanceViewUpdateSchema : AttendanceViewCreateSchema
  const parsed = schema.safeParse(input.value)
  if (!parsed.success) throw new AttendanceViewError("MTM_ATTENDANCE_VIEW_INVALID", 400)
  const draft = parsed.data
  const where = ownerWhere(input.organizationId, input.userId)
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'")
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-views:${input.organizationId}:${input.userId}`}, 0))`
    if ("requestId" in draft) {
      const id = `mtm_attendance_${input.userId}_${draft.requestId}`
      const existing = await tx.savedView.findFirst({ where: { ...where, id }, select })
      if (existing) {
        const view = serialize(existing)
        if (view.name !== draft.name || JSON.stringify(view.config) !== JSON.stringify(draft.config)) throw new AttendanceViewError("MTM_ATTENDANCE_VIEW_CHANGED", 409)
        return view
      }
      if (await tx.savedView.count({ where }) >= MAX_VIEWS) throw new AttendanceViewError("MTM_ATTENDANCE_VIEW_LIMIT", 409)
      return serialize(await tx.savedView.create({ data: { ...where, id, name: draft.name, filters: draft.config as Prisma.InputJsonValue }, select }))
    }
    const existing = await tx.savedView.findFirst({ where: { ...where, id: input.id }, select })
    if (!existing) throw new AttendanceViewError("MTM_ATTENDANCE_VIEW_NOT_FOUND", 404)
    if (existing.updatedAt.toISOString() !== draft.version) throw new AttendanceViewError("MTM_ATTENDANCE_VIEW_CHANGED", 409)
    const exact = { ...where, id: existing.id, updatedAt: existing.updatedAt }
    if ("config" in draft) {
      const updatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1))
      const updated = await tx.savedView.updateMany({ where: exact, data: { name: draft.name, filters: draft.config as Prisma.InputJsonValue, updatedAt } })
      if (updated.count !== 1) throw new AttendanceViewError("MTM_ATTENDANCE_VIEW_CHANGED", 409)
      return { id: existing.id, name: draft.name, config: draft.config, version: updatedAt.toISOString() }
    }
    const deleted = await tx.savedView.deleteMany({ where: exact })
    if (deleted.count !== 1) throw new AttendanceViewError("MTM_ATTENDANCE_VIEW_CHANGED", 409)
    return null
  })
}
