import type { SmsProvider, SmsProviderSettings, SmsSendParams, SmsSendResult } from "./types"

/**
 * Web Crypto UUID — works in both Node 19+ and the Edge runtime, no module import
 * needed. Falls back to a timestamp-based ID on the unlikely chance `crypto`
 * isn't exposed (e.g. very old runtimes).
 */
function webUuid(): string {
  const c = (globalThis as any).crypto
  if (c && typeof c.randomUUID === "function") return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * ATL SMS (Azerbaijan) — HTTPS POST with XML body.
 *
 * Docs: Bulk SMS API (send.atlsms.az). See docs/sms-otp.md → "ATL SMS" section.
 *
 * Settings shape (per-org, under ChannelConfig(voip).settings):
 *   { smsProvider: "atl", atlLogin, atlPassword, atlTitle }
 *
 * Env fallbacks:
 *   ATL_LOGIN, ATL_PASSWORD, ATL_TITLE
 *
 * Phone format: ATL expects "994XXXXXXXXX" (country code without leading + or 00).
 * The adapter strips "+" and non-digits before sending.
 *
 * `atlTitle` is the approved sender name ("TEST" for the sandbox, your brand
 * name in production — must be pre-registered with your ATL account manager).
 */

interface AtlSettings extends SmsProviderSettings {
  atlLogin?: string
  atlPassword?: string
  atlTitle?: string
}

const ATL_ENDPOINT = process.env.ATL_ENDPOINT || "https://send.atlsms.az:7443/bulksms/api"

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;"
      case ">": return "&gt;"
      case "&": return "&amp;"
      case "'": return "&apos;"
      case '"': return "&quot;"
      default: return c
    }
  })
}

/**
 * Pull a flat tag value out of ATL's XML response.
 * Responses are shallow (no nested repeats for submit), so a tolerant regex
 * is safer than adding a full XML parser dep.
 */
function pickXmlTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i")
  const m = xml.match(re)
  return m?.[1]
}

/** ATL expects 994XXXXXXXXX — strip leading + and any non-digit separators. */
function normalizePhone(phone: string): string {
  return phone.replace(/^\+/, "").replace(/\D/g, "")
}

/**
 * Unique per-task controlid — <50 chars.
 * Uses crypto.randomUUID to avoid Date.now collisions during high-parallel sends.
 */
function generateControlId(): string {
  return webUuid().replace(/-/g, "").slice(0, 32)
}

const ATL_ERROR_MESSAGES: Record<string, string> = {
  "001": "Processing — report not ready",
  "002": "Duplicate control_id",
  "100": "Bad request",
  "101": "Operation type is empty",
  "102": "Invalid operation",
  "103": "Login is empty",
  "104": "Password is empty",
  "105": "Invalid credentials",
  "106": "Title is empty",
  "107": "Invalid title",
  "108": "Task id is empty",
  "109": "Invalid task id",
  "110": "Task canceled",
  "111": "Scheduled date is empty",
  "112": "Invalid scheduled date",
  "113": "Scheduled date is in the past",
  "114": "isbulk is empty",
  "115": "Invalid isbulk value",
  "116": "Invalid bulk message",
  "117": "Invalid body",
  "118": "Not enough units (balance exhausted)",
  "235": "Invalid sender title — contact ATL account manager",
}

function mapErrorCode(code: string | undefined): string {
  if (!code) return "ATL returned no response code"
  if (ATL_ERROR_MESSAGES[code]) return ATL_ERROR_MESSAGES[code]
  if (/^2\d{2}$/.test(code)) return "ATL system error — contact administrator"
  if (code === "300") return "ATL internal server error"
  return `ATL error ${code}`
}

export const atlProvider: SmsProvider = {
  name: "atl",

  isConfigured(settings: SmsProviderSettings, allowEnv = true): boolean {
    const s = settings as AtlSettings
    const login = s.atlLogin || (allowEnv ? process.env.ATL_LOGIN : undefined)
    const password = s.atlPassword || (allowEnv ? process.env.ATL_PASSWORD : undefined)
    const title = s.atlTitle || (allowEnv ? process.env.ATL_TITLE : undefined)
    return Boolean(login && password && title)
  },

  async send(settings: SmsProviderSettings, params: SmsSendParams, allowEnv = true): Promise<SmsSendResult> {
    const s = settings as AtlSettings
    const login = s.atlLogin || (allowEnv ? process.env.ATL_LOGIN : undefined)
    const password = s.atlPassword || (allowEnv ? process.env.ATL_PASSWORD : undefined)
    const title = params.from || s.atlTitle || (allowEnv ? process.env.ATL_TITLE : undefined)

    if (!login || !password || !title) {
      return { success: false, error: "ATL SMS not configured" }
    }

    const msisdn = normalizePhone(params.to)
    if (!msisdn || msisdn.length < 7) {
      return { success: false, error: "Invalid phone number" }
    }

    const controlId = generateControlId()
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<request>\n` +
      ` <head>\n` +
      `  <operation>submit</operation>\n` +
      `  <login>${escapeXml(login)}</login>\n` +
      `  <password>${escapeXml(password)}</password>\n` +
      `  <title>${escapeXml(title)}</title>\n` +
      `  <bulkmessage>${escapeXml(params.message)}</bulkmessage>\n` +
      `  <scheduled>now</scheduled>\n` +
      `  <isbulk>true</isbulk>\n` +
      `  <controlid>${escapeXml(controlId)}</controlid>\n` +
      ` </head>\n` +
      ` <body>\n` +
      `  <msisdn>${escapeXml(msisdn)}</msisdn>\n` +
      ` </body>\n` +
      `</request>`

    try {
      const res = await fetch(ATL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/xml; charset=UTF-8" },
        body: xml,
      })

      const responseText = await res.text().catch(() => "")
      if (!res.ok) {
        return { success: false, error: `ATL HTTP ${res.status}: ${responseText.slice(0, 200)}` }
      }

      const code = pickXmlTag(responseText, "responsecode")
      if (code !== "000") {
        return { success: false, error: mapErrorCode(code) }
      }

      const taskid = pickXmlTag(responseText, "taskid")
      return { success: true, messageId: taskid }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },
}
