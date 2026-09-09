import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, filterWritableFields, stripNeverReturned } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { checkContactLimit } from "@/lib/plan-limits"
import { trackContactEvent } from "@/lib/contact-events"
import { refreshProfileForSource } from "@/lib/unified-profile/profile-builder"
import { applyAutoEarn } from "@/lib/loyalty"
import { CONTACT_LIFECYCLE_STAGES, isContactLifecycleStage } from "@/lib/contact-lifecycle"

const contactLifecycleStageSchema = z.enum(CONTACT_LIFECYCLE_STAGES)

const createContactSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional(),
  position: z.string().max(200).optional(),
  // D8 Loyalty birthday trigger — "" / absent → undefined; "1990-05-15" → Date.
  dateOfBirth: z
    .preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date())
    .optional(),
  companyId: z.string().optional(),
  source: z.string().max(50).optional(),
  brand: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  lifecycleStage: contactLifecycleStageSchema.optional(),
  tags: z.array(z.string()).optional(),
  preferredLanguage: z.enum(["ru", "en", "az"]).nullable().optional(),
})

export const GET = withRls(async (req, { orgId, session }) => {
  const role = session?.role || "admin"

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const companyId = searchParams.get("companyId") || ""
  const lifecycleStage = searchParams.get("lifecycleStage") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")

  if (lifecycleStage && !isContactLifecycleStage(lifecycleStage)) {
    return NextResponse.json({ error: "Invalid lifecycleStage" }, { status: 400 })
  }

  try {
    let where: Prisma.ContactWhereInput = {
      organizationId: orgId,
      ...(search ? { fullName: { contains: search, mode: "insensitive" as const } } : {}),
      ...(companyId ? { companyId } : {}),
      ...(lifecycleStage ? { lifecycleStage } : {}),
    }

    where = (await applyRecordFilter(
      orgId,
      session?.userId || "",
      role,
      "contact",
      where,
    )) as Prisma.ContactWhereInput

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { fullName: "asc" },
        include: { company: { select: { id: true, name: true } } },
      }),
      prisma.contact.count({ where }),
    ])

    const fieldPerms = await getFieldPermissions(orgId, role, "contact")
    const filteredContacts = contacts.map((contact: Record<string, unknown>) =>
      filterEntityFields(contact, fieldPerms, role),
    )

    return NextResponse.json({ success: true, data: { contacts: filteredContacts, total, page, limit } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRls(async (req, { orgId, session }) => {
  const role = session?.role || "admin"

  const body = await req.json()
  const parsed = createContactSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    // Check plan contact limit
    const limitCheck = await checkContactLimit(orgId)
    if (!limitCheck.allowed) {
      return NextResponse.json({ error: limitCheck.message }, { status: 403 })
    }

    const writableData = filterWritableFields(parsed.data, await getFieldPermissions(orgId, role, "contact"), role)
    const contact = await prisma.contact.create({ data: { organizationId: orgId, ...writableData } })
    logAudit(orgId, "create", "contact", contact.id, contact.fullName)
    executeWorkflows(orgId, "contact", "created", contact).catch(() => {})
    // CDP: build/refresh this contact's unified profile immediately (don't wait
    // for the hourly cron). Fire-and-forget — a CDP failure must not break create.
    refreshProfileForSource(prisma, orgId, "contact", contact.id).catch((e) =>
      console.error("[cdp-hook] contact-create profile refresh failed", e),
    )
    // Loyalty signup bonus — fire-and-forget, same RLS-context pattern as the
    // CDP hook above (verified). No-ops unless the tenant turned auto-earn on
    // AND has an active "signup" earning rule. Idempotent on referenceId=contactId.
    applyAutoEarn(prisma, {
      orgId,
      contactId: contact.id,
      trigger: "signup",
      referenceId: contact.id,
      reason: `Signup bonus — ${contact.fullName || contact.email || contact.id}`,
      requireAutoEarnEnabled: true,
    }).catch((e) => console.error("[loyalty auto-earn] signup", e))
    createNotification({
      organizationId: orgId,
      type: "info",
      title: "Новый контакт",
      message: `Добавлен контакт «${contact.fullName}»`,
      entityType: "contact",
      entityId: contact.id,
    }).catch(() => {})
    fireWebhooks(orgId, "contact.created", { id: contact.id, fullName: contact.fullName, email: contact.email }).catch(() => {})
    if (contact.source === "portal" || contact.source === "form" || contact.source === "website") {
      trackContactEvent(orgId, contact.id, "form_submitted", { source: contact.source }).catch(() => {})
    }
    // F-32: the list path filters, so this one should too. A freshly created
    // contact has empty portal columns, but consistency is the point —
    // the next person to add a credential column should not have to find
    // every raw-row response by hand.
    return NextResponse.json({ success: true, data: stripNeverReturned(contact) }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
