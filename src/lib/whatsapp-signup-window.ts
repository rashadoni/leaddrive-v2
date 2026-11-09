import { getOrgSubdomain } from "@/lib/tenant-domain"

/**
 * WhatsApp Embedded Signup runs Meta's JS SDK, and Meta lets the SDK start only on the domains listed
 * in the app's "Allowed domains for the JavaScript SDK" — that list holds app.leaddrivecrm.org alone and
 * cannot hold every tenant subdomain. On zeytun.leaddrivecrm.org the dialog died with «Неизвестный
 * домен размещения JSSDK» (2026-10-26).
 *
 * So a tenant host never loads the SDK: its channel catalog opens a small window on the app host
 * (/connect/whatsapp, components/channels/whatsapp-signup-window), the dialog runs there, and the window
 * hands the one-time code plus the account/number ids back to the tenant tab with postMessage. The tenant
 * tab then POSTs them to its own /api/v1/channels/whatsapp/embedded-signup under its own session, exactly
 * as before — the window itself has no session and touches no API.
 *
 * The window posts only to an origin this module accepts (the app host or an https tenant subdomain),
 * and the tenant tab accepts results only from the app origin.
 */
export const WHATSAPP_SIGNUP_WINDOW_PATH = "/connect/whatsapp"
export const WHATSAPP_SIGNUP_RELAY_TYPE = "LEADDRIVE_WA_SIGNUP"

export function appOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || "https://app.leaddrivecrm.org").origin
  } catch {
    return "https://app.leaddrivecrm.org"
  }
}

/** May the signup window hand its result to this origin? The app host itself or an https tenant subdomain. */
export function isSignupReturnOrigin(origin: string | null | undefined, app: string = appOrigin()): boolean {
  if (!origin) return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  // An origin only — no path, query, credentials or trailing junk.
  if (url.origin !== origin) return false
  if (origin === app) return true
  return url.protocol === "https:" && getOrgSubdomain(url.hostname) !== null
}

/** Which of Meta's two paths the window should open; `keepBusinessApp` is the coexistence one. */
export type SignupWindowMode = { keepBusinessApp?: boolean }

export function signupWindowUrl(
  returnOrigin: string,
  lang: string | null,
  app: string = appOrigin(),
  mode: SignupWindowMode = {},
): string {
  const params = new URLSearchParams({ origin: returnOrigin })
  if (lang === "az" || lang === "ru" || lang === "en") params.set("lang", lang)
  // Absent means the path this product has always taken. A window opened from an older cached tab
  // therefore keeps behaving exactly as before.
  if (mode.keepBusinessApp) params.set("keepApp", "1")
  return `${app}${WHATSAPP_SIGNUP_WINDOW_PATH}?${params.toString()}`
}

/** Read the window's mode back out of its own URL. */
export function readSignupWindowMode(value: string | string[] | undefined): SignupWindowMode {
  return { keepBusinessApp: (Array.isArray(value) ? value[0] : value) === "1" }
}

export type RelayedSignup =
  | {
      kind: "connected"
      code: string
      wabaId: string
      /** Empty when Meta's completion event carried no number; the server looks it up. */
      phoneNumberId: string
      /** Meta's completion event, which says whether the customer kept their WhatsApp Business app. */
      signupEvent: string | null
      businessId: string | null
    }
  | { kind: "cancel" }
  | { kind: "failed" }

/** The signup window's message, or null for anything else posted to the tenant tab. */
export function readRelayedSignup(origin: string, raw: unknown, app: string = appOrigin()): RelayedSignup | null {
  if (origin !== app) return null
  if (!raw || typeof raw !== "object") return null
  const message = raw as Record<string, unknown>
  if (message.type !== WHATSAPP_SIGNUP_RELAY_TYPE) return null
  if (message.result === "cancel") return { kind: "cancel" }
  if (message.result === "failed") return { kind: "failed" }
  if (message.result !== "connected") return null
  const code = typeof message.code === "string" ? message.code : ""
  const wabaId = String(message.wabaId ?? "")
  // A missing number is relayed as empty rather than dropped: Meta's coexistence completion event
  // may carry only the account id, and the server resolves the number from that account.
  const phoneNumberId = message.phoneNumberId ? String(message.phoneNumberId) : ""
  if (!code || !/^\d+$/.test(wabaId)) return null
  if (phoneNumberId && !/^\d+$/.test(phoneNumberId)) return null
  const businessId = message.businessId ? String(message.businessId) : null
  const signupEvent = typeof message.signupEvent === "string" ? message.signupEvent : null
  return { kind: "connected", code, wabaId, phoneNumberId, signupEvent, businessId }
}
