// LeadDrive CRM — 3CX "server side" CRM Integration support.
//
// 3CX v20 does NOT push call events to an arbitrary webhook: the Call Control
// API publishes state over a WebSocket, and the only outbound-HTTP mechanism the
// PBX offers is the CRM Integration template (Admin → Integrations → CRM →
// Server side). A template declares two scenarios we care about:
//
//   Scenario Id=""           → contact lookup by caller number, so the 3CX
//                              client shows the CRM contact name + a link.
//   Scenario Id="ReportCall" → call journaling, fired when the call ENDS.
//
// This module owns everything shared between the two endpoints that serve that
// template (`/api/v1/calls/threecx/lookup`, `/api/v1/calls/webhook/threecx`)
// and the endpoint that generates the template itself.

import { timingSafeEqual } from "crypto"

/** Template `Name` attribute — also the name shown in the 3CX CRM dropdown. */
export const THREECX_CRM_TEMPLATE_NAME = "LeadDriveCRM"

/** Bumped whenever the emitted XML changes so 3CX treats it as a new revision. */
export const THREECX_CRM_TEMPLATE_VERSION = 1

/** Minimum length we accept for a webhook secret (32 hex chars is what the UI generates). */
export const THREECX_SECRET_MIN_LENGTH = 16

/**
 * Constant-time secret comparison. `timingSafeEqual` throws on length mismatch,
 * so the length is checked first (a length leak is not meaningful here — the
 * secret length is fixed by our own generator).
 */
export function threeCxSecretMatches(provided: string | null, expected: string | null): boolean {
  if (!expected || !provided) return false
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

/** The shape both public 3CX endpoints need out of a voip ChannelConfig row. */
export type ThreeCxConfigRow = {
  id: string
  isActive: boolean
  settings: unknown
}

export type ThreeCxAuthResult =
  | { status: "ok"; config: ThreeCxConfigRow }
  | { status: "unauthorized" }
  | { status: "disabled"; config: ThreeCxConfigRow }

/**
 * Resolve which voip config a presented secret belongs to.
 *
 * An organization can hold SEVERAL voip ChannelConfig rows — switching provider
 * (e.g. Twilio → 3CX) leaves the old row behind. The first cut of these
 * endpoints did `findFirst({ channelType: "voip", isActive: true })` with no
 * ordering, so Postgres was free to hand back the leftover row, whose settings
 * carry no `webhookSecret` — and every 3CX request 401'd while the settings
 * screen (which orders by updatedAt) happily showed a working secret.
 *
 * So: match the presented secret against EVERY voip row of the org. The row that
 * owns the secret is the row the request is authorised against — ordering can no
 * longer decide the outcome. A row that matches but is switched off is reported
 * separately so the PBX-side error says "disabled" instead of "wrong secret".
 */
export function resolveThreeCxConfig(
  configs: ThreeCxConfigRow[],
  presentedSecret: string | null,
): ThreeCxAuthResult {
  if (!presentedSecret) return { status: "unauthorized" }

  const matches = configs.filter(config => {
    const settings = (config.settings ?? null) as { webhookSecret?: unknown } | null
    const stored = typeof settings?.webhookSecret === "string" ? settings.webhookSecret.trim() : null
    return threeCxSecretMatches(presentedSecret, stored)
  })

  if (matches.length === 0) return { status: "unauthorized" }
  const active = matches.find(config => config.isActive)
  return active ? { status: "ok", config: active } : { status: "disabled", config: matches[0] }
}

/**
 * Deterministic phone variants for matching a 3CX caller number.
 *
 * Only explicit E.164/international input, the common stored AZ country-code
 * form, and the unambiguous AZ national form are accepted. A bare nine-digit
 * subscriber number is deliberately rejected: interpreting it as AZ could link
 * one person's call to another country's number.
 *
 * `last9` remains available to the caller-ID lookup endpoint for backwards
 * compatibility. Call-history writers must use `exact` only; suffix matching is
 * not identity evidence.
 */
export function threeCxPhoneVariants(raw: string): {
  exact: string[]
  canonicalE164?: string
  last9?: string
} {
  const trimmed = (raw || "").trim()
  if (!trimmed) return { exact: [] }

  const compact = trimmed.replace(/[\s().-]/g, "")
  let canonicalE164: string | undefined

  if (/^\+[1-9]\d{6,14}$/.test(compact)) {
    canonicalE164 = compact
  } else if (/^00[1-9]\d{6,14}$/.test(compact)) {
    canonicalE164 = `+${compact.slice(2)}`
  } else if (/^994\d{9}$/.test(compact)) {
    canonicalE164 = `+${compact}`
  } else if (/^0\d{9}$/.test(compact)) {
    canonicalE164 = `+994${compact.slice(1)}`
  }

  if (!canonicalE164) return { exact: [] }

  const digits = canonicalE164.slice(1)
  const exact = new Set<string>([canonicalE164, digits])
  if (/^994\d{9}$/.test(digits)) {
    exact.add(`0${digits.slice(3)}`)
  }

  return {
    exact: [...exact],
    canonicalE164,
    last9: digits.length >= 9 ? digits.slice(-9) : undefined,
  }
}

/** How a destination number is shaped before it is handed to 3CX. */
export type ThreeCxDialFormat = "az-national" | "as-is"

/**
 * Convert a stored contact number into the form the PBX's outbound rule
 * will actually match.
 *
 * The trunk we ship against routes on `Prefix 0` / `Length 10` — the
 * Azerbaijani national form `0XXXXXXXXX`. Contacts, however, are stored
 * in E.164 (`+994XXXXXXXXX`), which matches no rule at all: the call is
 * refused before it ever reaches the carrier. This is the dialling twin
 * of `threeCxPhoneVariants`, which solves the same 0XX ↔ +994XX drift in
 * the opposite direction (inbound lookup).
 *
 * Only AZ numbers are rewritten. Anything else — internal extensions,
 * short codes, foreign numbers — is passed through untouched, so a PBX
 * with a different dial plan is not silently broken. Pass `"as-is"` to
 * disable rewriting entirely.
 *
 *   +994512060838 → 0512060838
 *    994512060838 → 0512060838
 *  00994512060838 → 0512060838
 *       512060838 → 0512060838
 *      0512060838 → unchanged
 *             101 → unchanged (extension)
 */
export function threeCxDialNumber(raw: string, format: ThreeCxDialFormat = "az-national"): string {
  const trimmed = (raw || "").trim()
  if (!trimmed || format === "as-is") return trimmed

  // Strip formatting humans type (spaces, dashes, brackets) but keep a
  // leading "+" so we can tell E.164 from a national number.
  const cleaned = trimmed.replace(/[\s()\-.]/g, "")
  const withoutPlus = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned
  if (!/^\d+$/.test(withoutPlus)) return trimmed

  // 00 is the international access prefix — same thing as a leading "+".
  const hasIntlPrefix = cleaned.startsWith("+") || withoutPlus.startsWith("00")
  const national = withoutPlus.startsWith("00") ? withoutPlus.slice(2) : withoutPlus

  // +994 XX XXX XX XX — country code plus exactly 9 subscriber digits.
  if (national.length === 12 && national.startsWith("994")) {
    return `0${national.slice(3)}`
  }

  // Bare subscriber number with neither country code nor trunk zero. This
  // rule must ONLY fire when the input had no international prefix: a full
  // E.164 number for a short-country-code state (+376312345, Andorra) is
  // also 9 digits, and rewriting it would silently dial a wrong number.
  if (!hasIntlPrefix && national.length === 9 && !national.startsWith("0")) {
    return `0${national}`
  }

  return trimmed
}

export type ThreeCxCallMapping = {
  direction: "inbound" | "outbound"
  status: "completed" | "no-answer"
  answered: boolean
}

/**
 * Map the template's `[CallType]` variable onto CallLog fields.
 * 3CX emits exactly one of: Inbound | Outbound | Missed | Unanswered.
 *  - Missed     — inbound call nobody picked up.
 *  - Unanswered — outbound call the far end never picked up.
 */
export function mapThreeCxCallType(raw: unknown): ThreeCxCallMapping | null {
  const value = String(raw ?? "").trim().toLowerCase()
  switch (value) {
    case "outbound":
      return { direction: "outbound", status: "completed", answered: true }
    case "unanswered":
      return { direction: "outbound", status: "no-answer", answered: false }
    case "missed":
      return { direction: "inbound", status: "no-answer", answered: false }
    case "inbound":
      return { direction: "inbound", status: "completed", answered: true }
    default:
      return null
  }
}

/**
 * `[Duration]` arrives as "hh:mm:ss" (3CX) — but a plain seconds count is
 * accepted too, since custom templates and the Call Control API both use one.
 * Returns undefined for missing/zero/garbage input so we never write `0` over a
 * real duration.
 */
export function parseThreeCxDuration(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined
  const value = String(raw).trim()
  if (!value) return undefined

  const clock = value.match(/^(\d+):([0-5]?\d):([0-5]?\d)$/)
  if (clock) {
    const seconds = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
    return seconds > 0 ? seconds : undefined
  }

  const mmss = value.match(/^(\d+):([0-5]?\d)$/)
  if (mmss) {
    const seconds = Number(mmss[1]) * 60 + Number(mmss[2])
    return seconds > 0 ? seconds : undefined
  }

  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric)
  return undefined
}

/**
 * `[DateTime]` is the call start in the PBX's local time zone, formatted by 3CX
 * (e.g. "2026-07-29 18:46:12"). Parsed leniently; falls back to "now" upstream.
 */
export function parseThreeCxDateTime(raw: unknown): Date | undefined {
  if (raw === null || raw === undefined) return undefined
  const value = String(raw).trim()
  if (!value) return undefined
  // "YYYY-MM-DD HH:mm:ss" is not reliably parsed by every runtime — normalize to ISO-ish.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? value.replace(" ", "T") : value
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export type ThreeCxTemplateOptions = {
  /** Public CRM origin, e.g. https://app.leaddrivecrm.org (no trailing slash). */
  appUrl: string
  organizationId: string
  /** Shared secret that gates both endpoints — same value stored in channel settings. */
  secret: string
}

export function threeCxLookupUrl(opts: ThreeCxTemplateOptions): string {
  const base = opts.appUrl.replace(/\/$/, "")
  return `${base}/api/v1/calls/threecx/lookup?orgId=${encodeURIComponent(opts.organizationId)}&secret=${encodeURIComponent(opts.secret)}&number=`
}

export function threeCxJournalUrl(opts: ThreeCxTemplateOptions): string {
  const base = opts.appUrl.replace(/\/$/, "")
  return `${base}/api/v1/calls/webhook/threecx?orgId=${encodeURIComponent(opts.organizationId)}&secret=${encodeURIComponent(opts.secret)}`
}

/**
 * Build the server-side CRM template XML that the owner uploads into
 * 3CX (Admin → Integrations → CRM → Server side → Add).
 *
 * Shape follows the current 3CX REST template dialect (`Scenario Type="REST"`,
 * `Outputs` with `Type=` mappings) — the same dialect 3CX's own published
 * templates use on v18–v20.
 *
 * The org id and secret are baked in as parameter defaults so the owner does not
 * have to retype them in the PBX, while still being editable there.
 */
export function buildThreeCxCrmTemplate(opts: ThreeCxTemplateOptions): string {
  const appUrl = xmlEscape(opts.appUrl.replace(/\/$/, ""))
  const orgId = xmlEscape(opts.organizationId)
  const secret = xmlEscape(opts.secret)

  // `&` inside URL query strings must be XML-escaped inside attribute values.
  const lookupUrl = `[ApiUrl]/api/v1/calls/threecx/lookup?orgId=[OrgId]&amp;secret=[ApiSecret]&amp;number=[Number]`
  const journalUrl = `[ApiUrl]/api/v1/calls/webhook/threecx?orgId=[OrgId]&amp;secret=[ApiSecret]`

  return `<?xml version="1.0" encoding="utf-8"?>
<Crm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" Country="AZ" Name="${THREECX_CRM_TEMPLATE_NAME}" Version="${THREECX_CRM_TEMPLATE_VERSION}" SupportsEmojis="true">
  <Number Prefix="Off" MaxLength="20" />
  <Connection MaxConcurrentRequests="8" />
  <Parameters>
    <Parameter Parent="General Configuration" Name="ApiUrl" Type="String" Title="LeadDrive URL:" Default="${appUrl}" />
    <Parameter Parent="General Configuration" Name="OrgId" Type="String" Title="Organization ID:" Default="${orgId}" />
    <Parameter Parent="General Configuration" Name="ApiSecret" Type="String" Title="Integration secret:" Default="${secret}" />
  </Parameters>
  <Authentication Type="No" />
  <Scenarios>
    <Scenario Id="" Type="REST">
      <Request Url="${lookupUrl}" RequestType="Get" ResponseType="Json" />
      <Rules>
        <Rule Type="Any">contacts</Rule>
      </Rules>
      <Variables>
        <Variable Name="LdEntityId" Path="contacts.id" />
        <Variable Name="LdFirstName" Path="contacts.firstName" />
        <Variable Name="LdLastName" Path="contacts.lastName" />
        <Variable Name="LdCompanyName" Path="contacts.companyName" />
        <Variable Name="LdEmail" Path="contacts.email" />
        <Variable Name="LdPhone" Path="contacts.phone" />
        <Variable Name="LdEntityType" Path="contacts.entityType" />
        <Variable Name="LdContactUrl" Path="contacts.url" />
      </Variables>
      <Outputs AllowEmpty="false">
        <Output Type="ContactUrl" Value="[LdContactUrl]" />
        <Output Type="FirstName" Value="[LdFirstName]" />
        <Output Type="LastName" Value="[LdLastName]" />
        <Output Type="CompanyName" Value="[LdCompanyName]" />
        <Output Type="Email" Value="[LdEmail]" />
        <Output Type="PhoneMobile" Value="[LdPhone]" />
        <Output Type="EntityId" Value="[LdEntityId]" />
        <Output Type="EntityType" Value="[LdEntityType]" />
      </Outputs>
    </Scenario>
    <Scenario Id="ReportCall" Type="REST">
      <Request Url="${journalUrl}" RequestEncoding="UrlEncoded" RequestType="Post" ResponseType="Json">
        <PostValues>
          <Value Key="event">ReportCall</Value>
          <Value Key="callType">[CallType]</Value>
          <Value Key="number">[Number]</Value>
          <Value Key="name">[Name]</Value>
          <Value Key="agent">[Agent]</Value>
          <Value Key="duration">[Duration]</Value>
          <Value Key="dateTime">[DateTime]</Value>
          <Value Key="entityId">[EntityId]</Value>
          <Value Key="entityType">[EntityType]</Value>
        </PostValues>
      </Request>
    </Scenario>
  </Scenarios>
</Crm>
`
}
