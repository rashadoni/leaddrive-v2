import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields, isFieldVisible, stripNeverReturned } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { isContactLifecycleStage } from "@/lib/contact-lifecycle"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { createContactCommand } from "@/lib/crm-commands/contact/contact"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { crmCommandErrorResponse } from "@/lib/crm-commands/rest-response"
import { customerPhonesHiddenFrom } from "@/lib/customer-phone-privacy"
import {
  LIST_IDS_MAX,
  LIST_VIEW_MAX_LIMIT,
  containsInsensitive,
  isListView,
  listPaging,
  listSearchTerm,
} from "@/lib/list-view"

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
  const body = await req.json()
  const actor = createRestActorContext({ organizationId: orgId, userId: session?.userId, role: session?.role })
  try {
    // Одна команда с голосом (этап 3): права на поля, лимит тарифа, проверка
    // компании и всё, что следует за созданием, — там.
    const { entity: contact } = await createContactCommand(actor, body)
    // F-32: the list path filters, so this one should too. A freshly created
    // contact has empty portal columns, but consistency is the point —
    // the next person to add a credential column should not have to find
    // every raw-row response by hand.
    return NextResponse.json({ success: true, data: stripNeverReturned(contact) }, { status: 201 })
  } catch (e) {
    if (e instanceof CrmCommandError) return crmCommandErrorResponse(e)
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
