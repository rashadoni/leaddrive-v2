/**
 * The phone agent's own record on a call: `call_logs.consentAudit.phoneAgent`.
 *
 * Written once, when the call's session is given (handler.ts): which services
 * the call was told about, by the short codes the model uses for them. It is
 * what lets a tool run for this call, and what tells the call's result that
 * its Live and speech spend are the agent's to record.
 */
import { z } from "zod"

/** The key of the record in call_logs.consentAudit. */
export const PHONE_AGENT_MARKER = "phoneAgent"

const markerSchema = z.object({
  version: z.literal(1), providerCallId: z.uuid(),
  services: z.array(z.object({ code: z.string().regex(/^s\d{1,2}$/u), pageId: z.string().min(1).max(128) })).max(24),
})
export type PhoneAgentMarker = z.infer<typeof markerSchema>

/** The call's own record, when this very call has one. */
export function phoneAgentMarker(consentAudit: unknown, callId: string): PhoneAgentMarker | null {
  const value = consentAudit && typeof consentAudit === "object" && !Array.isArray(consentAudit)
    ? (consentAudit as Record<string, unknown>)[PHONE_AGENT_MARKER] : undefined
  const parsed = markerSchema.safeParse(value)
  return parsed.success && parsed.data.providerCallId === callId ? parsed.data : null
}
