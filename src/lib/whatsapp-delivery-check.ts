import { prisma } from "@/lib/prisma"
import { appOrigin } from "@/lib/whatsapp-signup-window"
import { isCloudApiPaused } from "@/lib/whatsapp-account-update"

/**
 * «Проверить приём сообщений» — why a WhatsApp number's messages do or do not reach the CRM, asked
 * of Meta itself (owner, 2026-11-22: a test message to a client's number never arrived; the row
 * was active, the webhook had rejected nothing, and the only thing left to say was «Meta does not
 * send them», with no way to see why from inside the CRM).
 *
 * A number's inbound messages reach us only if three things hold on Meta's side, and none of them
 * is visible in our own tables:
 *   1. the number is CONNECTED to Cloud API (a number re-registered in the app on a phone is not);
 *   2. an app is subscribed to the WhatsApp Business Account's webhooks — ours, for a number
 *      connected through Embedded Signup;
 *   3. the callback Meta actually uses for the number is ours. A number, or its account, can carry
 *      an override that sends everything somewhere else.
 *
 * The token lives only on the server, so the check does too. It reads; the one thing it can change
 * is the subscription (`resubscribeWhatsAppDelivery`: POST /<WABA>/subscribed_apps, the same call
 * connecting the number makes — and, per Meta, the call that also clears an account-level override).
 *
 * Reads that Meta may refuse on an older Graph version or for a token without the permission are
 * separate requests on purpose: one unreadable field must not turn the whole check into «Meta
 * refused» (the rule of lib/whatsapp-embedded-signup's platform read).
 */
const GRAPH = "https://graph.facebook.com/v21.0"
/** `platform_type` and `webhook_configuration` are read on a newer version, each on its own. */
const NEWER_GRAPH = "https://graph.facebook.com/v27.0"
const GRAPH_TIMEOUT_MS = 8000

export type DeliveryFacts = {
  number: { readable: boolean; status: string | null; platformType: string | null; error: string | null }
  subscription: {
    readable: boolean
    apps: Array<{ id: string; name: string | null; overrideHost: string | null }>
    /** The app this number's token belongs to, when it could be established. */
    ourAppId: string | null
    error: string | null
  }
  /** The callback hosts Meta reports for the number, when the field is readable. */
  callbacks: { readable: boolean; numberHost: string | null; accountHost: string | null; applicationHost: string | null }
}

export type DeliveryVerdict =
  | "ok"
  /** Subscribed, but Meta would not say whether the number is connected. */
  | "ok_number_unread"
  | "number_not_connected"
  | "not_subscribed"
  | "callback_elsewhere"
  | "meta_refused"
  /** Meta paused the number's Cloud API side (reonboarding) — lib/whatsapp-account-update. */
  | "paused"
  | "not_configured"

export type DeliveryAssessment = {
  verdict: DeliveryVerdict
  /** null when the subscription could not be read. */
  subscribed: boolean | null
  /** The host Meta sends this number's webhooks to, and where that is set. */
  callback: { host: string; level: "number" | "account" | "application"; ours: boolean } | null
  /** Whether subscribing again can fix what was found. */
  canResubscribe: boolean
}

export type DeliveryCheckView = DeliveryAssessment & {
  number: { status: string | null; platformType: string | null }
  subscribedApps: string[]
  /** Meta's own words when it refused a read. */
  metaError: string | null
  /** The last message a customer wrote to this number that reached the CRM. */
  lastInboundAt: string | null
  checkedAt: string
}

function hostOf(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** The last two labels of a host: `zeytun.leaddrivecrm.org` and `app.leaddrivecrm.org` are one home. */
function homeOf(host: string): string {
  return host.split(".").slice(-2).join(".")
}

/** Whether a callback host is this installation's: the app host, or a workspace subdomain beside it. */
export function isOurCallbackHost(host: string, appHost: string = hostOf(appOrigin()) ?? ""): boolean {
  if (!appHost) return true
  return host === appHost || homeOf(host) === homeOf(appHost)
}

/**
 * What the facts mean. Pure — the order is the order a person would check in: can Meta be asked at
 * all, is the number on Cloud API, is anybody subscribed, and is the callback ours.
 */
export function assessWhatsAppDelivery(facts: DeliveryFacts, appHost?: string): DeliveryAssessment {
  const { number, subscription, callbacks } = facts
  const subscribed = !subscription.readable
    ? null
    : subscription.ourAppId
      ? subscription.apps.some((app) => app.id === subscription.ourAppId)
      // Whose app the token is could not be established: any subscribed app is the best reading.
      : subscription.apps.length > 0

  const ourEntry = subscription.ourAppId ? subscription.apps.find((app) => app.id === subscription.ourAppId) : subscription.apps[0]
  // Meta's precedence: the number's own override, then the account's, then the app's callback.
  const effective: { host: string; level: "number" | "account" | "application" } | null = callbacks.readable
    ? callbacks.numberHost
      ? { host: callbacks.numberHost, level: "number" }
      : callbacks.accountHost
        ? { host: callbacks.accountHost, level: "account" }
        : callbacks.applicationHost
          ? { host: callbacks.applicationHost, level: "application" }
          : null
    : ourEntry?.overrideHost
      ? { host: ourEntry.overrideHost, level: "account" }
      : null
  const callback = effective ? { ...effective, ours: isOurCallbackHost(effective.host, appHost) } : null

  let verdict: DeliveryVerdict
  if (!number.readable && !subscription.readable) verdict = "meta_refused"
  else if (number.readable && String(number.status || "").toUpperCase() !== "CONNECTED") verdict = "number_not_connected"
  else if (subscribed === false) verdict = "not_subscribed"
  else if (callback && !callback.ours) verdict = "callback_elsewhere"
  else if (!number.readable) verdict = "ok_number_unread"
  else verdict = "ok"

  return {
    verdict,
    subscribed,
    callback,
    // Subscribing again subscribes the app and clears an ACCOUNT-level override. An override on the
    // number itself, or another app's own callback, is not ours to change from here.
    canResubscribe: verdict === "not_subscribed" || (verdict === "callback_elsewhere" && callback?.level === "account"),
  }
}

type GraphAnswer = { ok: boolean; json: Record<string, unknown> }

async function graphGet(base: string, path: string, token: string): Promise<GraphAnswer> {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: res.ok && !json.error, json }
  } catch (err) {
    return { ok: false, json: { error: { message: err instanceof Error ? err.message : "request failed" } } }
  }
}

/**
 * Meta's own words for a refusal, safe to show: the number's token cut out wherever it appears, and
 * any `access_token=` value with it. Not the general OAuth redactor — that one blanks everything
 * after «access token:», which is exactly the sentence Meta explains an expired key with.
 */
function graphErrorText(json: Record<string, unknown>, token: string): string {
  const error = json.error as { message?: unknown } | undefined
  const message = typeof error?.message === "string" && error.message ? error.message : "Meta did not answer."
  return message
    .split(token).join("[…]")
    .replace(/(access_token=)[^&\s"']+/gi, "$1[…]")
    .slice(0, 300)
}

async function readFacts(input: {
  token: string
  phoneNumberId: string
  wabaId: string | null
  knownAppId: string | null
}): Promise<DeliveryFacts> {
  const { token, phoneNumberId, wabaId, knownAppId } = input
  const [status, platform, hooks, apps, tokenApp] = await Promise.all([
    graphGet(GRAPH, `/${phoneNumberId}?fields=status`, token),
    graphGet(NEWER_GRAPH, `/${phoneNumberId}?fields=platform_type`, token),
    graphGet(NEWER_GRAPH, `/${phoneNumberId}?fields=webhook_configuration`, token),
    wabaId ? graphGet(GRAPH, `/${wabaId}/subscribed_apps`, token) : Promise.resolve<GraphAnswer>({ ok: false, json: { error: { message: "This number has no WhatsApp Business Account id saved." } } }),
    // Whose app the token is, for a number connected by hand with the customer's own app.
    knownAppId ? Promise.resolve<GraphAnswer>({ ok: true, json: { id: knownAppId } }) : graphGet(GRAPH, "/app?fields=id", token),
  ])

  const hookConfig = hooks.ok && hooks.json.webhook_configuration && typeof hooks.json.webhook_configuration === "object"
    ? (hooks.json.webhook_configuration as Record<string, unknown>)
    : null
  const appRows = apps.ok && Array.isArray(apps.json.data) ? (apps.json.data as Array<Record<string, unknown>>) : []

  return {
    number: {
      readable: status.ok && typeof status.json.status === "string",
      status: typeof status.json.status === "string" ? status.json.status : null,
      platformType: platform.ok && typeof platform.json.platform_type === "string" ? platform.json.platform_type : null,
      error: status.ok ? null : graphErrorText(status.json, token),
    },
    subscription: {
      readable: apps.ok,
      apps: appRows.flatMap((row) => {
        const app = row.whatsapp_business_api_data as { id?: unknown; name?: unknown } | undefined
        const id = app?.id === undefined || app?.id === null ? "" : String(app.id)
        if (!id) return []
        return [{ id, name: typeof app?.name === "string" ? app.name : null, overrideHost: hostOf(row.override_callback_uri) }]
      }),
      ourAppId: tokenApp.ok && tokenApp.json.id !== undefined && tokenApp.json.id !== null ? String(tokenApp.json.id) : null,
      error: apps.ok ? null : graphErrorText(apps.json, token),
    },
    callbacks: {
      readable: hookConfig !== null,
      numberHost: hostOf(hookConfig?.phone_number),
      accountHost: hostOf(hookConfig?.whatsapp_business_account),
      applicationHost: hostOf(hookConfig?.application),
    },
  }
}

type NumberRow = {
  id: string
  configName: string
  token: string | null
  phoneNumberId: string | null
  wabaId: string | null
  settings: unknown
  isActive: boolean
}

async function loadNumber(organizationId: string, channelId: string): Promise<NumberRow | null> {
  const row = await prisma.channelConfig.findFirst({
    where: { id: channelId, organizationId, channelType: "whatsapp" },
    select: {
      id: true, configName: true, isActive: true, settings: true,
      accessToken: true, apiKey: true, phoneNumberId: true, phoneNumber: true, businessAccountId: true, webhookUrl: true,
    },
  })
  if (!row) return null
  return {
    id: row.id,
    configName: row.configName,
    isActive: row.isActive,
    settings: row.settings,
    // New columns first, the legacy trio for rows not migrated yet — as resolveWhatsAppConfig reads them.
    token: row.accessToken || row.apiKey || null,
    phoneNumberId: row.phoneNumberId || row.phoneNumber || null,
    wabaId: row.businessAccountId || row.webhookUrl || null,
  }
}

function embeddedSignupAppId(settings: unknown): string | null {
  const viaSignup = !!settings && typeof settings === "object" && (settings as Record<string, unknown>).embeddedSignup === true
  return viaSignup ? process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_ID?.trim() || null : null
}

async function lastInboundAt(organizationId: string, channelId: string): Promise<string | null> {
  const row = await prisma.channelMessage.findFirst({
    where: { organizationId, channelConfigId: channelId, channelType: "whatsapp", direction: "inbound", historyImportedAt: null },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  }).catch(() => null)
  return row ? row.createdAt.toISOString() : null
}

function emptyView(verdict: DeliveryVerdict, lastInbound: string | null): DeliveryCheckView {
  return {
    verdict,
    subscribed: null,
    callback: null,
    canResubscribe: false,
    number: { status: null, platformType: null },
    subscribedApps: [],
    metaError: null,
    lastInboundAt: lastInbound,
    checkedAt: new Date().toISOString(),
  }
}

/** The check for one WhatsApp number of a workspace, or null when there is no such number. */
export async function checkWhatsAppDelivery(organizationId: string, channelId: string): Promise<DeliveryCheckView | null> {
  const row = await loadNumber(organizationId, channelId)
  if (!row) return null
  const lastInbound = await lastInboundAt(organizationId, channelId)
  if (!row.token || !row.phoneNumberId) return emptyView("not_configured", lastInbound)
  if (isCloudApiPaused(row.settings)) return emptyView("paused", lastInbound)

  const facts = await readFacts({ token: row.token, phoneNumberId: row.phoneNumberId, wabaId: row.wabaId, knownAppId: embeddedSignupAppId(row.settings) })
  const assessment = assessWhatsAppDelivery(facts)
  return {
    ...assessment,
    number: { status: facts.number.status, platformType: facts.number.platformType },
    subscribedApps: facts.subscription.apps.map((app) => app.name || app.id),
    metaError: assessment.verdict === "meta_refused" ? facts.number.error || facts.subscription.error : facts.subscription.readable ? null : facts.subscription.error,
    lastInboundAt: lastInbound,
    checkedAt: new Date().toISOString(),
  }
}

export type ResubscribeResult =
  | { ok: true; view: DeliveryCheckView }
  | { ok: false; reason: "not_found" | "not_configured" | "nothing_to_fix" | "meta_refused"; error?: string; view?: DeliveryCheckView }

/**
 * Subscribes the number's app to its account's webhooks again — only when the check says that is
 * what is wrong. Never a blind POST: on a working number it would do nothing useful, and on one
 * with an account-level override it clears the override, which must be a decision, not a side effect.
 */
export async function resubscribeWhatsAppDelivery(organizationId: string, channelId: string): Promise<ResubscribeResult> {
  const row = await loadNumber(organizationId, channelId)
  if (!row) return { ok: false, reason: "not_found" }
  if (!row.token || !row.wabaId) return { ok: false, reason: "not_configured" }
  const before = await checkWhatsAppDelivery(organizationId, channelId)
  if (!before) return { ok: false, reason: "not_found" }
  if (!before.canResubscribe) return { ok: false, reason: "nothing_to_fix", view: before }

  let answer: GraphAnswer
  try {
    const res = await fetch(`${GRAPH}/${row.wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${row.token}` },
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    answer = { ok: res.ok && json.success === true, json }
  } catch (err) {
    answer = { ok: false, json: { error: { message: err instanceof Error ? err.message : "request failed" } } }
  }
  if (!answer.ok) return { ok: false, reason: "meta_refused", error: graphErrorText(answer.json, row.token), view: before }

  const after = await checkWhatsAppDelivery(organizationId, channelId)
  return { ok: true, view: after ?? before }
}
