import type { Prisma } from "@prisma/client"
import { sanitizeForPrompt } from "@/lib/sanitize"

export type EmailIntakeTarget = "ticket" | "complaint"

export type EmailIntakeRoute = {
  address: string
  target: EmailIntakeTarget
  categoryId?: string | null
  category?: string | null
  priority?: string | null
  complaintType?: "complaint" | "suggestion"
  source?: string | null
}

export type EmailIntakeChannel = {
  id: string
  organizationId: string
  configName: string
  settings: Prisma.JsonValue | null
}

export type EmailIntakeMatch =
  | { ok: true; channel: EmailIntakeChannel; route: EmailIntakeRoute; matchedAddress: string }
  | { ok: false; reason: "no_recipient" | "no_match" | "ambiguous"; matchedAddress?: string }

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const VALID_TARGETS = new Set<EmailIntakeTarget>(["ticket", "complaint"])
const VALID_PRIORITIES = new Set(["low", "medium", "high", "urgent", "critical"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean) as string[]
  const single = asString(value)
  return single ? [single] : []
}

export function normalizeEmailAddress(value: string | null | undefined): string | null {
  const address = asString(value)
  if (!address) return null
  const match = address.match(EMAIL_RE)?.[0]
  return match ? match.toLowerCase() : null
}

export function extractEmailAddresses(header: string | null | undefined): string[] {
  const value = asString(header)
  if (!value) return []
  return Array.from(new Set((value.match(EMAIL_RE) || []).map(address => address.toLowerCase())))
}

/**
 * Parses the display name out of a `From:` header. The header is written by
 * whoever sent the mail, so the result is untrusted text that goes on to become
 * `Contact.fullName` and to be read back by the AI paths. Sanitising here — at
 * the single point where the untrusted string is produced — keeps newlines,
 * control characters and unbounded length out of every downstream consumer,
 * present and future.
 */
export function displayNameFromEmailHeader(header: string | null | undefined): string | null {
  const value = asString(header)
  if (!value) return null
  const withoutAddress = value.replace(/<[^>]+>/g, "").replace(EMAIL_RE, "").replace(/["']/g, "").trim()
  const name = withoutAddress || normalizeEmailAddress(value)
  if (!name) return null
  return sanitizeForPrompt(name) || null
}

function expandRoute(raw: unknown, fallbackTarget?: EmailIntakeTarget): EmailIntakeRoute[] {
  if (!isRecord(raw)) return []
  const target = asString(raw.target) || fallbackTarget
  if (!target || !VALID_TARGETS.has(target as EmailIntakeTarget)) return []

  const addresses = [
    ...asStringArray(raw.addresses),
    ...asStringArray(raw.address),
    ...asStringArray(raw.to),
    ...asStringArray(raw.recipient),
  ]

  return addresses
    .map(normalizeEmailAddress)
    .filter((address): address is string => Boolean(address))
    .map(address => ({
      address,
      target: target as EmailIntakeTarget,
      categoryId: asString(raw.categoryId),
      category: asString(raw.category),
      priority: asString(raw.priority),
      complaintType: raw.complaintType === "suggestion" ? "suggestion" : "complaint",
      source: asString(raw.source),
    }))
}

export function emailIntakeRoutesFromSettings(settings: unknown): EmailIntakeRoute[] {
  if (!isRecord(settings)) return []
  const emailIntake = isRecord(settings.emailIntake) ? settings.emailIntake : {}
  const routes: EmailIntakeRoute[] = []

  if (Array.isArray(emailIntake.routes)) {
    for (const route of emailIntake.routes) routes.push(...expandRoute(route))
  }

  routes.push(...expandRoute(emailIntake))

  if (isRecord(settings.ticketIntake)) {
    routes.push(...expandRoute(settings.ticketIntake, "ticket"))
  }
  if (isRecord(settings.complaintIntake)) {
    routes.push(...expandRoute(settings.complaintIntake, "complaint"))
  }

  return routes.filter((route, index, all) =>
    all.findIndex(candidate => candidate.address === route.address && candidate.target === route.target) === index
  )
}

export function emailIntakeSettingsError(channelType: string | null | undefined, settings: unknown): string | null {
  if (channelType !== "email") return null
  if (!isRecord(settings)) return null

  const routes = emailIntakeRoutesFromSettings(settings)
  const rawEmailIntake = isRecord(settings.emailIntake) ? settings.emailIntake : null
  const rawRoutes = rawEmailIntake && Array.isArray(rawEmailIntake.routes) ? rawEmailIntake.routes : []
  if (rawEmailIntake && rawRoutes.length > 0 && routes.length === 0) {
    return "Email intake routes require a valid address and target: ticket or complaint"
  }

  const invalidPriority = routes.find(route => route.priority && !VALID_PRIORITIES.has(route.priority))
  if (invalidPriority) {
    return "Email intake priority must be one of low, medium, high, urgent or critical"
  }

  const duplicateAddress = routes.find((route, index) =>
    routes.findIndex(candidate => candidate.address === route.address) !== index
  )
  if (duplicateAddress) {
    return `Email intake address is configured more than once: ${duplicateAddress.address}`
  }

  return null
}

export function matchEmailIntakeRoute(toHeader: string, channels: EmailIntakeChannel[]): EmailIntakeMatch {
  const recipients = extractEmailAddresses(toHeader)
  if (recipients.length === 0) return { ok: false, reason: "no_recipient" }

  const matches: { channel: EmailIntakeChannel; route: EmailIntakeRoute; matchedAddress: string }[] = []
  for (const channel of channels) {
    for (const route of emailIntakeRoutesFromSettings(channel.settings)) {
      if (recipients.includes(route.address)) {
        matches.push({ channel, route, matchedAddress: route.address })
      }
    }
  }

  if (matches.length === 0) return { ok: false, reason: "no_match" }
  if (matches.length > 1) return { ok: false, reason: "ambiguous", matchedAddress: matches[0].matchedAddress }
  return { ok: true, ...matches[0] }
}
