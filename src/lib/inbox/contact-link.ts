/**
 * «Bu eyni müştəridir» — an Instagram or Messenger conversation tied to the CRM customer it belongs to.
 *
 * Owner, 2026-11-15 (list approved «Давай»): one customer, one feed — his Instagram, Messenger, WhatsApp
 * and calls together. WhatsApp knows its customer by phone and writes `contactId` on every message;
 * Instagram and Messenger only ever hand over a page-scoped sender id, so their conversations never met
 * the same person's WhatsApp. The link lives on the conversation (`SocialConversation.contactId`), which
 * makes it exact both ways: every past and future message of that account follows it, and «Ayır» puts
 * everything back as it was.
 *
 * Nothing is merged without a person. A name is a guess, and so is a number typed in the chat: a
 * customer writes her husband's number for the delivery, and her Instagram would join his WhatsApp.
 * A number or e-mail from the chat that belongs to exactly ONE customer becomes a suggestion, which a
 * manager confirms with one press.
 */

import type { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { azerbaijaniLocalPart } from "@/lib/inbox/customer-phone"

import { isContactLinkablePlatform } from "@/lib/inbox/contact-link-platforms"

export { CONTACT_LINKABLE_PLATFORMS, isContactLinkablePlatform, type ContactLinkablePlatform } from "@/lib/inbox/contact-link-platforms"

/**
 * One spelling per phone number, so «+994 50 123 45 67», «050 123 45 67» and «994501234567» compare
 * equal. A foreign number keeps all its digits. Null for anything that is not a phone.
 */
export function phoneKey(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, "")
  if (!digits) return null
  const local = azerbaijaniLocalPart(digits) ?? (digits.length === 9 ? azerbaijaniLocalPart(`0${digits}`) : null)
  if (local) return `994${local}`
  if (digits.length < 10 || digits.length > 15 || /^(\d)\1+$/.test(digits)) return null
  return digits
}

const PHONE_IN_TEXT = /\+?\d[\d\s().-]{6,}\d/g
const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

/** Phone numbers and e-mail addresses a customer wrote in his messages, each once. */
export function identifiersInTexts(texts: readonly string[]): { phones: string[]; emails: string[] } {
  const phones = new Set<string>()
  const emails = new Set<string>()
  for (const text of texts) {
    if (!text) continue
    for (const match of text.match(PHONE_IN_TEXT) ?? []) {
      const key = phoneKey(match)
      if (key) phones.add(key)
    }
    for (const match of text.match(EMAIL_IN_TEXT) ?? []) emails.add(match.toLowerCase())
  }
  return { phones: [...phones].slice(0, 5), emails: [...emails].slice(0, 5) }
}

type LinkDb = Pick<typeof prisma, "socialConversation" | "contact" | "channelMessage">

export type ContactLinkCandidate = {
  id: string
  fullName: string
  phone: string | null
  email: string | null
}

export type ContactLinkSuggestion = ContactLinkCandidate & {
  /** What the customer wrote that belongs to this contact and nobody else. */
  matchedBy: "phone" | "email"
  matchedValue: string
}

const CANDIDATE_SELECT = { id: true, fullName: true, phone: true, email: true, phones: true } as const

type ContactRow = { id: string; fullName: string; phone: string | null; email: string | null; phones: string[] }

function candidateOf(row: ContactRow): ContactLinkCandidate {
  return { id: row.id, fullName: row.fullName, phone: row.phone, email: row.email }
}

/**
 * Customers a number or e-mail from this conversation belongs to — only when it belongs to exactly one.
 * Read on demand, never stored: the suggestion is a question for the manager, not a link.
 */
export async function contactLinkSuggestions(
  options: { organizationId: string; conversationId: string; excludeContactId?: string | null },
  db: LinkDb = prisma,
): Promise<ContactLinkSuggestion[]> {
  const inbound = await db.channelMessage.findMany({
    where: { organizationId: options.organizationId, conversationId: options.conversationId, direction: "inbound" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { body: true },
  })
  const { phones, emails } = identifiersInTexts(inbound.map((m: { body: string }) => m.body))
  if (phones.length === 0 && emails.length === 0) return []

  const or: Prisma.ContactWhereInput[] = []
  for (const key of phones) {
    const tail = key.slice(-9)
    or.push({ phone: { contains: tail } })
    or.push({ phones: { hasSome: [key, `+${key}`, ...(key.startsWith("994") ? [`0${key.slice(3)}`] : [])] } })
  }
  for (const email of emails) or.push({ email: { equals: email, mode: "insensitive" } })

  const rows = await db.contact.findMany({
    where: { organizationId: options.organizationId, OR: or },
    select: CANDIDATE_SELECT,
    take: 50,
  }) as ContactRow[]

  const suggestions = new Map<string, ContactLinkSuggestion>()
  for (const key of phones) {
    const owners = rows.filter((row) => [row.phone, ...(row.phones ?? [])].some((p) => phoneKey(p) === key))
    if (owners.length === 1 && !suggestions.has(owners[0].id)) {
      suggestions.set(owners[0].id, { ...candidateOf(owners[0]), matchedBy: "phone", matchedValue: key })
    }
  }
  for (const email of emails) {
    const owners = rows.filter((row) => row.email?.toLowerCase() === email)
    if (owners.length === 1 && !suggestions.has(owners[0].id)) {
      suggestions.set(owners[0].id, { ...candidateOf(owners[0]), matchedBy: "email", matchedValue: email })
    }
  }
  if (options.excludeContactId) suggestions.delete(options.excludeContactId)
  return [...suggestions.values()].slice(0, 3)
}

/** Customers a manager can pick by name, phone or e-mail. */
export async function searchContactsForLink(
  options: { organizationId: string; query: string },
  db: Pick<typeof prisma, "contact"> = prisma,
): Promise<ContactLinkCandidate[]> {
  const query = options.query.trim().slice(0, 100)
  if (query.length < 2) return []
  const digits = query.replace(/\D/g, "")
  const or: Prisma.ContactWhereInput[] = [
    { fullName: { contains: query, mode: "insensitive" } },
    { email: { contains: query, mode: "insensitive" } },
  ]
  if (digits.length >= 5) {
    const tail = phoneKey(query)?.slice(-9) ?? digits.slice(-9)
    or.push({ phone: { contains: tail } })
  }
  const rows = await db.contact.findMany({
    where: { organizationId: options.organizationId, OR: or },
    select: CANDIDATE_SELECT,
    orderBy: { updatedAt: "desc" },
    take: 8,
  }) as ContactRow[]
  return rows.map(candidateOf)
}

export type ContactLinkResult =
  | { ok: true; contact: ContactLinkCandidate | null }
  | { ok: false; status: 400 | 404; error: string }

type ConversationRow = { id: string; platform: string; contactId: string | null; metadata: unknown }

type ContactLinkFailure = Extract<ContactLinkResult, { ok: false }>

async function linkableConversation(
  db: LinkDb,
  organizationId: string,
  conversationId: string,
): Promise<{ conversation: ConversationRow; failure: null } | { conversation: null; failure: ContactLinkFailure }> {
  const conversation = await db.socialConversation.findFirst({
    where: { id: conversationId, organizationId, deletedAt: null },
    select: { id: true, platform: true, contactId: true, metadata: true },
  }) as ConversationRow | null
  if (!conversation) return { conversation: null, failure: { ok: false, status: 404, error: "Conversation not found" } }
  if (!isContactLinkablePlatform(conversation.platform)) {
    return { conversation: null, failure: { ok: false, status: 400, error: "Only Instagram and Messenger conversations are linked by hand" } }
  }
  return { conversation, failure: null }
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

/** Ties the conversation to a customer of the same organization. Repeating it is harmless. */
export async function linkConversationContact(
  options: {
    organizationId: string
    conversationId: string
    contactId: string
    actorUserId: string
    via: "manual" | "suggestion"
  },
  db: LinkDb = prisma,
): Promise<ContactLinkResult> {
  const found = await linkableConversation(db, options.organizationId, options.conversationId)
  if (found.failure) return found.failure
  const contact = await db.contact.findFirst({
    where: { id: options.contactId, organizationId: options.organizationId },
    select: CANDIDATE_SELECT,
  }) as ContactRow | null
  if (!contact) return { ok: false, status: 400, error: "Customer not found" }

  const metadata = metadataObject(found.conversation.metadata)
  metadata.contactLink = {
    contactId: contact.id,
    by: options.actorUserId,
    at: new Date().toISOString(),
    via: options.via,
  }
  await db.socialConversation.updateMany({
    where: { id: found.conversation.id, organizationId: options.organizationId },
    data: { contactId: contact.id, metadata: metadata as Prisma.InputJsonValue },
  })
  await logAudit(options.organizationId, "update", "social_conversation", found.conversation.id, contact.fullName, {
    oldValue: { contactId: found.conversation.contactId },
    newValue: { contactId: contact.id, via: options.via, action: "contact_link" },
    userId: options.actorUserId,
  })
  return { ok: true, contact: candidateOf(contact) }
}

/** «Ayır»: the conversation is again its own thread, exactly as before the link. */
export async function unlinkConversationContact(
  options: { organizationId: string; conversationId: string; actorUserId: string },
  db: LinkDb = prisma,
): Promise<ContactLinkResult> {
  const found = await linkableConversation(db, options.organizationId, options.conversationId)
  if (found.failure) return found.failure
  const previous = found.conversation.contactId
  if (!previous) return { ok: true, contact: null }

  const metadata = metadataObject(found.conversation.metadata)
  delete metadata.contactLink
  metadata.contactUnlinked = { contactId: previous, by: options.actorUserId, at: new Date().toISOString() }
  await db.socialConversation.updateMany({
    where: { id: found.conversation.id, organizationId: options.organizationId },
    data: { contactId: null, metadata: metadata as Prisma.InputJsonValue },
  })
  await logAudit(options.organizationId, "update", "social_conversation", found.conversation.id, undefined, {
    oldValue: { contactId: previous },
    newValue: { contactId: null, action: "contact_unlink" },
    userId: options.actorUserId,
  })
  return { ok: true, contact: null }
}

/** The customer this conversation is linked to, if any. */
export async function linkedContactOf(
  options: { organizationId: string; conversationId: string },
  db: LinkDb = prisma,
): Promise<{ platform: string; linkable: boolean; contact: ContactLinkCandidate | null } | null> {
  const conversation = await db.socialConversation.findFirst({
    where: { id: options.conversationId, organizationId: options.organizationId, deletedAt: null },
    select: { platform: true, contactId: true },
  }) as { platform: string; contactId: string | null } | null
  if (!conversation) return null
  const contact = conversation.contactId
    ? await db.contact.findFirst({
        where: { id: conversation.contactId, organizationId: options.organizationId },
        select: CANDIDATE_SELECT,
      }) as ContactRow | null
    : null
  return {
    platform: conversation.platform,
    linkable: isContactLinkablePlatform(conversation.platform),
    contact: contact ? candidateOf(contact) : null,
  }
}
