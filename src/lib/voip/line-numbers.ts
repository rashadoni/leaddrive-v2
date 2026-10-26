import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Number -> organization for the PBX callbacks. Owner, 2026-10-26: «для
 * каждого клиента будет свой номер сип и для каждого клиента будет свой
 * сценарий». The station's callbacks carry no tenant: the first event of an
 * inbound call names the number dialled, and every later event names the call,
 * whose row already belongs to an organization. A number nobody holds keeps
 * the installation's default organization (VOICE_AGENT_ORGANIZATION_ID), so a
 * station that does not send the number yet behaves exactly as before.
 *
 * Reads here run under the RLS bypass by necessity — the tenant is what they
 * find out — and select nothing but the organization and channel ids.
 */

/** E.164 for a number as an operator or a PBX writes it; null when it is none.
 * Azerbaijani numbers come as 994…, 0… (ten digits), nine digits or +994…. */
export function normalizeLineNumber(raw: string | null | undefined): string | null {
  const compact = String(raw ?? "").trim().replace(/[\s().-]/gu, "")
  if (/^\+[1-9]\d{7,14}$/u.test(compact)) return compact
  if (/^00[1-9]\d{7,14}$/u.test(compact)) return `+${compact.slice(2)}`
  if (/^994\d{9}$/u.test(compact)) return `+${compact}`
  if (/^0\d{9}$/u.test(compact)) return `+994${compact.slice(1)}`
  // A provider's DID without the country code: nine digits, Azerbaijani.
  if (/^[1-9]\d{8}$/u.test(compact)) return `+994${compact}`
  return null
}

export type LineOwner = { organizationId: string; channelConfigId: string | null }

/** The organization holding the number dialled, or null. */
export async function lineNumberOwner(dialled: string | null | undefined): Promise<LineOwner | null> {
  const e164 = normalizeLineNumber(dialled)
  if (!e164) return null
  const row: LineOwner | null = await runWithRlsBypass(() => prisma.voiceLineNumber.findUnique({
    where: { e164 }, select: { organizationId: true, channelConfigId: true },
  }))
  return row ?? null
}

/** The organization an Asterisk call already belongs to, or null when there is
 * no such call or (never expected: the station mints a UUID per call) the id
 * appears in two organizations. */
export async function callOrganization(callId: string): Promise<string | null> {
  const rows: Array<{ organizationId: string }> = await runWithRlsBypass(() => prisma.callLog.findMany({
    where: { provider: "asterisk", providerCallId: callId },
    select: { organizationId: true }, take: 3,
  }))
  const organizations = new Set<string>(rows.map((row) => row.organizationId))
  return organizations.size === 1 ? [...organizations][0] : null
}

/**
 * The organization a PBX callback acts in: the call's own when it exists, else
 * the holder of the number dialled, else the installation default. Null only
 * when nothing is configured at all.
 */
export async function voiceOrganizationFor(input: { callId?: string | null; dialled?: string | null }): Promise<LineOwner | null> {
  if (input.callId) {
    const owner = await callOrganization(input.callId)
    if (owner) return { organizationId: owner, channelConfigId: null }
  }
  const line = await lineNumberOwner(input.dialled)
  if (line) return line
  const fallback = process.env.VOICE_AGENT_ORGANIZATION_ID?.trim()
  return fallback ? { organizationId: fallback, channelConfigId: null } : null
}
