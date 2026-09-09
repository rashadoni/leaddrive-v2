// LeadDrive CRM — 3CX Call Control API Adapter
//
// Paths follow the official 3CX examples (github.com/3cx/call-control-examples,
// server/src/services/ExternalApi.service.ts):
//   POST /connect/token                                   → client_credentials
//   POST /callcontrol/{dn}/makecall                       → dial from the DN
//   POST /callcontrol/{dn}/devices/{device}/makecall      → dial from one device
//   POST /callcontrol/{dn}/participants/{id}/drop         → hang up
// Credentials come from the PBX: Admin → Integrations → API, with
// "Call Control Access" enabled. The client id is bound to a DN, which is why
// `extension` doubles as the default client id.

import { createHash } from "crypto"
import { threeCxDialNumber } from "../threecx-crm"
import { requestVoipEndpoint } from "../endpoint-guard"
import type {
  VoipProvider,
  ThreeCxSettings,
  InitiateCallParams,
  InitiateCallResult,
  TestConnectionResult,
  WebhookData,
} from "../types"

type CachedToken = { token: string; expiresAt: number }

/**
 * Access tokens are shared per (server, client) across requests — 3CX issues a
 * short-lived bearer and re-authenticating on every click-to-call is a wasted
 * round-trip against an on-prem PBX. Keyed by a hash of the secret too, so
 * rotating the API key can never serve the stale token.
 */
const tokenCache = new Map<string, CachedToken>()

/**
 * Test seam: the cache is module-level on purpose (it is shared across requests),
 * which makes it leak between test cases unless they reset it.
 */
export function __resetThreeCxTokenCache(): void {
  tokenCache.clear()
}

/** Refresh this many ms before the PBX's own expiry, to survive clock skew. */
const TOKEN_EXPIRY_MARGIN_MS = 30_000
/** Fallback lifetime when the PBX omits `expires_in`. */
const TOKEN_DEFAULT_TTL_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 15_000

export class ThreeCxProvider implements VoipProvider {
  private serverUrl: string
  private extension: string
  private clientId: string
  private deviceId: string | null
  private apiKey: string
  private timeout: number
  private dialFormat: ThreeCxSettings["dialFormat"]

  constructor(settings: ThreeCxSettings) {
    this.serverUrl = (settings.serverUrl || "").replace(/\/$/, "")
    this.extension = (settings.extension || "").trim()
    this.clientId = (settings.clientId || "").trim() || this.extension
    this.deviceId = (settings.deviceId || "").trim() || null
    this.dialFormat = settings.dialFormat === "as-is" ? "as-is" : "az-national"
    this.apiKey = settings.apiKey
    this.timeout =
      Number.isFinite(settings.timeout) && settings.timeout && settings.timeout > 0
        ? Math.floor(settings.timeout)
        : 30
  }

  getProviderName(): string {
    return "threecx"
  }

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    try {
      // Contacts are stored in E.164 but the PBX routes on its own outbound
      // rule — ours wants the AZ national form. Dialling the stored number
      // verbatim matches no rule and the call dies before the carrier sees it.
      const destination = threeCxDialNumber(params.toNumber, this.dialFormat)
      if (!destination) {
        return { success: false, error: "3CX cannot start the call: the contact has no phone number." }
      }

      const attempt = async (token: string): Promise<Response> => {
        const path = this.deviceId
          ? `/callcontrol/${encodeURIComponent(this.extension)}/devices/${encodeURIComponent(this.deviceId)}/makecall`
          : `/callcontrol/${encodeURIComponent(this.extension)}/makecall`
        return await this.request(path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ destination, timeout: this.timeout }),
        })
      }

      // A cached token can expire mid-flight — re-auth once, then give up.
      // Shared by the primary attempt AND the device fallback: the fallback
      // used to skip re-auth, so a token expiring between the device probe
      // and the retry surfaced as a bogus "needs Call Control Access" error.
      const attemptWithReauth = async (): Promise<Response> => {
        let r = await attempt(await this.getAccessToken())
        if (r.status === 401) {
          r = await attempt(await this.getAccessToken(true))
        }
        return r
      }

      let res = await attemptWithReauth()

      // No usable device on the DN (softphone signed out) — depending on the
      // build 3CX answers 404 (unknown device), 409 (busy) or 422 (nothing to
      // originate the call from). Retry through the first registered device,
      // which is what the official example does for DN-scoped dialling.
      let noDeviceOnDn = false
      if ((res.status === 404 || res.status === 409 || res.status === 422) && !this.deviceId) {
        const probe = await this.firstRegisteredDevice()
        if (probe.device) {
          this.deviceId = probe.device
          res = await attemptWithReauth()
        } else if (probe.confirmed) {
          // Only the PBX's own word that the device list is empty justifies
          // the "no registered phone" diagnosis. A failed probe (transient
          // 5xx, unknown schema) falls through to describeFailure instead of
          // confidently misdiagnosing a phone that may well be signed in.
          noDeviceOnDn = true
        }
      }

      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        const result = isRecord(data) && isRecord(data.result) ? data.result : {}
        const callSid = firstStringOrNumber(
          isRecord(data) ? data.callId : undefined,
          isRecord(data) ? data.callid : undefined,
          isRecord(data) ? data.id : undefined,
          result.callId,
          result.callid,
          result.id,
          result.participantId,
        )
        return { success: true, callSid: callSid || `3cx-${Date.now()}` }
      }

      // We probed the DN and it has no phone at all — say so plainly instead of
      // echoing a bare status code. 3CX dials the agent's own device first, so
      // an extension with no registered phone can never place a call.
      if (noDeviceOnDn) {
        return {
          success: false,
          error: `3CX cannot start the call: extension ${this.extension} has no registered phone. Sign in to the 3CX app (desktop or web client) as extension ${this.extension}, or point the CRM at an extension that has one.`,
        }
      }

      return { success: false, error: await this.describeFailure(res, "start the call") }
    } catch (e) {
      return { success: false, error: `3CX connection failed: ${(e as Error).message}` }
    }
  }

  async endCall(callSid: string): Promise<{ success: boolean; error?: string }> {
    try {
      const path = `/callcontrol/${encodeURIComponent(this.extension)}/participants/${encodeURIComponent(callSid)}/drop`
      const send = async (token: string) =>
        this.request(path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        })

      let res = await send(await this.getAccessToken())
      if (res.status === 401) res = await send(await this.getAccessToken(true))

      if (res.ok) return { success: true }
      return { success: false, error: await this.describeFailure(res, "end the call") }
    } catch (e) {
      return { success: false, error: `3CX connection failed: ${(e as Error).message}` }
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.serverUrl) return { success: false, message: "3CX server URL is not set." }
    if (!this.extension) return { success: false, message: "3CX extension (DN) is not set." }
    if (!this.apiKey) return { success: false, message: "3CX API key is not set." }

    try {
      const token = await this.getAccessToken(true)
      const res = await this.request(`/callcontrol/${encodeURIComponent(this.extension)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.ok) {
        // Reachable is not the same as callable: `makecall` rings the DN's own
        // devices first and only then dials out, so a DN with nothing registered
        // accepts the request and silently rings nobody. That failure is
        // invisible at call time (the log just sits at "initiated"), so it has
        // to surface here instead.
        const data = await res.json().catch(() => ({}))
        const devices = isRecord(data) && Array.isArray(data.devices) ? data.devices : []
        if (devices.length === 0) {
          return {
            success: false,
            message: `Credentials are valid, but extension ${this.extension} has no registered device. Sign in to the 3CX app or web client on that extension — otherwise a click-to-call has nothing to ring.`,
          }
        }
        return {
          success: true,
          message: `3CX connection verified. Extension ${this.extension} is reachable with ${devices.length} registered device(s).`,
        }
      }
      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          message:
            '3CX rejected the credentials for Call Control. Check that the API client in Admin → Integrations → API has "Call Control Access" enabled and that the client id matches this extension.',
        }
      }
      if (res.status === 404) {
        return {
          success: false,
          message: `Extension ${this.extension} was not found on the PBX, or the API client is not allowed to control it.`,
        }
      }
      return { success: false, message: `3CX returned status ${res.status}.` }
    } catch (e) {
      return { success: false, message: `Cannot reach 3CX server: ${(e as Error).message}` }
    }
  }

  parseWebhook(body: Record<string, unknown>): WebhookData | null {
    // 3CX webhook payloads vary by version; map common fields
    const callId = (body.callId || body.CallId || body.id) as string
    if (!callId) return null

    return {
      callSid: callId,
      status: (body.status || body.Status || "unknown") as string,
      duration: body.duration ? Number(body.duration) : undefined,
      recordingUrl: body.recordingUrl as string | undefined,
      from: body.from as string | undefined,
      to: body.to as string | undefined,
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private get cacheKey(): string {
    const secretFingerprint = createHash("sha256")
      .update(this.apiKey || "")
      .digest("hex")
      .slice(0, 16)
    return `${this.serverUrl}|${this.clientId}|${secretFingerprint}`
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    return requestVoipEndpoint(`${this.serverUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: 64 * 1024,
    })
  }

  /**
   * `force` bypasses the cache — used by testConnection (the admin wants a real
   * check) and by the one-shot retry after a 401.
   */
  private async getAccessToken(force = false): Promise<string> {
    const key = this.cacheKey
    if (!force) {
      const cached = tokenCache.get(key)
      if (cached && cached.expiresAt > Date.now()) return cached.token
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.apiKey,
      grant_type: "client_credentials",
    })
    const res = await this.request("/connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    })

    if (!res.ok) {
      // Never reflect a tenant-selected endpoint's response body. Status is
      // enough to diagnose authentication without creating an SSRF oracle.
      throw new Error(`3CX auth failed (${res.status})`)
    }

    const data = await res.json().catch(() => ({}))
    const token =
      isRecord(data) && typeof data.access_token === "string" ? data.access_token.trim() : ""
    if (!token) throw new Error("3CX auth failed: missing access_token")

    const expiresInSeconds =
      isRecord(data) && Number.isFinite(Number(data.expires_in)) ? Number(data.expires_in) : 0
    const ttl = expiresInSeconds > 0 ? expiresInSeconds * 1000 : TOKEN_DEFAULT_TTL_MS

    tokenCache.set(key, {
      token,
      expiresAt: Date.now() + Math.max(ttl - TOKEN_EXPIRY_MARGIN_MS, 5_000),
    })
    return token
  }

  /**
   * First registered device on the DN, used when a bare makecall finds none.
   * `confirmed` is true only when the PBX actually answered and the device
   * list was inspected — a failed probe (non-2xx, network error, unparseable
   * body, or devices whose ids we do not recognise) must never be read as
   * "there are no devices".
   */
  private async firstRegisteredDevice(): Promise<{ device: string | null; confirmed: boolean }> {
    try {
      const res = await this.request(`/callcontrol/${encodeURIComponent(this.extension)}`, {
        headers: { Authorization: `Bearer ${await this.getAccessToken()}` },
      })
      if (!res.ok) return { device: null, confirmed: false }
      const data = await res.json().catch(() => null)
      if (!isRecord(data) || !Array.isArray(data.devices)) return { device: null, confirmed: false }
      if (data.devices.length === 0) return { device: null, confirmed: true }
      for (const device of data.devices) {
        if (!isRecord(device)) continue
        const id = firstStringOrNumber(device.device_id, device.deviceId, device.id)
        if (id) return { device: id, confirmed: true }
      }
      // Devices exist but none exposed an id shape we know — that is an
      // unknown schema, not an empty DN.
      return { device: null, confirmed: false }
    } catch {
      return { device: null, confirmed: false }
    }
  }

  private async describeFailure(res: Response, action: string): Promise<string> {
    switch (res.status) {
      case 401:
      case 403:
        return `3CX refused to ${action} (${res.status}). The API client needs "Call Control Access" in Admin → Integrations → API, and Call Control requires a licence tier that includes it.`
      case 404:
        return `3CX could not ${action} (404): extension ${this.extension} has no registered device, or the API client cannot control it.`
      case 409:
        return `3CX could not ${action} (409): the extension is busy or already in a call.`
      case 422:
        return `3CX rejected the request to ${action} (422): extension ${this.extension} has no phone 3CX can use, or the destination number is not allowed by an outbound rule.`
      default:
        return `3CX API error (${res.status})`
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function firstStringOrNumber(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return null
}
