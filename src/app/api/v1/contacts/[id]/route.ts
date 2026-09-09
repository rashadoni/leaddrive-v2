import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, filterWritableFields, stripNeverReturned } from "@/lib/field-filter"
import { executeWorkflows } from "@/lib/workflow-engine"
import { fireWebhooks } from "@/lib/webhooks"
import { clearTaskRelations } from "@/lib/tasks/clear-task-relations"
import { CONTACT_LIFECYCLE_STAGES } from "@/lib/contact-lifecycle"

const contactLifecycleStageSchema = z.enum(CONTACT_LIFECYCLE_STAGES)

const updateContactSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  phone: z.string().max(50).nullable().optional(),
  phones: z.array(z.string().max(50)).optional(),
  position: z.string().max(200).nullable().optional(),
  // D8 Loyalty birthday trigger. .optional() is OUTERMOST so an ABSENT key
  // short-circuits before preprocess (never clears the column); "" → null
  // (clear); "1990-05-15" → Date.
  dateOfBirth: z
    .preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable())
    .optional(),
  companyId: z.string().nullable().optional(),
  source: z.string().max(50).nullable().optional(),
  brand: z.string().max(100).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  lifecycleStage: contactLifecycleStageSchema.optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  portalAccessEnabled: z.boolean().optional(),
  preferredLanguage: z.enum(["ru", "en", "az"]).nullable().optional(),
})

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
  const role = session?.role || "admin"
  const { id } = await params
  const body = await req.json()
  const parsed = updateContactSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    const writableData = filterWritableFields(parsed.data, await getFieldPermissions(orgId, role, "contact"), role)
    const result = await prisma.contact.updateMany({ where: { id, organizationId: orgId }, data: writableData })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const updated = await prisma.contact.findFirst({ where: { id, organizationId: orgId } })
    logAudit(orgId, "update", "contact", id, updated?.fullName || "", { newValue: parsed.data })
    if (updated) {
      executeWorkflows(orgId, "contact", "updated", updated).catch(() => {})
      fireWebhooks(orgId, "contact.updated", { id: updated.id, fullName: updated.fullName, email: updated.email }).catch(() => {})
    }
    // F-32: PUT used to answer with the raw row, so a contact edit handed the
    // caller `portalPasswordHash` and `portalVerificationToken` — the second of
    // which is the link that sets the customer's portal password. GET filtered
    // fields; this path filtered nothing at all.
    return NextResponse.json({ success: true, data: updated ? stripNeverReturned(updated) : updated })
  } catch (e) {
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
