/**
 * The pharmacy line's calls (and its callbacks) and demo calls are not sales
 * enquiries of the organization: they never become leads and are not counted
 * in «что я пропустил?».
 *
 * Any marker at all excludes the call, however malformed: this is the direction
 * in which being wrong costs nothing. The keys are written out so the voice
 * tools do not load the pharmacy line's modules; the test holds them equal to
 * the constants of the code that writes them.
 */
export const PHARMACY_PREVIEW_AUDIT_KEY = "pharmacyInboundPreview"
export const PHARMACY_CALLBACK_AUDIT_KEY = "pharmacyWaitlistCallback"
export const DEMO_AUDIT_VIA = "demo_center"

export function isLineOrDemoCall(consentAudit: unknown): boolean {
  if (!consentAudit || typeof consentAudit !== "object" || Array.isArray(consentAudit)) return false
  const audit = consentAudit as Record<string, unknown>
  return audit[PHARMACY_PREVIEW_AUDIT_KEY] !== undefined
    || audit[PHARMACY_CALLBACK_AUDIT_KEY] !== undefined
    || audit.via === DEMO_AUDIT_VIA
}
