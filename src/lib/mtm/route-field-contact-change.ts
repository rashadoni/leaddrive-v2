import type { MtmSettingsShape } from "@/lib/mtm-settings"
import { contactClassOptions } from "@/lib/mtm/contact-classes"
import { contactSpecialtyOptions } from "@/lib/mtm/contact-specialties"
import { agentPermissionEnabled } from "@/lib/mtm/agent-permissions"

/**
 * What an agent may propose to change from the field app — the fields its
 * client card shows, nothing else. One list for the card (which offers them)
 * and for the request endpoint (which accepts them), so the app cannot offer a
 * field the server then refuses.
 */
export const ROUTE_FIELD_CONTACT_CHANGE_FIELDS = ["category", "specialtyName", "firstName", "lastName"] as const
export type RouteFieldContactChangeField = typeof ROUTE_FIELD_CONTACT_CHANGE_FIELDS[number]

type ChangeSettings = Pick<
  MtmSettingsShape,
  "contactHiddenFields" | "contactClasses" | "contactSpecialties" | "agentContactChangeRequests"
>

/** The fields, minus the ones the organization switched off for its clients. */
export function routeFieldContactChangeFields(
  settings: Pick<MtmSettingsShape, "contactHiddenFields">,
): RouteFieldContactChangeField[] {
  const hidden = new Set<string>(settings.contactHiddenFields)
  return ROUTE_FIELD_CONTACT_CHANGE_FIELDS.filter((field) => !hidden.has(field))
}

/**
 * The "propose a change" block of the Route Field client card: whether the
 * organization allows the request, which fields it covers and what each choice
 * offers. A client keeps the class or the specialty it already has in the
 * choices even when the organization no longer lists it.
 */
export function routeFieldContactChangeOffer(
  settings: ChangeSettings,
  contact: { category: string | null; specialtyName: string | null },
) {
  const fields = routeFieldContactChangeFields(settings)
  return {
    allowed: agentPermissionEnabled(settings, "contactChangeRequest"),
    fields,
    classes: contactClassOptions(settings.contactClasses, contact.category),
    specialties: fields.includes("specialtyName")
      ? contactSpecialtyOptions(settings.contactSpecialties, [contact.specialtyName])
      : [],
  }
}
