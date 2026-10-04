import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { contactScopeForActor } from "@/lib/mtm/field-scope"
import { ContactChangeRequestSchema, parseBody } from "@/lib/mtm-validators"
import { getMtmSettings } from "@/lib/mtm-settings"
import { agentPermissionDeniedBody, agentPermissionEnabled } from "@/lib/mtm/agent-permissions"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"
import { submitMtmContactChangeRequest } from "@/lib/mtm/contact-change-request-submit"

type RouteContext = { params: Promise<{ id: string }> }

async function actorContext(auth: { orgId: string; userId: string; role: string; agentId: string | null }) {
  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`)
  return { actor, settings, asOf }
}

export const GET = withRouteFieldRlsAuth<RouteContext>("read", async (_req, auth, { params }) => {
  const { id: contactId } = await params
  const { actor, asOf } = await actorContext(auth)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const contact = await prisma.mtmContact.findFirst({
    where: {
      id: contactId,
      organizationId: auth.orgId,
      deletedAt: null,
      ...(actor.role === "ADMIN" ? {} : { AND: [contactScopeForActor(actor, asOf)] }),
    },
    select: { id: true },
  })
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const requests = await prisma.mtmContactChangeRequest.findMany({
    where: {
      organizationId: auth.orgId,
      contactId,
      ...(actor.role === "AGENT" ? { requestedByAgentId: actor.agentId ?? "__no_agent__" } : {}),
    },
    orderBy: { submittedAt: "desc" },
    take: 50,
    include: { requestedByAgent: { select: { id: true, name: true } } },
  })
  return NextResponse.json({ success: true, data: { requests } })
})
export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id: contactId } = await params
  const { actor, settings, asOf } = await actorContext(auth)
  if (!actor?.agentId || actor.role !== "AGENT") {
    return NextResponse.json({ error: "Managers edit master data directly", code: "MTM_CONTACT_DIRECT_EDIT_REQUIRED" }, { status: 403 })
  }
  // The organization may switch the request itself off ("what an agent may do").
  if (!agentPermissionEnabled(settings, "contactChangeRequest")) {
    return NextResponse.json(agentPermissionDeniedBody("contactChangeRequest"), { status: 403 })
  }

  const parsed = parseBody(ContactChangeRequestSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  return submitMtmContactChangeRequest({
    req,
    auth,
    actor: { ...actor, agentId: actor.agentId },
    settings,
    asOf,
    contactId,
    body: parsed.data,
  })
})
