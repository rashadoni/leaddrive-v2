import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, filterWritableFields, isFieldVisible, stripNeverReturned } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { checkContactLimit } from "@/lib/plan-limits"
import { trackContactEvent } from "@/lib/contact-events"
import { refreshProfileForSource } from "@/lib/unified-profile/profile-builder"
import { applyAutoEarn } from "@/lib/loyalty"
import { CONTACT_LIFECYCLE_STAGES, isContactLifecycleStage } from "@/lib/contact-lifecycle"
import { customerPhonesHiddenFrom } from "@/lib/customer-phone-privacy"
import {
  LIST_IDS_MAX,
  LIST_VIEW_MAX_LIMIT,
  containsInsensitive,
  isListView,
  listPaging,
  listSearchTerm,
} from "@/lib/list-view"

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

/** What the contacts list screen shows — and nothing else (`view=list`). */
const CONTACT_LIST_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  position: true,
  source: true,
  brand: true,
  category: true,
  companyId: true,
  isActive: true,
  portalAccessEnabled: true,
  // Read only to say whether a password is set; the hash itself never leaves
  // (stripNeverReturned), and the list gets `portalPasswordSet` instead.
  portalPasswordHash: true,
  engagementScore: true,
  company: { select: { id: true, name: true } },
} satisfies Prisma.ContactSelect

const CONTACT_LIST_SORTS: Record<string, Prisma.ContactOrderByWithRelationInput[]> = {
  name_asc: [{ fullName: "asc" }],
  name_desc: [{ fullName: "desc" }],
  // Postgres puts NULL last in ascending order: contacts without a company end the list.
  company: [{ company: { name: "asc" } }, { fullName: "asc" }],
  // "With e-mail first". Descending, because an empty string is a value too:
  // ascending would lead with the "" rows, descending ends with them, then NULL.
  email: [{ email: { sort: "desc", nulls: "last" } }, { fullName: "asc" }],
  active: [{ isActive: "desc" }, { fullName: "asc" }],
}

/** Above this many contacts the legacy (picker) shape stops; campaign-form asks for 1000. */
const LEGACY_MAX_LIMIT = 1000

export const GET = withRls(async (req, { orgId, session }) => {
  const role = session?.role || "admin"

  const { searchParams } = new URL(req.url)
  const listView = isListView(searchParams)
  const search = listSearchTerm(searchParams)
  const companyId = searchParams.get("companyId") || ""
  const lifecycleStage = searchParams.get("lifecycleStage") || ""
  const category = searchParams.get("category") || ""
  const { page, limit, skip } = listPaging(searchParams, {
    defaultLimit: 50,
    maxLimit: listView ? LIST_VIEW_MAX_LIMIT : LEGACY_MAX_LIMIT,
  })

  if (lifecycleStage && !isContactLifecycleStage(lifecycleStage)) {
    return NextResponse.json({ error: "Invalid lifecycleStage" }, { status: 400 })
  }

  try {
    const fieldPerms = await getFieldPermissions(orgId, role, "contact")
    const phonesMasked = customerPhonesHiddenFrom(session)
    const visible = (field: string) =>
      isFieldVisible(fieldPerms, role, field) && !(field === "phone" && phonesMasked)

    // The list screen searches what its rows show: name, e-mail, phone, brand
    // and the company — each only if this role may see it. Pickers keep the
    // name-only search they were built on.
    const searchWhere: Prisma.ContactWhereInput = !search
      ? {}
      : listView
        ? {
            AND: [{
              OR: [
                { fullName: containsInsensitive(search) },
                ...(visible("email") ? [{ email: containsInsensitive(search) }] : []),
                ...(visible("phone") ? [{ phone: containsInsensitive(search) }] : []),
                ...(visible("brand") ? [{ brand: containsInsensitive(search) }] : []),
                ...(visible("companyId") ? [{ company: { name: containsInsensitive(search) } }] : []),
              ],
            }],
          }
        : { fullName: containsInsensitive(search) }

    let where: Prisma.ContactWhereInput = {
      organizationId: orgId,
      ...searchWhere,
      ...(companyId ? { companyId } : {}),
      ...(lifecycleStage ? { lifecycleStage } : {}),
      ...(category ? { category } : {}),
    }

    where = (await applyRecordFilter(
      orgId,
      session?.userId || "",
      role,
      "contact",
      where,
    )) as Prisma.ContactWhereInput

    // "Select all N found": the ids of every match, so a bulk action can reach
    // past the page on screen.
    if (listView && searchParams.get("idsOnly") === "1") {
      const rows = await prisma.contact.findMany({
        where,
        select: { id: true },
        orderBy: { id: "asc" },
        take: LIST_IDS_MAX,
      })
      return NextResponse.json({ success: true, data: { ids: rows.map((r) => r.id), capped: rows.length === LIST_IDS_MAX } })
    }

    // A sort by a hidden column would leak its order; fall back to the name.
    const sortKey = searchParams.get("sort") || ""
    const sortField: Record<string, string> = { company: "companyId", email: "email", active: "isActive" }
    const sort = (sortField[sortKey] && !visible(sortField[sortKey]) ? undefined : CONTACT_LIST_SORTS[sortKey])
      ?? CONTACT_LIST_SORTS.name_asc
    const [contacts, total, stats] = await Promise.all([
      listView
        ? prisma.contact.findMany({
            where,
            skip,
            take: limit,
            // id last: equal names must not swap places between two pages.
            orderBy: [...sort, { id: "asc" }],
            select: CONTACT_LIST_SELECT,
          })
        : prisma.contact.findMany({
            where,
            skip,
            take: limit,
            orderBy: { fullName: "asc" },
            include: { company: { select: { id: true, name: true } } },
          }),
      prisma.contact.count({ where }),
      listView ? contactListStats(orgId, visible) : Promise.resolve(undefined),
    ])

    const filteredContacts = contacts.map((contact: Record<string, unknown>) =>
      filterEntityFields(
        listView ? { ...contact, portalPasswordSet: Boolean(contact.portalPasswordHash) } : contact,
        fieldPerms,
        role,
      ),
    )

    return NextResponse.json({
      success: true,
      data: { contacts: filteredContacts, total, page, limit, ...(stats ? { stats } : {}) },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/**
 * The counters above the contacts list: the whole book, not the search.
 * Engagement bands are the screen's: hot ≥ 50, warm 20–49, cold < 20.
 *
 * One pass over the organization's rows instead of six COUNTs side by side.
 * It is keyed on the organization alone because contacts have no record-level
 * rules (`applyRecordFilter` returns the query unchanged for "contact"); if
 * they ever get some, these counters must follow them. RLS applies as usual.
 */
async function contactListStats(orgId: string, visible: (field: string) => boolean) {
  const [row] = await prisma.$queryRaw<{
    total: number
    active: number
    withEmail: number
    withPhone: number
    hot: number
    warm: number
  }[]>`
    SELECT count(*)::int AS "total",
           count(*) FILTER (WHERE "isActive")::int AS "active",
           count(*) FILTER (WHERE "email" IS NOT NULL AND "email" <> '')::int AS "withEmail",
           count(*) FILTER (WHERE "phone" IS NOT NULL AND "phone" <> '')::int AS "withPhone",
           count(*) FILTER (WHERE "engagementScore" >= 50)::int AS "hot",
           count(*) FILTER (WHERE "engagementScore" >= 20 AND "engagementScore" < 50)::int AS "warm"
      FROM "contacts"
     WHERE "organizationId" = ${orgId}`
  const total = row?.total ?? 0
  // A counter over a column the role cannot see is null, not a number.
  const ifVisible = (field: string, n: number | undefined) => (visible(field) ? n ?? 0 : null)
  const hot = ifVisible("engagementScore", row?.hot)
  const warm = ifVisible("engagementScore", row?.warm)
  return {
    total,
    active: ifVisible("isActive", row?.active),
    withEmail: ifVisible("email", row?.withEmail),
    withPhone: ifVisible("phone", row?.withPhone),
    hot,
    warm,
    cold: hot === null || warm === null ? null : total - hot - warm,
  }
}

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
