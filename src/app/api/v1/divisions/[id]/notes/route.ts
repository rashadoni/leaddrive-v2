import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { boardNoteAccess, noteCreateSchema } from "@/lib/tasks/board-notes"

type Ctx = { params: Promise<{ id: string }> }

/** GET /api/v1/divisions/[id]/notes — the board's notes, last changed first. Rules: src/lib/tasks/board-notes.ts. */
export const GET = withRlsAuth("tasks", "read", async (_req, auth, { params }: Ctx) => {
  const { id } = await params
  const access = await boardNoteAccess(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, divisionId: id })
  if (!access.found) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const notes = await prisma.boardNote.findMany({
    where: { organizationId: auth.orgId, divisionId: id },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { createdBy: { select: { id: true, name: true } } },
  })
  return NextResponse.json({ success: true, data: { notes, canWrite: access.canWrite } })
})

/** POST /api/v1/divisions/[id]/notes — add a note to the board. */
export const POST = withRlsAuth("tasks", "write", async (req, auth, { params }: Ctx) => {
  const { id } = await params
  const access = await boardNoteAccess(prisma, { organizationId: auth.orgId, userId: auth.userId, role: auth.role, divisionId: id })
  if (!access.found) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!access.canWrite) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const parsed = noteCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const note = await prisma.boardNote.create({
    data: { organizationId: auth.orgId, divisionId: id, ...parsed.data, createdById: auth.userId || null, updatedById: auth.userId || null },
    include: { createdBy: { select: { id: true, name: true } } },
  })
  logAudit(auth.orgId, "create", "board_note", note.id, note.title)
  return NextResponse.json({ success: true, data: note }, { status: 201 })
})
