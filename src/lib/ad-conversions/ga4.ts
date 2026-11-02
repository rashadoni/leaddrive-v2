/**
 * Google Analytics 4 Measurement Protocol — the second ad-conversions
 * destination (owner 2026-10-26; mockup accepted).
 *
 * Facts this follows (Google's «Send Measurement Protocol events», read
 * 2026-10-26):
 *  - POST https://www.google-analytics.com/mp/collect?measurement_id=…&api_secret=…
 *    with a JSON body { client_id, timestamp_micros, events: [{ name, params }] }.
 *  - «Events … can be backdated up to 72 hours»; older ones are moved to 72
 *    hours ago or refused — so events older than `GA4_MAX_EVENT_AGE_MS` are
 *    skipped by the worker, as Meta's are after 6 days.
 *  - At most 25 events per request; the worker sends one person's event per
 *    request, since client_id is per request.
 *  - /debug/mp/collect answers { validationMessages } and records nothing; it
 *    checks the payload, not the secret — so the secret is proven by a test
 *    event (`leaddrive_test`, debug_mode) that shows in GA4 DebugView.
 *
 * Nothing personal goes to Google: client_id is the visitor's `_ga` id taken
 * by the form, or a pseudonymous id derived from the record when there was no
 * website visit; params carry only the amount and currency.
 * Event names are Google's recommended lead events: generate_lead and
 * close_convert_lead.
 */
import { createHash } from "crypto"
import type { AdAttribution } from "./attribution"

const ENDPOINT = process.env.GA4_MP_ENDPOINT || "https://www.google-analytics.com"
const TIMEOUT_MS = 15_000

/** Two hours short of Google's 72, so a slow retry is not moved or refused. */
export const GA4_MAX_EVENT_AGE_MS = 70 * 3600_000

export const isMeasurementId = (value: string) => /^G-[A-Z0-9]{4,20}$/.test(value)

export class Ga4Error extends Error {
  constructor(message: string, readonly code: "network" | "invalid" | number) {
    super(message)
    this.name = "Ga4Error"
  }
}

/** The visitor's GA id from the form, or a stable pseudonymous one for a record without a visit. */
export function ga4ClientId(attribution: AdAttribution | null | undefined, entityId: string): string {
  if (attribution?.gaClientId) return attribution.gaClientId
  const digest = createHash("sha256").update(`leaddrive:${entityId}`).digest()
  return `${digest.readUInt32BE(0)}.${digest.readUInt32BE(4)}`
}

export function buildGa4Body(input: {
  eventName: "lead" | "purchase"
  eventTime: Date
  entityId: string
  attribution?: AdAttribution | null
  value?: number
  currency?: string
}): Record<string, unknown> {
  const params: Record<string, unknown> = { engagement_time_msec: 1 }
  if (input.eventName === "purchase") {
    params.value = Math.round((input.value ?? 0) * 100) / 100
    params.currency = (input.currency ?? "AZN").toUpperCase()
  }
  if (input.attribution?.utmSource) params.source = input.attribution.utmSource
  if (input.attribution?.utmCampaign) params.campaign = input.attribution.utmCampaign
  return {
    client_id: ga4ClientId(input.attribution, input.entityId),
    timestamp_micros: input.eventTime.getTime() * 1000,
    events: [{ name: input.eventName === "purchase" ? "close_convert_lead" : "generate_lead", params }],
  }
}

async function postToGoogle(path: string, measurementId: string, apiSecret: string, body: Record<string, unknown>): Promise<Response> {
  const url = `${ENDPOINT}${path}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    })
  } catch (error) {
    throw new Ga4Error(error instanceof Error ? error.message : "Google is unreachable", "network")
  }
}

export async function sendGa4Event(input: { measurementId: string; apiSecret: string; body: Record<string, unknown> }): Promise<void> {
  const response = await postToGoogle("/mp/collect", input.measurementId, input.apiSecret, input.body)
  if (!response.ok) throw new Ga4Error(`Google answered HTTP ${response.status}`, response.status)
}

/** Google's validation server: records nothing, and names what it would refuse. */
export async function validateGa4(input: { measurementId: string; apiSecret: string; body: Record<string, unknown> }): Promise<void> {
  const response = await postToGoogle("/debug/mp/collect", input.measurementId, input.apiSecret, input.body)
  if (!response.ok) throw new Ga4Error(`Google answered HTTP ${response.status}`, response.status)
  const json = (await response.json().catch(() => null)) as { validationMessages?: { description?: string }[] } | null
  const problem = json?.validationMessages?.[0]
  if (problem) throw new Ga4Error(problem.description || "Google refused the event", "invalid")
}

/** «Test hadisəsi göndər»: a custom event in debug mode — DebugView shows it, conversions do not count it. */
export function ga4TestBody(now: Date): Record<string, unknown> {
  return {
    client_id: ga4ClientId(null, `test:${now.getTime()}`),
    timestamp_micros: now.getTime() * 1000,
    events: [{ name: "leaddrive_test", params: { debug_mode: 1, engagement_time_msec: 1 } }],
  }
}
