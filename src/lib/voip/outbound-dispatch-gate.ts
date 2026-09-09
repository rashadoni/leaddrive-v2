const PAUSE_ENV_KEY = "VOICE_OUTBOUND_CALL_DISPATCH_PAUSED"

/**
 * Process-wide maintenance fence for every CRM-owned outbound voice dispatch.
 *
 * During a PBX transport cutover the application can keep serving read-only
 * VoIP probes and terminal callbacks while refusing to create a new
 * provider-side call attempt.
 */
export function isOutboundVoiceDispatchPaused(organizationId?: string): boolean {
  const value = process.env[PAUSE_ENV_KEY]?.trim() ?? ""
  // Missing is the backwards-compatible normal state. Once present, only the
  // two reviewed literals are accepted; a typo must stop calls, not open them.
  if (value === "" || value === "false") return false
  const pilotOrganizationId = process.env.VOICE_AGENT_ORGANIZATION_ID?.trim() || ""
  // A requested maintenance pause with a missing tenant binding fails closed.
  // In the normal reviewed configuration only the exact voice pilot is paused;
  // unrelated tenants and non-pilot providers remain available.
  return !pilotOrganizationId || !organizationId || organizationId === pilotOrganizationId
}

export const OUTBOUND_VOICE_DISPATCH_PAUSED_CODE = "voice_outbound_dispatch_paused"
