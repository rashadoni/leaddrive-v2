import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, stripNeverReturned } from "@/lib/field-filter"
import { fireWebhooks } from "@/lib/webhooks"
import { clearTaskRelations } from "@/lib/tasks/clear-task-relations"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { updateContactCommand } from "@/lib/crm-commands/contact/contact"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { crmCommandErrorResponse } from "@/lib/crm-commands/rest-response"

export const GET = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  const role = session?.role || "admin"
  const { id } = await params

  try {
    const contact = await prisma.contact.findFirst({
      where: { id, organizationId: orgId },
      include: {
        company: { select: { id: true, name: true } },
        activities: { where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 20 },
      },
    })
    if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const fieldPerms = await getFieldPermissions(orgId, role, "contact")
    const filtered = filterEntityFields(contact, fieldPerms, role)
    return NextResponse.json({ success: true, data: filtered })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const actor = createRestActorContext({ organizationId: orgId, userId: session?.userId, role: session?.role })
  try {
    // Одна команда с голосом (этап 3): права на поля, проверка компании,
    // журнал, автоматизации и вебхуки — там.
    const { entity: updated } = await updateContactCommand(actor, id, body)
    // F-32: PUT used to answer with the raw row, so a contact edit handed the
    // caller `portalPasswordHash` and `portalVerificationToken` — the second of
    // which is the link that sets the customer's portal password. GET filtered
    // fields; this path filtered nothing at all.
    return NextResponse.json({ success: true, data: stripNeverReturned(updated) })
  } catch (e) {
    if (e instanceof CrmCommandError) return crmCommandErrorResponse(e)
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// PATCH = partial-update alias of PUT. Both handlers do partial updates
// (updateMany only writes fields present in the body); we expose PATCH so
// inline-edit consumers can use the conventional REST verb.
export const PATCH = PUT

export const DELETE = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const existing = await prisma.contact.findFirst({ where: { id, organizationId: orgId }, select: { fullName: true } })
    const result = await prisma.contact.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    // Null out tasks that linked to this now-deleted contact (no FK → not auto-nulled).
    await clearTaskRelations(orgId, "contact", id)
    logAudit(orgId, "delete", "contact", id, existing?.fullName || "")
    fireWebhooks(orgId, "contact.deleted", { id, fullName: existing?.fullName }).catch(() => {})
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
