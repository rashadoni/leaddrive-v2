import { z } from "zod"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { agentPermissionDeniedBody, agentPermissionEnabled } from "@/lib/mtm/agent-permissions"
import { MTM_CONTACT_CLASS_VALUES } from "@/lib/mtm/contact-classes"
import { contactSpecialtyKey } from "@/lib/mtm/contact-specialties"
import { submitMtmContactChangeRequest } from "@/lib/mtm/contact-change-request-submit"
import { routeFieldContactChangeFields } from "@/lib/mtm/route-field-contact-change"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone } from "@/lib/timezone"

/**
 * What the field app may propose: only what its client card shows. The card is
 * a privacy-minimised projection (no personal phones, e-mail, address), so the
 * request is as narrow — an agent cannot propose a change to a field the app
 * never showed them. `.strict()` turns any other key into a 400 instead of
 * quietly passing it on to the broad website schema.
 */
const bodySchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  reason: z.string().trim().min(3).max(1000),
  expectedContactUpdatedAt: z.string().datetime({ offset: true }),
  changes: z.object({
    category: z.enum(MTM_CONTACT_CLASS_VALUES).optional(),
    specialtyName: z.string().trim().min(1).max(80).optional(),
    firstName: z.string().trim().min(1).max(120).optional(),
    lastName: z.string().trim().min(1).max(120).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "At least one change is required"),
}).strict()

function refused(error: string, code: string, field: string) {
  return NextResponse.json({ error, code, field }, { status: 400 })
}

/**
 * POST /api/v2/mtm/mobile/route-field/contacts/:id/change-requests
 *
 * An agent asks a manager to change a client from the field app. Nothing is
 * changed here: the request waits for approval exactly like one filed on the
 * website, and is stored by the same function.
 */
export const POST = withMobileRls(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) return permission

  const { id: rawId } = await params
  const contactId = rawId.trim()
  if (!contactId) {
    return NextResponse.json({ error: "Contact id is required", code: "MTM_ROUTE_FIELD_CONTACT_ID_REQUIRED" }, { status: 400 })
  }

  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  if (!actor || actor.role !== "AGENT" || !actor.agentId || actor.agentId !== auth.agentId) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" }, { status: 403 })
  }
  // The organization may switch the request itself off ("what an agent may do").
  if (!agentPermissionEnabled(settings, "contactChangeRequest")) {
    return NextResponse.json(agentPermissionDeniedBody("contactChangeRequest"), { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request" }, { status: 400 })
  }
  const { changes, ...request } = parsed.data

  // The same choices the card offered: a field the organization switched off
  // is not proposed, a class or a specialty comes from the organization's list.
  const offered = routeFieldContactChangeFields(settings)
  const notOffered = Object.keys(changes).find((field) => !(offered as readonly string[]).includes(field))
  if (notOffered) {
    return refused("The organization does not use this field", "MTM_CONTACT_FIELD_NOT_OFFERED", notOffered)
  }
  if (changes.category && !settings.contactClasses.includes(changes.category)) {
    return refused("The organization does not use this class", "MTM_CONTACT_CLASS_NOT_OFFERED", "category")
  }
  if (changes.specialtyName) {
    const wanted = contactSpecialtyKey(changes.specialtyName)
    const listed = settings.contactSpecialties.find((name) => contactSpecialtyKey(name) === wanted)
    if (!listed) {
      return refused("The organization's list has no such specialty", "MTM_CONTACT_SPECIALTY_NOT_OFFERED", "specialtyName")
    }
    // Stored as the organization spells it, not as the phone typed it.
    changes.specialtyName = listed.trim()
  }

  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  return submitMtmContactChangeRequest({
    req,
    auth,
    actor: { ...actor, agentId: actor.agentId },
    settings,
    asOf: new Date(`${currentDateKey(new Date(), timezone)}T00:00:00.000Z`),
    contactId,
    body: { ...request, kind: "CONTACT_UPDATE", payload: changes },
  })
}, { requiredCapability: "route-field" })
