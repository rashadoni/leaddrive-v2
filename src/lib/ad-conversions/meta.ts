/**
 * Meta Conversions API — building and sending conversion events.
 *
 * Facts this follows (checked 2026-10-23 against Meta's docs and live calls):
 *  - An event older than 7 days fails the WHOLE request ("we return an error
 *    for the entire request and process no events"), so events older than
 *    `MAX_EVENT_AGE_MS` are never put in a batch — the worker skips them.
 *  - `event_id` deduplicates retries of the same event; Meta keeps the first.
 *  - Contact data goes hashed (SHA-256 of the normalised value), as the
 *    Business Tools Terms require. Phone: digits with country code and no
 *    "+" — `advertising-studio/pii-hasher.ts` keeps the "+", which Meta does
 *    not want, so the normalisation lives here.
 *  - `currency` must be ISO 4217; AZN is.
 *  - A wrong token answers code 190; the pixel read below is how a token is
 *    checked before it is saved.
 */
import { createHash } from "crypto"
import type { AdAttribution } from "./attribution"

const GRAPH_VERSION = process.env.META_CONVERSIONS_GRAPH_VERSION || "v25.0"
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`
const REQUEST_TIMEOUT_MS = 15_000

/** A day short of Meta's 7-day limit, so a slow retry is not refused. */
export const MAX_EVENT_AGE_MS = 6 * 24 * 3600_000

export type MetaEventName = "Lead" | "Purchase"

export interface ConversionSubject {
  /** Stable id: Meta deduplicates on it. */
  eventId: string
  eventName: MetaEventName
  eventTime: Date
  email?: string | null
  phone?: string | null
  attribution?: AdAttribution | null
  value?: number
  currency?: string
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")

export function normaliseEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null
}

/**
 * Digits with the country code, no "+" and no leading zeros. A local
 * Azerbaijani number (0XX XXX XX XX, or the nine digits without the 0) gets
 * 994 — the country nearly every LeadDrive customer sells in.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  let digits = (raw ?? "").replace(/\D/g, "")
  if (digits.startsWith("00")) digits = digits.slice(2)
  if (/^0\d{9}$/.test(digits)) digits = `994${digits.slice(1)}`
  else if (/^[1-9]\d{8}$/.test(digits)) digits = `994${digits}`
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}

/** The `user_data` block: hashed contact data plus the ad platform's own ids. Null when nothing can match. */
export function metaUserData(subject: ConversionSubject): Record<string, unknown> | null {
  const email = normaliseEmail(subject.email)
  const phone = normalisePhone(subject.phone)
  const attribution = subject.attribution ?? {}
  const data: Record<string, unknown> = {}
  if (email) data.em = [sha256(email)]
  if (phone) data.ph = [sha256(phone)]
  if (attribution.fbc) data.fbc = attribution.fbc
  if (attribution.fbp) data.fbp = attribution.fbp
  if (Object.keys(data).length === 0) return null
  if (attribution.userAgent) data.client_user_agent = attribution.userAgent
  return data
}

/**
 * One event. A lead captured on a web page is a `website` event (Meta asks
 * for the page and the browser for those); everything else happened in the
 * CRM and is `other` — Meta's `system_generated` means "happened
 * automatically", which a closed sale is not.
 */
export function buildMetaEvent(subject: ConversionSubject): Record<string, unknown> | null {
  const userData = metaUserData(subject)
  if (!userData) return null
  const attribution = subject.attribution ?? {}
  const onWebsite = subject.eventName === "Lead" && Boolean(attribution.pageUrl && attribution.userAgent)
  const event: Record<string, unknown> = {
    event_name: subject.eventName,
    event_time: Math.floor(subject.eventTime.getTime() / 1000),
    event_id: subject.eventId,
    action_source: onWebsite ? "website" : "other",
    user_data: userData,
  }
  if (onWebsite) event.event_source_url = attribution.pageUrl
  if (subject.eventName === "Purchase") {
    event.custom_data = { value: Math.round((subject.value ?? 0) * 100) / 100, currency: (subject.currency ?? "AZN").toUpperCase() }
  }
  return event
}

export class MetaApiError extends Error {
  constructor(message: string, readonly code: number | string) {
    super(message)
    this.name = "MetaApiError"
  }
}

async function graph(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(`${GRAPH}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" })
  } catch (error) {
    throw new MetaApiError(error instanceof Error ? error.message : "Meta is unreachable", "network")
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  const error = body?.error as { message?: string; code?: number; error_user_msg?: string } | undefined
  if (!response.ok || error) {
    throw new MetaApiError(error?.error_user_msg || error?.message || `HTTP ${response.status}`, error?.code ?? response.status)
  }
  return body ?? {}
}

/** Check that the token can see the pixel. Throws MetaApiError otherwise. */
export async function verifyMetaPixel(pixelId: string, accessToken: string): Promise<{ name: string }> {
  const body = await graph(`/${encodeURIComponent(pixelId)}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`, { method: "GET" })
  return { name: typeof body.name === "string" ? body.name : pixelId }
}

/** Send up to 1000 events in one request. Returns how many Meta received. */
export async function sendMetaEvents(input: {
  pixelId: string
  accessToken: string
  events: Record<string, unknown>[]
  testEventCode?: string | null
}): Promise<{ received: number }> {
  const body: Record<string, unknown> = { data: input.events, access_token: input.accessToken }
  if (input.testEventCode) body.test_event_code = input.testEventCode
  const result = await graph(`/${encodeURIComponent(input.pixelId)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return { received: typeof result.events_received === "number" ? result.events_received : 0 }
}
