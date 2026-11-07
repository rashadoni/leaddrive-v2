import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { boardNoteAccess, noteUpdateSchema } from "@/lib/tasks/board-notes"

type Ctx = { params: Promise<{ id: string; noteId: string }> }

async function writable(auth: { orgId: string; userId?: string | null; role: string }, id: string, noteId: string) {
  const access = await boardNoteAccess(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, divisionId: id })
  if (!access.found) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  const note = await prisma.boardNote.findFirst({ where: { id: noteId, organizationId: auth.orgId, divisionId: id }, select: { id: true } })
  if (!note) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  if (!access.canWrite) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { error: null }
}

/** PATCH /api/v1/divisions/[id]/notes/[noteId] — change a note's title or text. */
export const PATCH = withRlsAuth("tasks", "write", async (req, auth, { params }: Ctx) => {
  const { id, noteId } = await params
  const { error } = await writable(auth, id, noteId)
  if (error) return error
  const parsed = noteUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const note = await prisma.boardNote.update({
    where: { id: noteId },
    data: { ...parsed.data, updatedById: auth.userId || null },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  logAudit(auth.orgId, "update", "board_note", note.id, note.title)
  return NextResponse.json({ success: true, data: note })
})

/** DELETE /api/v1/divisions/[id]/notes/[noteId] — remove a note. */
export const DELETE = withRlsAuth("tasks", "write", async (_req, auth, { params }: Ctx) => {
  const { id, noteId } = await params
  const { error } = await writable(auth, id, noteId)
  if (error) return error
  await prisma.boardNote.deleteMany({ where: { id: noteId, organizationId: auth.orgId, divisionId: id } })
  logAudit(auth.orgId, "delete", "board_note", noteId)
  return NextResponse.json({ success: true })
})
