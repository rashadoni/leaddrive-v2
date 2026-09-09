// LeadDrive CRM — Asterisk ARI (Asterisk REST Interface) Adapter

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto"

import { secureFanumPbxControlFetch } from "../fanum-pbx-control-transport"
import { requestVoipEndpoint } from "../endpoint-guard"
import { isOutboundVoiceDispatchPaused } from "../outbound-dispatch-gate"
import type {
  VoipProvider,
  AsteriskSettings,
  AsteriskTerminalOutcome,
  CallActivityResult,
  CallFinalityResult,
  InitiateCallParams,
  InitiateCallResult,
  TestConnectionResult,
  WebhookData,
} from "../types"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const ORIGINATE_TIMEOUT_MS = 15_000
/**
 * How long the originate request may wait — and therefore how long the
 * customer's phone is allowed to ring.
 *
 * The coordinator's ARI originate is synchronous: it does not return until the
 * dialplan is done with the channel, which for an unanswered call means the
 * full Dial() window. With the 15 s control budget above, our own request
 * aborted first and the channel died with it, so every call nobody picked up
 * within ~15 s was killed by us and recorded as "no answer" — measured
 * 2026-08-19: a real call rang 19 s and ended, while the dialplan allows 60.
 * This budget therefore sits just above the dialplan's window; the dialplan,
 * not an HTTP client, decides when ringing stops.
 */
const ORIGINATE_RING_TIMEOUT_MS = 65_000
const DEFINITE_ORIGINATE_REJECTION_STATUSES = new Set([400, 401, 403, 404, 405, 422])
const ATTEMPT_PROTOCOL = "fanum-voice-attempt-v1"
const ATTEMPT_SIGNATURE_HEADER = "X-Fanum-Voice-Signature"
const ATTEMPT_REQUEST_SIGNATURE_DOMAIN = "fanum-voice-attempt-request-v1"
const ATTEMPT_RESPONSE_SIGNATURE_DOMAIN = "fanum-voice-attempt-response-v1"
const ATTEMPT_SIGNATURE_PATTERN = /^v1=([0-9a-f]{64})$/
const MAX_CONTROL_RESPONSE_BYTES = 32_768
const TERMINAL_OUTCOMES = new Set<AsteriskTerminalOutcome>([
  "connected",
  "no_answer",
  "busy",
  "failed",
  "cancelled",
])

type AttemptRegistryPayload = {
  protocol?: unknown
  callId?: unknown
  state?: unknown
  outcome?: unknown
  revision?: unknown
  updatedAt?: unknown
}

export class AsteriskProvider implements VoipProvider {
  private baseUrl: string
  private auth: string
  private context: string
  private callerExtension: string
  private registryCapabilityEnabled: boolean
  private dispatchPaused: boolean
  private organizationId: string

  constructor(settings: AsteriskSettings) {
    const port = settings.ariPort || 8088
    this.baseUrl = `http://${settings.ariHost}:${port}/ari`
    this.auth = Buffer.from(`${settings.username}:${settings.password}`).toString("base64")
    this.context = settings.context || "from-internal"
    this.callerExtension = settings.callerExtension
    this.registryCapabilityEnabled = settings.voiceAttemptRegistryEnabled === true
    this.dispatchPaused = settings.outboundCallDispatchPaused === true
    this.organizationId = settings.organizationId?.trim() || ""
  }

  getProviderName(): string {
    return "asterisk"
  }

  private attemptRegistryEnabled(): boolean {
    return this.registryCapabilityEnabled
      && this.registryTenantEligible()
      && process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED === "true"
  }

  private registryTenantEligible(): boolean {
    const pilotOrganizationId = process.env.VOICE_AGENT_ORGANIZATION_ID?.trim() || ""
    return Boolean(
      pilotOrganizationId
      && this.organizationId
      && pilotOrganizationId === this.organizationId,
    )
  }

  private secureTransportEnabled(): boolean {
    // Once the row is opted into the pinned control plane, rolling back only
    // the registry-semantics gate must never expose Basic credentials over
    // plaintext. The global flag can select legacy originate semantics, but
    // disabling TLS requires first removing this per-config capability.
    return this.registryCapabilityEnabled
  }

  private secureControlUrl(url: string): URL {
    const secureUrl = new URL(url)
    if (secureUrl.protocol !== "http:" && secureUrl.protocol !== "https:") {
      throw new TypeError("Asterisk control URL protocol is invalid")
    }
    secureUrl.protocol = "https:"
    return secureUrl
  }

  private secureControlFetch(url: string, init: RequestInit): Promise<Response> {
    return secureFanumPbxControlFetch(this.secureControlUrl(url), {
      ...init,
      redirect: "error",
    })
  }

  private providerControlFetch(url: string, init: RequestInit): Promise<Response> {
    return this.secureTransportEnabled()
      ? this.secureControlFetch(url, init)
      : requestVoipEndpoint(url, init, {
          timeoutMs: ORIGINATE_TIMEOUT_MS,
          maxResponseBytes: MAX_CONTROL_RESPONSE_BYTES,
        })
  }

  private authorizationHeaders(json = false): Record<string, string> {
    return {
      Authorization: `Basic ${this.auth}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    }
  }

  private registryHmacKey(): Buffer | null {
    if (!this.registryTenantEligible()) return null
    const token = process.env.FANUM_VOICE_RUNTIME_TOKEN || ""
    const encodedToken = Buffer.from(token, "utf8")
    if (
      encodedToken.length < 16
      || encodedToken.length > 4_096
      || encodedToken.some((byte) => byte < 0x21 || byte === 0x7f)
    ) return null
    return encodedToken
  }

  private sha256Hex(body: string | Uint8Array): string {
    return typeof body === "string"
      ? createHash("sha256").update(body, "utf8").digest("hex")
      : createHash("sha256").update(body).digest("hex")
  }

  private requestSignature(
    key: Buffer,
    method: string,
    pathname: string,
    body: string,
  ): string {
    const message = [
      ATTEMPT_REQUEST_SIGNATURE_DOMAIN,
      method.toUpperCase(),
      pathname,
      this.sha256Hex(body),
    ].join("\n")
    return `v1=${createHmac("sha256", key).update(message, "utf8").digest("hex")}`
  }

  private registryHeaders(params: {
    key: Buffer
    method: string
    pathname: string
    body: string
    json?: boolean
  }): Record<string, string> {
    return {
      ...this.authorizationHeaders(params.json),
      [ATTEMPT_SIGNATURE_HEADER]: this.requestSignature(
        params.key,
        params.method,
        params.pathname,
        params.body,
      ),
    }
  }

  private verifyResponseSignature(params: {
    key: Buffer
    method: string
    pathname: string
    status: number
    body: Uint8Array
    signature: string | null
  }): boolean {
    const match = params.signature?.match(ATTEMPT_SIGNATURE_PATTERN)
    if (!match) return false
    const message = [
      ATTEMPT_RESPONSE_SIGNATURE_DOMAIN,
      params.method.toUpperCase(),
      params.pathname,
      String(params.status),
      this.sha256Hex(params.body),
    ].join("\n")
    const expected = createHmac("sha256", params.key).update(message, "utf8").digest()
    const received = Buffer.from(match[1], "hex")
    return received.length === expected.length && timingSafeEqual(received, expected)
  }

  private async boundedBody(response: Response): Promise<Uint8Array | null> {
    const declaredLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTROL_RESPONSE_BYTES) return null
    if (!response.body) return new Uint8Array()

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total > MAX_CONTROL_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined)
          return null
        }
        chunks.push(value)
      }
    } catch {
      await reader.cancel().catch(() => undefined)
      return null
    }
    const body = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return body
  }

  private parseJsonObject(text: string): Record<string, unknown> | null {
    try {
      const value = JSON.parse(text) as unknown
      return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
    } catch {
      return null
    }
  }

  private async boundedJson(response: Response): Promise<Record<string, unknown> | null> {
    const body = await this.boundedBody(response)
    if (!body || body.byteLength === 0) return null
    try {
      return this.parseJsonObject(new TextDecoder("utf-8", { fatal: true }).decode(body))
    } catch {
      return null
    }
  }

  /**
   * Prove that the authenticated origin is the configured ARI service before
   * trusting its custom attempt registry. A typed registry record is still
   * required afterwards, so a gateway-generated 404 can never release a
   * dispatch fence.
   */
  private async proveAriIdentity(): Promise<boolean> {
    try {
      const response = await this.secureControlFetch(`${this.baseUrl}/asterisk/info`, {
        method: "GET",
        signal: AbortSignal.timeout(ORIGINATE_TIMEOUT_MS),
        headers: this.authorizationHeaders(),
      })
      if (!response.ok) return false
      const contentType = response.headers.get("content-type")?.toLowerCase() || ""
      if (!contentType.includes("application/json")) return false
      const info = await this.boundedJson(response)
      const system = info?.system
      const build = info?.build
      return Boolean(
        system
        && typeof system === "object"
        && !Array.isArray(system)
        && typeof (system as Record<string, unknown>).version === "string"
        && String((system as Record<string, unknown>).version).trim()
        && build
        && typeof build === "object"
        && !Array.isArray(build),
      )
    } catch {
      return false
    }
  }

  private async parseAttemptFinality(
    response: Response,
    expectedCallId: string,
    request: { key: Buffer; method: string; pathname: string },
  ): Promise<CallFinalityResult> {
    const rawBody = await this.boundedBody(response)
    if (rawBody === null) return { state: "unknown" }
    if (!this.verifyResponseSignature({
      ...request,
      status: response.status,
      body: rawBody,
      signature: response.headers.get(ATTEMPT_SIGNATURE_HEADER),
    })) return { state: "unknown" }
    if (!response.ok) return { state: "unknown" }
    const contentType = response.headers.get("content-type")?.toLowerCase() || ""
    if (!contentType.includes("application/json")) return { state: "unknown" }
    let decodedBody: string
    try {
      decodedBody = new TextDecoder("utf-8", { fatal: true }).decode(rawBody)
    } catch {
      return { state: "unknown" }
    }
    const payload = this.parseJsonObject(decodedBody) as AttemptRegistryPayload | null
    if (
      !payload
      || payload.protocol !== ATTEMPT_PROTOCOL
      || payload.callId !== expectedCallId
      || !Number.isInteger(payload.revision)
      || Number(payload.revision) < 1
      || typeof payload.updatedAt !== "string"
      || !RFC3339_PATTERN.test(payload.updatedAt)
      || !Number.isFinite(Date.parse(payload.updatedAt))
    ) return { state: "unknown" }

    const proof = { revision: Number(payload.revision), updatedAt: payload.updatedAt }
    if (payload.state === "not_accepted") return { state: "not_accepted", ...proof }
    if (payload.state === "accepted" || payload.state === "active") {
      return { state: payload.state, ...proof }
    }
    if (
      payload.state === "terminal"
      && typeof payload.outcome === "string"
      && TERMINAL_OUTCOMES.has(payload.outcome as AsteriskTerminalOutcome)
    ) {
      return {
        state: "terminal",
        outcome: payload.outcome as AsteriskTerminalOutcome,
        ...proof,
      }
    }
    return { state: "unknown" }
  }

  /**
   * Ask the registry about ONE attempt id and accept only a signed "I have no
   * such attempt" as an answer.
   *
   * With no argument this is a health probe on an id nobody ever dialled. With
   * one, it is a proof about a real call — and the difference matters, because
   * the registry writes its row BEFORE the dialplan gate can dial. A signed 404
   * for a specific id therefore means that call was never placed, which is the
   * one thing that turns "we do not know" into "it did not happen".
   */
  private async proveSignedMissingAttempt(callIdToProve?: string): Promise<boolean> {
    const hmacKey = this.registryHmacKey()
    if (!hmacKey) return false
    const callId = callIdToProve ?? randomUUID()
    if (!UUID_PATTERN.test(callId)) return false
    const pathname = this.attemptPath(callId)
    try {
      const response = await this.secureControlFetch(this.attemptUrl(callId), {
        method: "GET",
        signal: AbortSignal.timeout(ORIGINATE_TIMEOUT_MS),
        headers: this.registryHeaders({
          key: hmacKey,
          method: "GET",
          pathname,
          body: "",
        }),
      })
      const rawBody = await this.boundedBody(response)
      if (rawBody === null || response.status !== 404) return false
      if (!this.verifyResponseSignature({
        key: hmacKey,
        method: "GET",
        pathname,
        status: response.status,
        body: rawBody,
        signature: response.headers.get(ATTEMPT_SIGNATURE_HEADER),
      })) return false
      let payload: Record<string, unknown> | null = null
      try {
        payload = this.parseJsonObject(new TextDecoder("utf-8", { fatal: true }).decode(rawBody))
      } catch {
        return false
      }
      return payload?.protocol === ATTEMPT_PROTOCOL
        && payload.callId === callId
        && payload.error === "attempt_not_found"
        && Object.keys(payload).length === 3
    } catch {
      return false
    }
  }

  private attemptPath(callId: string): string {
    return `/ari/fanum/voice-attempts/${encodeURIComponent(callId)}`
  }

  private attemptUrl(callId: string): string {
    return `${this.baseUrl}/fanum/voice-attempts/${encodeURIComponent(callId)}`
  }

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    if (
      this.dispatchPaused
      || isOutboundVoiceDispatchPaused(this.organizationId)
    ) {
      return {
        success: false,
        error: "Outbound voice dispatch is paused for maintenance",
        failureCertainty: "definite_rejection",
      }
    }
    if (this.registryCapabilityEnabled && !this.registryTenantEligible()) {
      return {
        success: false,
        error: "Asterisk secure control tenant is not eligible",
        failureCertainty: "definite_rejection",
      }
    }
    if (
      this.registryCapabilityEnabled
      && process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED !== "true"
    ) {
      return {
        success: false,
        error: "Asterisk voice-attempt registry is not active",
        failureCertainty: "definite_rejection",
      }
    }
    if (
      !this.registryCapabilityEnabled
      && this.registryTenantEligible()
      && process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED === "true"
    ) {
      return {
        success: false,
        error: "Asterisk voice-attempt registry capability is not active",
        failureCertainty: "definite_rejection",
      }
    }
    try {
      // AudioSocket and the ordinary-call PBX lifecycle observer share one
      // UUID correlation contract. The caller can pre-generate it and persist
      // it before ARI dispatch, so even an immediate PBX callback resolves one
      // exact CallLog without phone-number or timing guesses.
      const suppliedCorrelationId = params.correlationId?.trim()
      if (suppliedCorrelationId && !UUID_PATTERN.test(suppliedCorrelationId)) {
        return {
          success: false,
          error: "Invalid Asterisk call correlation id.",
          failureCertainty: "definite_rejection",
        }
      }
      const channelId = suppliedCorrelationId || randomUUID()
      // Route the destination through the configured dialplan instead of
      // assuming chan_sip. Modern PBXs commonly expose only a PJSIP trunk, and
      // the dialplan is the source of truth for selecting that trunk.
      // `/n` keeps the Local channel in the path so the returned channel id can
      // still be used to hang up and correlate the call after answer.
      // A normal click-to-call sends the answered Local channel to the agent's
      // configured extension. An explicit AI call sends that same answered
      // channel to the PBX-local AudioSocket bridge instead. The outbound leg
      // still uses the tenant's configured dialplan context in both cases, so
      // trunk selection remains entirely inside Asterisk.
      // Three destinations for one answered call, and the PBX decides none of
      // them: the AI bridge, the browser bridge, or a second phone. The browser
      // bridge has the same shape as the AI one — a PBX-local AudioSocket on
      // its own port — so the live AI path is not touched to add it.
      const answeredContext = params.voiceAgent
        ? "fanum-ai-bridge"
        : params.browserAudio
          ? "fanum-human-bridge"
          : this.context
      // A manual call must reach the person who pressed the button. The
      // organisation-wide extension stays the fallback, which is what every
      // click-to-call used to ring regardless of who made it.
      const answeredExtension = params.voiceAgent || params.browserAudio
        ? "s"
        : (params.agentNumber || this.callerExtension)
      if (this.attemptRegistryEnabled()) {
        const hmacKey = this.registryHmacKey()
        if (!hmacKey) {
          return {
            success: false,
            error: "Asterisk voice-attempt delivery is uncertain.",
            failureCertainty: "unknown_delivery",
          }
        }
        // Both AI and human dispatch go through the PBX-owned durable attempt
        // registry after the coordinated cutover. The PBX dialplan gate then
        // has a durable UUID row before either mode can dial.
        if (!await this.proveAriIdentity()) {
          return {
            success: false,
            error: "Asterisk ARI identity could not be verified.",
            failureCertainty: "definite_rejection",
          }
        }
        const pathname = this.attemptPath(channelId)
        const body = JSON.stringify({
          endpoint: `Local/${params.toNumber}@${this.context}/n`,
          extension: answeredExtension,
          context: answeredContext,
          callerId: params.fromNumber || this.callerExtension,
          variables: {
            __FANUM_CALL_ID: channelId,
            // A browser call is a human call: a person is on it. The gate on
            // the PBX accepts human|ai and nothing else, and the answered
            // destination was already named in `context`.
            __FANUM_CALL_MODE: params.voiceAgent ? "ai" : "human",
            // These TWO variables and no third one.
            //
            // The station's attempt registry does not ignore what it does not
            // know: it compares the variable names it received against an exact
            // set and answers `invalid_variables` to anything else. A third key
            // is therefore not "a flag the PBX will skip", it is a rejected
            // request — and because a rejection at this stage cannot prove the
            // call was not placed, CRM must record the attempt as uncertain and
            // refuse to redial. Every AI and browser call fails, and the
            // salesperson is told the provider is unavailable.
            //
            // That is exactly what shipping `__FANUM_RECORD` here did, from the
            // deploy on 2026-08-26 07:44 UTC until this fix: the first call
            // after it went out died at 08:13 with the registry holding no row
            // at all. The recording flag still travels on the direct-ARI path
            // below, which has no such contract; carrying it over THIS path
            // needs the station to accept and forward it first.
          },
        })
        const response = await this.secureControlFetch(this.attemptUrl(channelId), {
          method: "PUT",
          signal: AbortSignal.timeout(ORIGINATE_RING_TIMEOUT_MS),
          headers: this.registryHeaders({
            key: hmacKey,
            method: "PUT",
            pathname,
            body,
            json: true,
          }),
          body,
        })
        const finality = await this.parseAttemptFinality(response, channelId, {
          key: hmacKey,
          method: "PUT",
          pathname,
        })
        if (finality.state === "not_accepted") {
          return {
            success: false,
            error: "Asterisk did not accept the voice attempt.",
            failureCertainty: "definite_rejection",
          }
        }
        if (
          finality.state === "accepted"
          || finality.state === "active"
          || finality.state === "terminal"
        ) {
          return { success: true, callSid: channelId }
        }
        // Before calling it uncertain, ask whether it happened at all.
        //
        // "Uncertain" is not a free position to take. The route keeps the
        // active fences and the lease so an operator can reconcile, but the row
        // it writes has no `endedAt` and no block reason, so the stale-dispatch
        // reaper skips it and the operator's own resolve endpoint cannot match
        // it either. Nothing releases `activeOrganizationKey`, and every lead
        // in the tenant answers "a call is already queued" — permanently. That
        // is what one rejected request did on 2026-08-26.
        //
        // The registry records its row before the gate can dial, so a signed
        // 404 for THIS id is proof the customer's phone never rang. Proof is
        // what the definite-rejection path is for: it finishes the session and
        // releases the fences. Anything less certain still stays uncertain.
        if (await this.proveSignedMissingAttempt(channelId)) {
          return {
            success: false,
            error: "Asterisk never registered the voice attempt.",
            failureCertainty: "definite_rejection",
          }
        }
        return {
          success: false,
          error: "Asterisk voice-attempt delivery is uncertain.",
          failureCertainty: "unknown_delivery",
        }
      }
      const query = new URLSearchParams({
        endpoint: `Local/${params.toNumber}@${this.context}/n`,
        extension: answeredExtension,
        context: answeredContext,
        callerId: params.fromNumber || this.callerExtension,
        channelId,
      })
      const url = `${this.baseUrl}/channels?${query.toString()}`

      const res = await this.providerControlFetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(ORIGINATE_TIMEOUT_MS),
        headers: {
          Authorization: `Basic ${this.auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          variables: {
            __FANUM_CALL_ID: channelId,
            // A browser call is a human call: a person is on it. The gate on
            // the PBX accepts human|ai and nothing else, and the answered
            // destination was already named in `context`.
            __FANUM_CALL_MODE: params.voiceAgent ? "ai" : "human",
            // Whether this organisation asked for its calls to be recorded.
            //
            // The setting has existed in the VoIP screen from the beginning and
            // this adapter ignored it: only the Twilio one ever read `record`,
            // and this deployment is Asterisk. Measured on the station on
            // 2026-08-25 — zero MixMonitor in the dialplan, an empty recordings
            // directory untouched since April 2024, not one file. A switch that
            // does nothing is worse than an absent feature: it is believed.
            //
            // "1" or "0" and nothing else. The station filters this to those
            // two characters before acting on it, so a value it cannot read is
            // read as "do not record" rather than as an error.
            __FANUM_RECORD: params.record ? "1" : "0",
          },
        }),
      })

      if (res.ok) {
        // The UUID supplied as channelId is the correlation authority. Do not
        // replace it with any response-side leg id: Local/PJSIP legs may have
        // different identifiers while inheriting FANUM_CALL_ID.
        await res.json().catch(() => ({}))
        return {
          success: true,
          callSid: channelId,
        }
      }

      return {
        success: false,
        // The endpoint is tenant-controlled. Reflecting its body would turn
        // status handling into an internal response oracle.
        error: `Asterisk ARI error (${res.status}).`,
        // Only deterministic client errors prove that ARI did not accept the
        // originate. A timeout-like response, conflict, rate limit, redirect,
        // or server error can arrive after receipt/partial side effects, so it
        // must retain the no-redial fence for reconciliation.
        failureCertainty: DEFINITE_ORIGINATE_REJECTION_STATUSES.has(res.status)
          ? "definite_rejection"
          : "unknown_delivery",
      }
    } catch (e) {
      return {
        success: false,
        error: `Asterisk connection failed: ${(e as Error).message}`,
        failureCertainty: "unknown_delivery",
      }
    }
  }

  async endCall(callSid: string): Promise<{ success: boolean; error?: string }> {
    try {
      const url = `${this.baseUrl}/channels/${callSid}`
      const res = await this.providerControlFetch(url, {
        method: "DELETE",
        signal: AbortSignal.timeout(ORIGINATE_TIMEOUT_MS),
        headers: { Authorization: `Basic ${this.auth}` },
      })

      if (res.ok || res.status === 404) {
        return { success: true }
      }
      return { success: false, error: `Failed to hang up channel (${res.status})` }
    } catch (e) {
      return { success: false, error: `Asterisk connection failed: ${(e as Error).message}` }
    }
  }

  /** Read-only diagnostics only. ARI channel absence is never finality. */
  async inspectCallActivity(callSid: string): Promise<CallActivityResult> {
    try {
      const url = `${this.baseUrl}/channels/${encodeURIComponent(callSid)}`
      const res = await this.providerControlFetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(ORIGINATE_TIMEOUT_MS),
        headers: { Authorization: `Basic ${this.auth}` },
      })
      if (res.ok) return { state: "active" }
      return { state: "unknown" }
    } catch {
      return { state: "unknown" }
    }
  }

  async inspectCallFinality(callSid: string): Promise<CallFinalityResult> {
    if (!this.attemptRegistryEnabled()) return { state: "unknown" }
    if (!UUID_PATTERN.test(callSid)) return { state: "unknown" }
    const hmacKey = this.registryHmacKey()
    if (!hmacKey) return { state: "unknown" }
    if (!await this.proveAriIdentity()) return { state: "unknown" }
    try {
      const pathname = this.attemptPath(callSid)
      const response = await this.secureControlFetch(this.attemptUrl(callSid), {
        method: "GET",
        signal: AbortSignal.timeout(ORIGINATE_TIMEOUT_MS),
        headers: this.registryHeaders({
          key: hmacKey,
          method: "GET",
          pathname,
          body: "",
        }),
      })
      return this.parseAttemptFinality(response, callSid, {
        key: hmacKey,
        method: "GET",
        pathname,
      })
    } catch {
      return { state: "unknown" }
    }
  }

  async cancelAndInspectCallFinality(callSid: string): Promise<CallFinalityResult> {
    if (!this.attemptRegistryEnabled()) return { state: "unknown" }
    if (!UUID_PATTERN.test(callSid)) return { state: "unknown" }
    const hmacKey = this.registryHmacKey()
    if (!hmacKey) return { state: "unknown" }
    if (!await this.proveAriIdentity()) return { state: "unknown" }
    try {
      const pathname = `${this.attemptPath(callSid)}/cancel`
      const response = await this.secureControlFetch(`${this.attemptUrl(callSid)}/cancel`, {
        method: "POST",
        signal: AbortSignal.timeout(ORIGINATE_TIMEOUT_MS),
        // The PBX contract deliberately requires an empty cancel body. This
        // makes proxy/body transformations unable to alter cancellation data.
        headers: this.registryHeaders({
          key: hmacKey,
          method: "POST",
          pathname,
          body: "",
        }),
      })
      return this.parseAttemptFinality(response, callSid, {
        key: hmacKey,
        method: "POST",
        pathname,
      })
    } catch {
      return { state: "unknown" }
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (this.registryCapabilityEnabled) {
      if (!this.registryTenantEligible()) {
        return { success: false, message: "Asterisk secure control tenant is not eligible." }
      }
      if (!await this.proveAriIdentity()) {
        return { success: false, message: "Cannot verify the pinned Asterisk ARI identity." }
      }
      if (!await this.proveSignedMissingAttempt()) {
        return { success: false, message: "Cannot verify the signed PBX attempt registry." }
      }
      return { success: true, message: "Asterisk pinned control plane verified." }
    }
    try {
      const url = `${this.baseUrl}/asterisk/info`
      const res = await this.providerControlFetch(url, {
        signal: AbortSignal.timeout(ORIGINATE_TIMEOUT_MS),
        headers: { Authorization: `Basic ${this.auth}` },
      })

      if (res.ok) {
        const info = await res.json().catch(() => ({}))
        const version = info.system?.version || "unknown"
        return { success: true, message: `Asterisk connected (version ${version}).` }
      }
      if (res.status === 401) {
        return { success: false, message: "Invalid Asterisk ARI credentials." }
      }
      return { success: false, message: `Asterisk ARI returned status ${res.status}.` }
    } catch (e) {
      return { success: false, message: `Cannot reach Asterisk ARI: ${(e as Error).message}` }
    }
  }

  parseWebhook(body: Record<string, unknown>): WebhookData | null {
    // ARI Stasis events
    const channel = body.channel as Record<string, unknown> | undefined
    if (!channel) return null

    const id = channel.id as string
    if (!id) return null

    const stateMap: Record<string, string> = {
      Down: "initiated",
      Rsrvd: "initiated",
      Ring: "ringing",
      Up: "in-progress",
      Busy: "busy",
    }

    return {
      callSid: id,
      status: stateMap[(channel.state as string)] || "unknown",
      from: (channel.caller as Record<string, unknown>)?.number as string | undefined,
      to: (channel.dialplan as Record<string, unknown>)?.exten as string | undefined,
    }
  }
}
