/**
 * Microsoft Outlook calendars, over Graph and plain fetch.
 *
 * No SDK: @microsoft/microsoft-graph-client brings typings for the whole
 * Graph surface, and the type check already measures its memory in gigabytes
 * (see «Память тайпчека» in CLAUDE.md). Four requests is all this needs.
 *
 * The mailbox is reached as `/me/calendar`, the user's default calendar, so a
 * binding's calendarId stays the literal "primary" it is for Google and the
 * two providers share one row shape.
 */
import { prisma } from "@/lib/prisma"

const GRAPH = "https://graph.microsoft.com/v1.0"
const LOGIN = "https://login.microsoftonline.com"
/** Calendars.ReadWrite covers reading the day and writing the CRM's meetings. */
export const MICROSOFT_CALENDAR_SCOPES = ["offline_access", "https://graph.microsoft.com/Calendars.ReadWrite"]

export function microsoftCalendarConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET)
}

function tenant(): string {
  return process.env.MICROSOFT_TENANT_ID || "common"
}

export function microsoftAuthorizeUrl(redirectUri: string, state: string): string {
  const query = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
    state,
    // Without consent every reconnection may come back without a refresh
    // token, and a connection that dies in an hour is worse than none.
    prompt: "consent",
  })
  return `${LOGIN}/${tenant()}/oauth2/v2.0/authorize?${query}`
}

export interface MicrosoftTokens {
  access_token: string
  refresh_token: string | null
  expires_at: number | null
  scope: string | null
}

async function token(form: Record<string, string>): Promise<MicrosoftTokens> {
  const response = await fetch(`${LOGIN}/${tenant()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
      ...form,
    }),
    signal: AbortSignal.timeout(8000),
  })
  const body = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string } | null
  if (!response.ok || !body?.access_token) throw new Error("OUTLOOK_TOKEN_EXCHANGE_FAILED")
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? null,
    expires_at: typeof body.expires_in === "number" ? Math.floor(Date.now() / 1000) + body.expires_in : null,
    scope: body.scope ?? null,
  }
}

export function exchangeMicrosoftCode(code: string, redirectUri: string): Promise<MicrosoftTokens> {
  return token({ grant_type: "authorization_code", code, redirect_uri: redirectUri })
}

/**
 * A usable access token for a stored connection, refreshed and persisted when
 * it is about to expire. The compare-and-set keeps two workers refreshing at
 * once from overwriting each other with an older token.
 */
export async function microsoftAccessToken(accountId: string, userId: string): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId, provider: "microsoft-calendar" },
    select: { id: true, access_token: true, refresh_token: true, expires_at: true },
  })
  if (!account?.access_token) throw new Error("OUTLOOK_NOT_CONNECTED")
  const expiring = account.expires_at ? account.expires_at * 1000 < Date.now() + 120_000 : false
  if (!expiring) return account.access_token
  if (!account.refresh_token) throw new Error("OUTLOOK_RECONNECT_REQUIRED")
  const fresh = await token({ grant_type: "refresh_token", refresh_token: account.refresh_token })
  await prisma.account.updateMany({
    where: { id: account.id, access_token: account.access_token },
    data: {
      access_token: fresh.access_token,
      ...(fresh.refresh_token ? { refresh_token: fresh.refresh_token } : {}),
      ...(fresh.expires_at ? { expires_at: fresh.expires_at } : {}),
    },
  }).catch(() => { console.warn("[Outlook] token persistence unavailable") })
  return fresh.access_token
}

async function graph(accessToken: string, path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 8000, ...rest } = init
  const response = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      // Every instant comes back in UTC, so no event carries a timezone this
      // code would have to resolve itself.
      Prefer: 'outlook.timezone="UTC"',
      ...(rest.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  return response
}

async function graphJson<T>(accessToken: string, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const response = await graph(accessToken, path, init)
  if (!response.ok) throw new Error(`OUTLOOK_REQUEST_FAILED_${response.status}`)
  return await response.json() as T
}

/**
 * Who this connection belongs to, from Microsoft's own answer — never from
 * callback input. The mailbox address identifies the account across
 * reconnections; an unnamed calendar falls back to its opaque id.
 */
export async function microsoftIdentity(accessToken: string): Promise<string> {
  const body = await graphJson<{ id?: string; owner?: { address?: string } }>(accessToken, "/me/calendar?$select=id,owner")
  const identity = body.owner?.address || body.id
  if (!identity) throw new Error("OUTLOOK_IDENTITY_MISSING")
  return identity
}

export interface MicrosoftEvent {
  id: string
  start: Date
  end: Date
  subject: string | null
}

/**
 * Everything on the default calendar that overlaps the window, as instants.
 *
 * An event marked free is left out, as a Google event marked transparent is:
 * the person said it does not take their time. A cancelled one is out too.
 * Anything this cannot read with certainty throws, because the caller treats
 * a readable-but-incomplete calendar as free time and would double-book it.
 */
export async function microsoftEvents(accessToken: string, from: Date, to: Date, deadline = Date.now() + 8000): Promise<MicrosoftEvent[]> {
  const query = new URLSearchParams({
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
    $select: "id,subject,start,end,isCancelled,showAs",
    $top: "100",
  })
  let next: string | null = `/me/calendarView?${query}`
  const events: MicrosoftEvent[] = []
  while (next) {
    if (Date.now() >= deadline || events.length > 1000) throw new Error("OUTLOOK_CALENDAR_INCOMPLETE")
    const page: {
      value?: { id?: string; subject?: string | null; isCancelled?: boolean; showAs?: string; start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string; timeZone?: string } }[]
      "@odata.nextLink"?: string
    } = await graphJson(accessToken, next, { timeoutMs: Math.max(1, deadline - Date.now()) })
    for (const item of page.value ?? []) {
      if (item.isCancelled || item.showAs === "free") continue
      const start = graphInstant(item.start)
      const end = graphInstant(item.end)
      if (!start || !end) throw new Error("OUTLOOK_EVENT_UNREADABLE")
      events.push({ id: item.id ?? "", start, end, subject: item.subject?.trim() || null })
    }
    next = page["@odata.nextLink"] ?? null
  }
  return events
}

/** Graph writes `2026-11-05T09:00:00.0000000` with a separate zone name. */
function graphInstant(value: { dateTime?: string; timeZone?: string } | undefined): Date | null {
  if (!value?.dateTime) return null
  // The Prefer header above asks for UTC; any other zone means the request
  // did not come back as asked and must not be guessed at.
  if (value.timeZone && value.timeZone !== "UTC") return null
  const parsed = new Date(/[Zz]|[+-]\d\d:?\d\d$/.test(value.dateTime) ? value.dateTime : `${value.dateTime}Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export interface MicrosoftEventBody {
  subject: string
  description: string | null
  location: string | null
  start: Date
  end: Date
}

function eventRequest(body: MicrosoftEventBody, transactionId?: string) {
  return JSON.stringify({
    subject: body.subject,
    ...(body.description ? { body: { contentType: "text", content: body.description } } : {}),
    ...(body.location ? { location: { displayName: body.location } } : {}),
    start: { dateTime: body.start.toISOString().replace("Z", ""), timeZone: "UTC" },
    end: { dateTime: body.end.toISOString().replace("Z", ""), timeZone: "UTC" },
    ...(transactionId ? { transactionId } : {}),
  })
}

/**
 * The event this CRM meeting already has on the calendar, found by the
 * identifier the create request carried.
 *
 * Graph does not let a client choose an event id, so a retry after an
 * unconfirmed create cannot simply repeat it: it asks Microsoft whether that
 * transaction already landed. Without this, one lost response would put two
 * identical meetings in the master's Outlook.
 */
export async function microsoftEventByTransaction(accessToken: string, transactionId: string): Promise<string | null> {
  // Encoded by hand: URLSearchParams would write the filter's spaces as «+»,
  // and OData is read literally enough that a «+» there is a different query.
  const filter = encodeURIComponent(`transactionId eq '${transactionId.replace(/'/g, "''")}'`)
  const body = await graphJson<{ value?: { id?: string }[] }>(accessToken, `/me/events?$filter=${filter}&$select=id&$top=1`)
  return body.value?.[0]?.id ?? null
}

export async function createMicrosoftEvent(accessToken: string, body: MicrosoftEventBody, transactionId: string): Promise<string> {
  const created = await graphJson<{ id?: string }>(accessToken, "/me/events", { method: "POST", body: eventRequest(body, transactionId) })
  if (!created.id) throw new Error("OUTLOOK_EVENT_NOT_CREATED")
  return created.id
}

/** True when the event is gone from the calendar, so the caller may create it anew. */
export async function updateMicrosoftEvent(accessToken: string, eventId: string, body: MicrosoftEventBody): Promise<{ missing: boolean }> {
  const response = await graph(accessToken, `/me/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: eventRequest(body) })
  if (response.status === 404 || response.status === 410) return { missing: true }
  if (!response.ok) throw new Error(`OUTLOOK_REQUEST_FAILED_${response.status}`)
  return { missing: false }
}

export async function deleteMicrosoftEvent(accessToken: string, eventId: string): Promise<void> {
  const response = await graph(accessToken, `/me/events/${encodeURIComponent(eventId)}`, { method: "DELETE" })
  // An event somebody already removed by hand is the state we wanted.
  if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(`OUTLOOK_REQUEST_FAILED_${response.status}`)
}
