import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { mtmFieldScopeRequiredResponse } from "@/lib/mtm/field-access"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { activeFieldAssignmentWindow, canManageFieldMasterData, contactDisplayName, contactScopeForActor } from "@/lib/mtm/field-scope"
import { buildAgentClientPicker, type PickerContactRow, type PickerInstitution } from "@/lib/mtm/agent-client-picker"
import { coerceMtmContactClasses } from "@/lib/mtm/contact-classes"

/** What the query below selects. */
type PickerSelectRow = {
  id: string
  firstName: string
  lastName: string
  middleName: string | null
  displayName: string | null
  specialtyName: string | null
  category: string
  workplaces: Array<{ customer: PickerInstitution }>
  agentAssignments: Array<{ agentId: string; role: string; agent: { name: string } }>
}

/** More than any tenant has today (the largest: 321); past it the answer says so instead of counting part. */
const MAX_CONTACTS = 5000
const MAX_VALUES = 50

function values(params: URLSearchParams, name: string): string[] {
  return [...new Set(params.getAll(name).map(value => value.trim()).filter(Boolean))].slice(0, MAX_VALUES)
}

/**
 * GET /api/v1/mtm/contacts/agent-picker?agentId=&specialty=…&city=…&district=…&class=…
 *
 * The «Клиенты агента» tab of an agent's card (src/lib/mtm/agent-client-picker.ts):
 * the specialties, the cities of those, the districts of those — each with
 * counts — and the active doctors that match, each with his class and his
 * institution, those of one institution next to each other. Only
 * doctors the caller may see, and only for someone who may assign them; with
 * `agentId`, the doctors already that agent's are marked.
 */
export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, { organizationId: auth.orgId, userId: auth.userId, webRole: auth.role, agentId: auth.agentId }),
    getMtmSettings(auth.orgId),
  ])
  if (!actor) return mtmFieldScopeRequiredResponse()
  if (!canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_CONTACT_ASSIGNMENT_FORBIDDEN" }, { status: 403 })
  }
  const params = new URL(req.url).searchParams
  const agentId = params.get("agentId")?.trim() || null
  if (agentId) {
    const agent = await prisma.mtmAgent.findFirst({ where: { id: agentId, organizationId: auth.orgId }, select: { id: true } })
    if (!agent || !isAgentInRouteScope(actor, agentId)) {
      return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_SCOPE_DENIED" }, { status: 403 })
    }
  }

  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)
  const scope = actor.role === "ADMIN" ? {} : contactScopeForActor(actor, asOf)
  const contacts: PickerSelectRow[] = await prisma.mtmContact.findMany({
    where: { organizationId: auth.orgId, deletedAt: null, status: "ACTIVE", ...scope },
    take: MAX_CONTACTS + 1,
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      middleName: true,
      displayName: true,
      specialtyName: true,
      category: true,
      workplaces: {
        where: { deletedAt: null, endedOn: null },
        orderBy: [{ isPrimary: "desc" }, { startedOn: "desc" }],
        take: 1,
        select: { customer: { select: {
          id: true, name: true, address: true, city: true, locality: true, district: true, administrativeDistrict: true, cityDistrict: true,
        } } },
      },
      agentAssignments: {
        where: activeFieldAssignmentWindow(asOf),
        select: { agentId: true, role: true, agent: { select: { name: true } } },
      },
    },
  })
  if (contacts.length > MAX_CONTACTS) {
    return NextResponse.json({ error: "Too many doctors to choose from here", code: "MTM_AGENT_PICKER_TOO_LARGE" }, { status: 422 })
  }

  const rows: PickerContactRow[] = contacts.map(contact => ({
    id: contact.id,
    name: contactDisplayName(contact),
    specialtyName: contact.specialtyName,
    category: contact.category,
    institution: contact.workplaces[0]?.customer ?? null,
    agents: contact.agentAssignments.map(assignment => ({ agentId: assignment.agentId, role: assignment.role, name: assignment.agent.name })),
  }))
  const picker = buildAgentClientPicker(rows, {
    specialties: values(params, "specialty"),
    cities: values(params, "city"),
    districts: values(params, "district"),
    classes: values(params, "class"),
  }, agentId, coerceMtmContactClasses(settings.contactClasses))
  return NextResponse.json({ success: true, data: { ...picker, asOf: asOf.toISOString().slice(0, 10) } }, { headers: { "Cache-Control": "no-store" } })
})
