import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { encryptToken } from "@/lib/secure-token"
import { redactOAuthProviderText } from "@/lib/oauth-redaction"

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
 *   WHATSAPP_APP_ID, WHATSAPP_APP_SECRET            LeadDrive's shared Meta app (the Tech Provider app)
 *   WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID              the Facebook Login for Business configuration id
 */
const GRAPH = "https://graph.facebook.com/v21.0"

export type WhatsAppPlatformApp = { appId: string; appSecret: string; configId: string }

export function whatsappPlatformApp(): WhatsAppPlatformApp | null {
  const appId = process.env.WHATSAPP_APP_ID?.trim()
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim()
  const configId = process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?.trim()
  return appId && appSecret && configId ? { appId, appSecret, configId } : null
}

export type EmbeddedSignupInput = {
  organizationId: string
  code: string
  wabaId: string
  phoneNumberId: string
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
      registration: "registered" | "already_connected" | "failed"
      registrationError?: string
    }
  | { ok: false; step: "config" | "exchange" | "phone" | "ownership" | "conflict" | "subscribe"; error: string }

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

export async function completeEmbeddedSignup(input: EmbeddedSignupInput): Promise<EmbeddedSignupResult> {
  const app = whatsappPlatformApp()
  if (!app) return { ok: false, step: "config", error: "WhatsApp Embedded Signup is not configured on this server." }
  const wabaId = input.wabaId.trim()
  const phoneNumberId = input.phoneNumberId.trim()
  if (!input.code || !isGraphId(wabaId) || !isGraphId(phoneNumberId)) {
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
  const phone = list.find((p) => String(p.id) === phoneNumberId)
  if (!phone) return { ok: false, step: "ownership", error: "That phone number is not part of the WhatsApp Business Account you connected." }
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

  // 3. webhooks for the WABA → LeadDrive's app.
  const subscribe = await graph(`/${wabaId}/subscribed_apps`, { method: "POST", token })
  if (!subscribe.ok) return { ok: false, step: "subscribe", error: graphError(subscribe.json, "Meta refused the webhook subscription for this account.") }

  // 4. register the number for Cloud API messaging unless it already is.
  let registration: "registered" | "already_connected" | "failed" = "already_connected"
  let registrationError: string | undefined
  let pin: string | null = null
  if (String(phone.status || "").toUpperCase() !== "CONNECTED") {
    pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
    const register = await graph(`/${phoneNumberId}/register`, {
      method: "POST",
      token,
      body: { messaging_product: "whatsapp", pin },
    })
    if (register.ok) registration = "registered"
    else {
      registration = "failed"
      registrationError = graphError(register.json, "Meta did not register the number.")
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
    ...(pin ? { registrationPin: encryptToken(pin, "whatsapp-registration-pin") } : {}),
  }
  const data = {
    accessToken: token,
    apiKey: null,
    phoneNumberId,
    businessAccountId: wabaId,
    displayName: verifiedName,
    // The shared app's secret verifies webhooks for this row (env WHATSAPP_APP_SECRET); nothing per row.
    appSecret: null,
    verifyToken: null,
    isActive: true,
    settings,
  }
  let channelId: string
  if (existing) {
    await prisma.channelConfig.update({ where: { id: existing.id }, data })
    channelId = existing.id
  } else {
    const row = await prisma.channelConfig.create({
      data: {
        organizationId: input.organizationId,
        channelType: "whatsapp",
        configName: verifiedName || displayPhoneNumber || "WhatsApp",
        createdBy: input.createdBy || null,
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
    ...(registrationError ? { registrationError } : {}),
  }
}
