import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { encryptToken } from "@/lib/secure-token"
import { redactOAuthProviderText } from "@/lib/oauth-redaction"
import { decideNumberOnboarding, type NumberPlatformFacts } from "@/lib/whatsapp-number-onboarding"

/**
 * WhatsApp Embedded Signup — a business connects its own WhatsApp number to LeadDrive through Meta's
 * dialog instead of copying a Phone Number ID and an access token out of Meta's dashboard.
 *
 * The browser runs Meta's dialog (FB.login with the Embedded Signup configuration) and hands us three
 * things: a one-time code (valid ~30 s), the customer's WhatsApp Business Account id and the phone
 * number id they picked. Everything else is server-side, in the order Meta's Tech Provider onboarding
 * prescribes:
 *   1. exchange the code for a business integration system user token (app secret stays here);
 *   2. confirm the phone number really belongs to that WABA — the ids come from the browser, the token
 *      is what proves which assets the customer granted;
 *   3. subscribe LeadDrive's app to the WABA's webhooks (POST /<WABA_ID>/subscribed_apps);
 *   4. register the number for Cloud API messaging (POST /<PHONE_NUMBER_ID>/register) unless Meta
 *      already reports it CONNECTED;
 *   5. save the channel for this workspace.
 * The remaining step of Meta's list — the customer adds a payment method in WhatsApp Manager — is the
 * customer's and is shown to them, not done here.
 *
 * Configuration (all three or nothing; the feature stays hidden otherwise):
 *   WHATSAPP_EMBEDDED_SIGNUP_APP_ID, WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET
 *                                       LeadDrive's shared Meta app (the Tech Provider app)
 *   WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID  the Facebook Login for Business configuration id
 * Deliberately NOT the older WHATSAPP_APP_SECRET: webhooks/whatsapp gives that one a meaning of its own (the
 * secret for callbacks without `?t=`), and setting it would change how those are verified.
 */
const GRAPH = "https://graph.facebook.com/v21.0"
/**
 * `is_on_biz_app` and `platform_type` — the fields that say whether a number also lives in the
 * WhatsApp Business app — are read on their own, newer version. Asking for them on the v21 phone
 * numbers edge above would risk one unknown field turning the ownership check itself into an error;
 * here a failure is an expected outcome and means "unreadable" (lib/whatsapp-number-onboarding).
 */
const PLATFORM_GRAPH = "https://graph.facebook.com/v27.0"

export type WhatsAppPlatformApp = { appId: string; appSecret: string; configId: string }

export function whatsappPlatformApp(): WhatsAppPlatformApp | null {
  const appId = process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_ID?.trim()
  const appSecret = process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET?.trim()
  const configId = process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?.trim()
  return appId && appSecret && configId ? { appId, appSecret, configId } : null
}

export type EmbeddedSignupInput = {
  organizationId: string
  code: string
  wabaId: string
  /**
   * Optional on purpose. Meta's coexistence example shows a completion event carrying only
   * `waba_id`, and a dialog the customer actually finished must not be reported as a failure over a
   * missing id we can look up ourselves — see `resolvePhoneNumber`.
   */
  phoneNumberId?: string | null
  /** Embedded Signup's completion event, which is how the browser tells us the customer kept their app. */
  signupEvent?: string | null
  businessId?: string | null
  createdBy?: string | null
}

export type EmbeddedSignupResult =
  | {
      ok: true
      channelId: string
      created: boolean
      displayPhoneNumber: string | null
      verifiedName: string | null
      /**
       * `already_connected` also covers a coexistence number: it is already registered, which is
       * precisely why we must not register it. Kept as one of the two old values so a browser still
       * running yesterday's script does not read a good connection as a failure.
       */
      registration: "registered" | "already_connected"
      /** The number stays usable in the WhatsApp Business app on the customer's phone. */
      coexistence: boolean
    }
  | { ok: false; step: "config" | "exchange" | "phone" | "ownership" | "conflict" | "subscribe" | "register" | "platform"; error: string }

type GraphJson = Record<string, unknown> & { error?: { message?: string } }

async function graph(
  path: string,
  init: { method?: "GET" | "POST"; token?: string; body?: Record<string, unknown> } = {},
): Promise<{ ok: boolean; status: number; json: GraphJson }> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: init.method || "GET",
    headers: {
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  const json = ((await res.json().catch(() => ({}))) || {}) as GraphJson
  return { ok: res.ok && !json.error, status: res.status, json }
}

function graphError(json: GraphJson, fallback: string): string {
  return redactOAuthProviderText(json.error?.message || fallback)
}

const isGraphId = (value: string) => /^\d{5,25}$/.test(value)

type WabaNumber = Record<string, unknown>

/**
 * Which number the customer connected.
 *
 * Normally the browser tells us. Meta's coexistence documentation, however, shows a completion event
 * carrying only `waba_id`, and we cannot verify which it is until a real number goes through — so a
 * missing id is recovered here instead of failing a signup the customer completed. The account's own
 * number list is the authority: one number means one answer, and several with nothing to choose by
 * is the one case worth refusing, because picking the wrong colleague's number would connect the
 * wrong WhatsApp.
 */
async function resolvePhoneNumber(
  given: string,
  numbers: WabaNumber[],
): Promise<{ ok: true; phone: WabaNumber; phoneNumberId: string } | { ok: false; error: string }> {
  if (given) {
    const phone = numbers.find((p) => String(p.id) === given)
    return phone
      ? { ok: true, phone, phoneNumberId: given }
      : { ok: false, error: "That phone number is not part of the WhatsApp Business Account you connected." }
  }
  if (numbers.length === 1) {
    return { ok: true, phone: numbers[0], phoneNumberId: String(numbers[0].id) }
  }
  if (numbers.length === 0) {
    return { ok: false, error: "This WhatsApp Business Account has no phone number yet. Add the number in WhatsApp Manager, then connect again." }
  }
  return {
    ok: false,
    error: "Meta did not say which number was connected, and this account has several. Connect again and pick the number in Meta's dialog.",
  }
}

/**
 * Does this number also live in the WhatsApp Business app?
 *
 * Unreadable is a normal answer — the fields may not exist on the version the app is allowed to
 * call, and the request may simply be refused. The caller decides what to do with silence
 * (lib/whatsapp-number-onboarding); it never means "no".
 */
async function readNumberPlatform(phoneNumberId: string, token: string): Promise<NumberPlatformFacts> {
  const res = await fetch(`${PLATFORM_GRAPH}/${phoneNumberId}?fields=is_on_biz_app,platform_type`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!res) return { isOnBizApp: null, platformType: null }
  const json = ((await res.json().catch(() => ({}))) || {}) as GraphJson
  if (!res.ok || json.error) return { isOnBizApp: null, platformType: null }
  return {
    isOnBizApp: typeof json.is_on_biz_app === "boolean" ? json.is_on_biz_app : null,
    platformType: typeof json.platform_type === "string" ? json.platform_type : null,
  }
}

export async function completeEmbeddedSignup(input: EmbeddedSignupInput): Promise<EmbeddedSignupResult> {
  const app = whatsappPlatformApp()
  if (!app) return { ok: false, step: "config", error: "WhatsApp Embedded Signup is not configured on this server." }
  const wabaId = input.wabaId.trim()
  const givenPhoneNumberId = (input.phoneNumberId || "").trim()
  if (!input.code || !isGraphId(wabaId) || (givenPhoneNumberId && !isGraphId(givenPhoneNumberId))) {
    return { ok: false, step: "exchange", error: "Meta did not return a complete signup (code, account and number)." }
  }

  // 1. code → business token. Meta's documented shape carries the secret as a query parameter; the URL
  //    is never logged.
  const qs = new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, code: input.code })
  const exchange = await graph(`/oauth/access_token?${qs.toString()}`)
  const token = typeof exchange.json.access_token === "string" ? exchange.json.access_token : ""
  if (!exchange.ok || !token) {
    return { ok: false, step: "exchange", error: graphError(exchange.json, "Meta refused the signup code; it is valid for 30 seconds — try again.") }
  }

  // 2. the number must belong to the WABA the token was granted for.
  const numbers = await graph(`/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,status&limit=100`, { token })
  if (!numbers.ok) return { ok: false, step: "ownership", error: graphError(numbers.json, "Could not read the WhatsApp Business Account.") }
  const list = Array.isArray(numbers.json.data) ? (numbers.json.data as Array<Record<string, unknown>>) : []
  const picked = await resolvePhoneNumber(givenPhoneNumberId, list)
  if (!picked.ok) return { ok: false, step: "ownership", error: picked.error }
  const { phone, phoneNumberId } = picked
  const displayPhoneNumber = typeof phone.display_phone_number === "string" ? phone.display_phone_number : null
  const verifiedName = typeof phone.verified_name === "string" ? phone.verified_name : null

  // A number serves one workspace. Another workspace's active claim is not taken over silently.
  const claimedElsewhere = await runWithRlsBypass(() =>
    prisma.channelConfig.findFirst({
      where: {
        channelType: "whatsapp",
        isActive: true,
        organizationId: { not: input.organizationId },
        OR: [{ phoneNumberId }, { phoneNumber: phoneNumberId }],
      },
      select: { id: true },
    }),
  )
  if (claimedElsewhere) {
    return { ok: false, step: "conflict", error: "This WhatsApp number is already connected to another LeadDrive workspace." }
  }

  // Which kind of number this is, decided in one place from both signals we have.
  const facts = await readNumberPlatform(phoneNumberId, token)
  const decision = decideNumberOnboarding({ facts, signupEvent: input.signupEvent })
  console.log(
    `[WA Signup] number ${phoneNumberId}: mode=${decision.mode} register=${decision.register}`
    + ` reason=${decision.reason} is_on_biz_app=${facts.isOnBizApp} platform_type=${facts.platformType ?? "?"}`
    + ` event=${input.signupEvent ?? "?"}`,
  )
  if (decision.mode === "contradiction") {
    return { ok: false, step: "platform", error: decision.error ?? "Meta describes this number inconsistently." }
  }

  // 3. webhooks for the WABA → LeadDrive's app.
  const subscribe = await graph(`/${wabaId}/subscribed_apps`, { method: "POST", token })
  if (!subscribe.ok) return { ok: false, step: "subscribe", error: graphError(subscribe.json, "Meta refused the webhook subscription for this account.") }

  // 4. register the number for Cloud API messaging unless it already is — and never for a number
  //    that also lives in the WhatsApp Business app. Meta: "skip the phone number registration
  //    step, as the number is already registered". Both guards stand: the decision above, and the
  //    status Meta reports for this number.
  let registration: "registered" | "already_connected" = "already_connected"
  let pin: string | null = null
  if (decision.register && String(phone.status || "").toUpperCase() !== "CONNECTED") {
    pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
    const register = await graph(`/${phoneNumberId}/register`, {
      method: "POST",
      token,
      body: { messaging_product: "whatsapp", pin },
    })
    if (register.ok && register.json.success === true) registration = "registered"
    else {
      // A failed request is not proof that registration succeeded. The number may have become
      // connected since our first read, so confirm that state rather than interpreting error text.
      const refreshed = await graph(`/${wabaId}/phone_numbers?fields=id,status&limit=100`, { token }).catch(() => null)
      const refreshedNumbers = refreshed?.ok && Array.isArray(refreshed.json.data)
        ? refreshed.json.data as Array<Record<string, unknown>>
        : []
      const connected = refreshedNumbers.some((p) => String(p.id) === phoneNumberId && String(p.status).toUpperCase() === "CONNECTED")
      if (!connected) {
        // Leave an existing channel and its credentials intact; do not create a sendable channel
        // for an incomplete onboarding. A fresh signup can retry after the provider issue is fixed.
        return { ok: false, step: "register", error: graphError(register.json, "Meta did not confirm registration of the number. Complete the number setup in WhatsApp Manager, then connect again.") }
      }
      pin = null
    }
  }

  // 5. the channel. One row per (workspace, number): a reconnect refreshes the same row.
  const existing = await prisma.channelConfig.findFirst({
    where: { organizationId: input.organizationId, channelType: "whatsapp", OR: [{ phoneNumberId }, { phoneNumber: phoneNumberId }] },
    select: { id: true, settings: true },
  })
  const prev = existing?.settings && typeof existing.settings === "object" && !Array.isArray(existing.settings)
    ? (existing.settings as Record<string, unknown>)
    : {}
  const settings: Record<string, unknown> = {
    ...prev,
    embeddedSignup: true,
    businessId: input.businessId || prev.businessId || null,
    displayPhoneNumber,
    onboardedAt: new Date().toISOString(),
    registration,
    // What this number is, and on whose word. The reason is kept because both signals are still
    // unproven against a live coexistence number: when one turns out wrong, this is the evidence.
    coexistence: decision.mode === "coexistence",
    onboardingMode: decision.mode,
    onboardingReason: decision.reason,
    isOnBizApp: facts.isOnBizApp,
    platformType: facts.platformType,
    ...(pin ? { registrationPin: encryptToken(pin, "whatsapp-registration-pin") } : {}),
  }
  const data = {
    accessToken: token,
    apiKey: null,
    phoneNumberId,
    businessAccountId: wabaId,
    displayName: verifiedName,
    isActive: true,
    settings,
  }
  let channelId: string
  if (existing) {
    // A reconnect keeps the row's own App Secret and Verify Token. The shared app's secret is what verifies
    // this number from now on, but the row's secret may be the one webhooks/whatsapp checks for the whole
    // `?t=<slug>` URL — LeadDrive's own number is exactly that row for the shared callback — and erasing
    // it would reject every WhatsApp callback behind that URL, every workspace's included.
    await prisma.channelConfig.update({ where: { id: existing.id }, data })
    channelId = existing.id
  } else {
    const row = await prisma.channelConfig.create({
      data: {
        organizationId: input.organizationId,
        channelType: "whatsapp",
        configName: verifiedName || displayPhoneNumber || "WhatsApp",
        createdBy: input.createdBy || null,
        // The shared app's secret verifies webhooks for this row (env WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET);
        // nothing per row.
        appSecret: null,
        verifyToken: null,
        ...data,
      },
      select: { id: true },
    })
    channelId = row.id
  }

  return {
    ok: true,
    channelId,
    created: !existing,
    displayPhoneNumber,
    verifiedName,
    registration,
    coexistence: decision.mode === "coexistence",
  }
}
