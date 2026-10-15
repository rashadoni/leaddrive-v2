import type { Prisma } from "@prisma/client"

/**
 * Who a phone number belongs to, for signing in to the MTM app with a code sent
 * to WhatsApp (owner, 2026-10-15: «через WhatsApp приходил OTP-пароль, чтоб сами
 * назначали, а кадровик не занимался этой рутиной»).
 *
 * Numbers in the database were typed by people: «+994 50 123 45 67»,
 * «0501234567», «994501234567». They are compared by their digits, and a number
 * written the national way (a leading 0, no country code) matches the same
 * number written with its country code. No country is assumed: the number the
 * code is sent to must be written internationally on at least one side.
 */

/** Digits only, without an international «00» prefix. */
export function phoneDigits(value: string | null | undefined): string {
  if (!value) return ""
  const digits = value.replace(/\D/g, "")
  return digits.startsWith("00") ? digits.slice(2) : digits
}

/** Fewer significant digits than any real subscriber number: not a phone. */
const MIN_SIGNIFICANT_DIGITS = 8
const MAX_E164_DIGITS = 15

function isNational(digits: string): boolean {
  return digits.startsWith("0")
}

/** The same subscriber, however each side was written. */
export function phonesMatch(stored: string | null | undefined, entered: string | null | undefined): boolean {
  const a = phoneDigits(stored)
  const b = phoneDigits(entered)
  if (a.length < MIN_SIGNIFICANT_DIGITS || b.length < MIN_SIGNIFICANT_DIGITS) return false
  if (a === b) return true
  if (isNational(a) === isNational(b)) return false
  const national = (isNational(a) ? a : b).slice(1)
  const international = isNational(a) ? b : a
  return national.length >= MIN_SIGNIFICANT_DIGITS && international.endsWith(national)
}

/**
 * The number WhatsApp can deliver to, «+» and digits, or null when neither
 * side carries a country code.
 */
export function internationalNumber(stored: string | null | undefined, entered: string | null | undefined): string | null {
  for (const candidate of [phoneDigits(stored), phoneDigits(entered)]) {
    if (!isNational(candidate) && candidate.length > MIN_SIGNIFICANT_DIGITS && candidate.length <= MAX_E164_DIGITS) return `+${candidate}`
  }
  return null
}

/** «+994 50 ••• 45 67»-like: enough for a person to recognise the number, not to read it. */
export function maskedPhone(value: string): string {
  const digits = phoneDigits(value)
  if (digits.length < 6) return "•••"
  return `+${digits.slice(0, digits.length - 7)}•••${digits.slice(-4)}`
}

export const MOBILE_LOGIN_ORGANIZATION_SELECT = {
  id: true,
  name: true,
  isActive: true,
  plan: true,
  addons: true,
  features: true,
  modules: true,
} as const satisfies Prisma.OrganizationSelect

type LookupClient = {
  mtmAgent: { findMany: (args: { where: Prisma.MtmAgentWhereInput; select: { id: true; phone: true; userId: true } }) => Promise<Array<{ id: string; phone: string | null; userId: string | null }>> }
  user: { findMany: (args: { where: Prisma.UserWhereInput; select: { id: true; phone: true } }) => Promise<Array<{ id: string; phone: string | null }>> }
}

export type PhoneOwner =
  | { kind: "found"; agentId: string; sendTo: string | null }
  | { kind: "none" }
  | { kind: "ambiguous"; agentIds: string[] }

/**
 * The one active MTM card in this organization whose number is this one. An
 * office employee's number may live on the CRM user the card is linked to
 * (Personnel → Add employee wrote it there before 2026-10-15); the card's own
 * number wins when both are set. Two people with one number sign in by
 * nobody's code until HR corrects one of them.
 */
export async function findPhoneOwner(client: LookupClient, organizationId: string, entered: string): Promise<PhoneOwner> {
  if (phoneDigits(entered).length < MIN_SIGNIFICANT_DIGITS) return { kind: "none" }
  const agents = await client.mtmAgent.findMany({
    where: { organizationId, status: "ACTIVE" },
    select: { id: true, phone: true, userId: true },
  })
  const linkedIds = agents.filter(agent => !agent.phone && agent.userId).map(agent => agent.userId!)
  const userPhones = new Map<string, string | null>()
  if (linkedIds.length) {
    const users = await client.user.findMany({ where: { organizationId, id: { in: linkedIds }, isActive: true }, select: { id: true, phone: true } })
    for (const user of users) userPhones.set(user.id, user.phone)
  }
  const matches = agents
    .map(agent => ({ agentId: agent.id, stored: agent.phone ?? (agent.userId ? userPhones.get(agent.userId) ?? null : null) }))
    .filter(candidate => phonesMatch(candidate.stored, entered))
  if (matches.length === 0) return { kind: "none" }
  if (matches.length > 1) return { kind: "ambiguous", agentIds: matches.map(match => match.agentId).sort() }
  return { kind: "found", agentId: matches[0].agentId, sendTo: internationalNumber(matches[0].stored, entered) }
}

export type SignInPhoneCheck =
  | { ok: true; phone: string }
  | { ok: false; status: 400 | 409; code: "MTM_AGENT_PHONE_INVALID" | "MTM_AGENT_PHONE_TAKEN"; error: string }

/**
 * A number a manager types on a card is the number its holder signs in by — a
 * code goes to its WhatsApp (owner, 2026-10-16: «одно и то же правило для
 * сотрудников и агентов полевых»). So it is written with its country code
 * (spaces and dashes dropped), and no other active card in the company may
 * hold it: two people with one number would both be refused the code.
 */
export async function checkSignInPhone(client: LookupClient, organizationId: string, value: string, selfAgentId?: string): Promise<SignInPhoneCheck> {
  const phone = value.replace(/[\s\-()]/g, "")
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    return { ok: false, status: 400, code: "MTM_AGENT_PHONE_INVALID", error: "Write the WhatsApp number with its country code, e.g. +994501234567" }
  }
  const owner = await findPhoneOwner(client, organizationId, phone)
  const others = owner.kind === "found" ? [owner.agentId] : owner.kind === "ambiguous" ? owner.agentIds : []
  if (others.some(agentId => agentId !== selfAgentId)) {
    return { ok: false, status: 409, code: "MTM_AGENT_PHONE_TAKEN", error: "This number already belongs to another active employee or agent" }
  }
  return { ok: true, phone }
}
