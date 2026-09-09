import { lookup as dnsLookup } from "node:dns/promises"
import {
  request as httpRequest,
  type IncomingMessage,
  type RequestOptions as HttpRequestOptions,
} from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"

import {
  OutboundWebhookSecurityError,
  validateOutboundWebhookUrl,
  type OutboundWebhookResolver,
  type ResolvedWebhookAddress,
} from "@/lib/integrations/webhook-url-guard"
import type { VoipSettings } from "./types"

const PRIVATE_ALLOWLIST_ENV = "VOIP_PRIVATE_ENDPOINT_ALLOWLIST"
const MAX_ALLOWLIST_BYTES = 8_192
const MAX_ALLOWLIST_ENTRIES = 64
const MAX_DNS_RESULTS = 32
const MAX_CONNECTION_CANDIDATES = 8
const DEFAULT_DNS_TIMEOUT_MS = 3_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1_024
const HARD_MAX_RESPONSE_BYTES = 256 * 1_024
const HARD_MAX_REQUEST_BYTES = 1_024 * 1_024
const DEFAULT_MAX_REDIRECTS = 2
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
const FORBIDDEN_HEADERS = new Set([
  "host",
  "connection",
  "transfer-encoding",
  "upgrade",
  "keep-alive",
  "te",
  "trailer",
])
const ALWAYS_BLOCKED_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.internal",
  "instance-data",
])
const ALWAYS_BLOCKED_ADDRESSES = new Set([
  "169.254.169.254",
  "169.254.170.2",
  "100.100.100.200",
])

export class VoipEndpointSecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VoipEndpointSecurityError"
  }
}

export interface ValidatedVoipEndpoint {
  url: URL
  addresses: readonly ResolvedWebhookAddress[]
  privateOriginAllowlisted: boolean
}

export interface VoipEndpointTransportRequest {
  method: string
  headers: Record<string, string>
  body?: string | Uint8Array
  timeoutMs: number
  maxResponseBytes: number
  signal?: AbortSignal | null
}

export interface VoipEndpointTransportResponse {
  status: number
  headers?: Record<string, string>
  body?: Uint8Array
}

export type VoipEndpointTransport = (
  target: ValidatedVoipEndpoint,
  request: VoipEndpointTransportRequest,
) => Promise<VoipEndpointTransportResponse>

export interface VoipEndpointValidationOptions {
  resolver?: OutboundWebhookResolver
  dnsTimeoutMs?: number
  privateOrigins?: readonly string[]
}

export interface VoipEndpointRequestOptions extends VoipEndpointValidationOptions {
  timeoutMs?: number
  maxResponseBytes?: number
  maxRedirects?: number
  transport?: VoipEndpointTransport
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function normalizeHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname
}

function parseHttpUrl(rawUrl: string | URL): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new VoipEndpointSecurityError("Invalid VoIP endpoint URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new VoipEndpointSecurityError("VoIP endpoint must use HTTP or HTTPS")
  }
  if (url.username || url.password) {
    throw new VoipEndpointSecurityError("VoIP endpoint must not contain embedded credentials")
  }
  if (url.hash) {
    throw new VoipEndpointSecurityError("VoIP endpoint must not contain a fragment")
  }
  const hostname = normalizeHostname(url)
  if (!hostname || ALWAYS_BLOCKED_HOSTS.has(hostname)) {
    throw new VoipEndpointSecurityError("VoIP endpoint references a forbidden host")
  }
  return url
}

function canonicalPrivateOrigin(rawOrigin: string): string {
  const url = parseHttpUrl(rawOrigin.trim())
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new VoipEndpointSecurityError(
      `${PRIVATE_ALLOWLIST_ENV} entries must be exact origins without a path, query, or fragment`,
    )
  }
  return url.origin
}

function configuredPrivateOrigins(raw = process.env[PRIVATE_ALLOWLIST_ENV] || ""): Set<string> {
  if (Buffer.byteLength(raw, "utf8") > MAX_ALLOWLIST_BYTES) {
    throw new VoipEndpointSecurityError(`${PRIVATE_ALLOWLIST_ENV} is too large`)
  }
  const entries = raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (entries.length > MAX_ALLOWLIST_ENTRIES) {
    throw new VoipEndpointSecurityError(`${PRIVATE_ALLOWLIST_ENV} has too many entries`)
  }
  const origins = new Set<string>()
  for (const entry of entries) {
    if (entry.includes("*")) {
      throw new VoipEndpointSecurityError(`${PRIVATE_ALLOWLIST_ENV} does not support wildcards`)
    }
    origins.add(canonicalPrivateOrigin(entry))
  }
  return origins
}

function privateOriginSet(options: VoipEndpointValidationOptions): Set<string> {
  if (options.privateOrigins === undefined) return configuredPrivateOrigins()
  if (options.privateOrigins.length > MAX_ALLOWLIST_ENTRIES) {
    throw new VoipEndpointSecurityError("VoIP private endpoint allowlist has too many entries")
  }
  return new Set(options.privateOrigins.map(canonicalPrivateOrigin))
}

async function systemResolver(hostname: string): Promise<readonly ResolvedWebhookAddress[]> {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true })
  return answers.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function validateExplicitlyAllowedAddress(
  address: string,
  expectedFamily?: 4 | 6,
): ResolvedWebhookAddress {
  const family = isIP(address)
  if ((family !== 4 && family !== 6) || (expectedFamily !== undefined && family !== expectedFamily)) {
    throw new VoipEndpointSecurityError("VoIP endpoint returned an invalid DNS address")
  }
  const normalized = address.toLowerCase()
  if (
    ALWAYS_BLOCKED_ADDRESSES.has(normalized)
    || normalized.startsWith("::ffff:")
    || normalized === "0.0.0.0"
    || normalized === "::"
  ) {
    throw new VoipEndpointSecurityError("VoIP endpoint resolved to a forbidden infrastructure address")
  }
  return { address, family }
}

async function resolveExplicitlyAllowedOrigin(
  url: URL,
  options: VoipEndpointValidationOptions,
): Promise<readonly ResolvedWebhookAddress[]> {
  const hostname = normalizeHostname(url)
  const literalFamily = isIP(hostname)
  if (literalFamily === 4 || literalFamily === 6) {
    return [validateExplicitlyAllowedAddress(hostname, literalFamily)]
  }
  const timeoutMs = boundedInteger(
    options.dnsTimeoutMs,
    DEFAULT_DNS_TIMEOUT_MS,
    1,
    DEFAULT_REQUEST_TIMEOUT_MS,
  )
  let answers: readonly ResolvedWebhookAddress[]
  try {
    answers = await withTimeout(
      (options.resolver ?? systemResolver)(hostname),
      timeoutMs,
      "VoIP endpoint DNS lookup timed out",
    )
  } catch (error) {
    if (error instanceof Error && error.message === "VoIP endpoint DNS lookup timed out") throw error
    throw new Error("VoIP endpoint hostname could not be resolved")
  }
  if (answers.length === 0) throw new Error("VoIP endpoint hostname did not resolve")
  if (answers.length > MAX_DNS_RESULTS) {
    throw new VoipEndpointSecurityError("VoIP endpoint returned too many DNS addresses")
  }
  const unique = new Map<string, ResolvedWebhookAddress>()
  for (const answer of answers) {
    const validated = validateExplicitlyAllowedAddress(answer.address, answer.family)
    unique.set(`${validated.family}:${validated.address}`, validated)
  }
  return [...unique.values()]
}

/**
 * Resolve one tenant-configured PBX endpoint.
 *
 * Public endpoints are delegated to the generic webhook guard and therefore
 * require HTTPS plus exclusively public A/AAAA answers. Private/on-prem
 * endpoints are accepted only when their exact scheme+host+port origin is in
 * VOIP_PRIVATE_ENDPOINT_ALLOWLIST. Every returned address is later pinned into
 * the socket lookup, so DNS cannot change between validation and connection.
 */
export async function validateVoipEndpoint(
  rawUrl: string | URL,
  options: VoipEndpointValidationOptions = {},
): Promise<ValidatedVoipEndpoint> {
  const url = parseHttpUrl(rawUrl)
  const allowlistedOrigins = privateOriginSet(options)
  const privateOriginAllowlisted = allowlistedOrigins.has(url.origin)

  if (privateOriginAllowlisted) {
    const addresses = await resolveExplicitlyAllowedOrigin(url, options)
    return { url, addresses, privateOriginAllowlisted: true }
  }
  if (url.protocol !== "https:") {
    throw new VoipEndpointSecurityError(
      `HTTP VoIP endpoints require an exact ${PRIVATE_ALLOWLIST_ENV} origin`,
    )
  }
  try {
    const validated = await validateOutboundWebhookUrl(url.toString(), {
      allowHttp: false,
      dnsTimeoutMs: options.dnsTimeoutMs,
      resolver: options.resolver,
    })
    return {
      url: validated.url,
      addresses: validated.addresses,
      privateOriginAllowlisted: false,
    }
  } catch (error) {
    if (error instanceof OutboundWebhookSecurityError) {
      throw new VoipEndpointSecurityError(error.message.replace(/^Webhook /, "VoIP endpoint "))
    }
    throw error
  }
}

function hostUrl(host: string, port: number, protocol: "http:" | "https:"): URL {
  const trimmed = host.trim()
  if (!trimmed || /[\s\\/@?#]/.test(trimmed)) {
    throw new VoipEndpointSecurityError("VoIP host must be a hostname or IP address")
  }
  const bracketedHost = trimmed.includes(":") && !trimmed.startsWith("[")
    ? `[${trimmed}]`
    : trimmed
  try {
    return new URL(`${protocol}//${bracketedHost}:${port}/`)
  } catch {
    throw new VoipEndpointSecurityError("VoIP host must be a valid hostname or IP address")
  }
}

/**
 * The endpoint a save would actually probe, as a comparable descriptor.
 *
 * Kept deliberately next to validateVoipSettingsEndpoint below, and required to
 * stay in lockstep with it: `null` in exactly the cases that function returns
 * without probing, and naming every field it reads.
 *
 * The write path compares an incoming save against the stored row so that a
 * prompt, a toggle or a phone number can be edited without re-running a network
 * policy check on an endpoint nobody touched. That mattered in production: a
 * legacy Asterisk origin outside VOIP_PRIVATE_ENDPOINT_ALLOWLIST failed the
 * whole PUT, so every AI-prompt edit was silently discarded for weeks while the
 * agent kept answering from the last prompt that had managed to save. The gate
 * itself is unchanged - a new or edited endpoint is still validated before it
 * is persisted, and the runtime independently validates and pins every address
 * it dials, so what the server may reach is not decided here.
 */
export function voipEndpointFingerprint(
  settings: VoipSettings | Record<string, unknown>,
): string | null {
  const record = settings as unknown as Record<string, unknown>
  const provider = typeof record.provider === "string" ? record.provider : ""
  const text = (key: string): string => (
    typeof record[key] === "string" ? (record[key] as string).trim() : ""
  )
  if (provider === "threecx") {
    const serverUrl = text("serverUrl")
    return serverUrl ? `threecx|${serverUrl}` : null
  }
  if (provider === "asterisk") {
    const host = text("ariHost")
    return host ? `asterisk|${host}|${Number(record.ariPort) || 8088}` : null
  }
  if (provider === "custom-sip") {
    const host = text("sipServer")
    const transport = text("transport")
    // UDP/TCP rows are still parsed for a malformed host at write time, so they
    // report no fingerprint and keep taking the full check on every save.
    if (!host || (transport !== "wss" && transport !== "tls")) return null
    return `custom-sip|${host}|${Number(record.sipPort) || 5060}|${transport}`
  }
  return null
}

/** Validate the tenant-controlled endpoint before a VoIP config is persisted. */
export async function validateVoipSettingsEndpoint(
  settings: VoipSettings | Record<string, unknown>,
  options: VoipEndpointValidationOptions = {},
): Promise<void> {
  const record = settings as unknown as Record<string, unknown>
  const provider = typeof record.provider === "string" ? record.provider : ""
  if (provider === "threecx") {
    const rawServerUrl = typeof record.serverUrl === "string" ? record.serverUrl.trim() : ""
    if (!rawServerUrl) return
    const url = parseHttpUrl(rawServerUrl)
    if (url.pathname !== "/" || url.search || url.hash) {
      throw new VoipEndpointSecurityError("3CX server URL must be an origin without a path or query")
    }
    await validateVoipEndpoint(url, options)
    return
  }
  if (provider === "asterisk") {
    const host = typeof record.ariHost === "string" ? record.ariHost : ""
    if (!host.trim()) return
    const port = Number(record.ariPort) || 8088
    await validateVoipEndpoint(hostUrl(host, port, "http:"), options)
    return
  }
  if (provider === "custom-sip") {
    const host = typeof record.sipServer === "string" ? record.sipServer : ""
    if (!host.trim()) return
    const port = Number(record.sipPort) || 5060
    const endpoint = hostUrl(host, port, "https:")
    // UDP/TCP settings never trigger server-side network I/O. Still reject
    // malformed hosts at write time; WSS/TLS probes receive full DNS policy.
    if (record.transport === "wss" || record.transport === "tls") {
      await validateVoipEndpoint(endpoint, options)
    }
  }
}

function responseHeaders(response: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value
  }
  return headers
}

function requestOneAddress(
  target: ValidatedVoipEndpoint,
  address: ResolvedWebhookAddress,
  request: VoipEndpointTransportRequest,
): Promise<VoipEndpointTransportResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      request.signal?.removeEventListener("abort", onAbort)
    }
    const succeed = (value: VoipEndpointTransportResponse) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const pinnedLookup: NonNullable<HttpRequestOptions["lookup"]> = (
      _hostname,
      lookupOptions,
      callback,
    ) => {
      if (lookupOptions.all) {
        callback(null, [{ address: address.address, family: address.family }])
      } else {
        callback(null, address.address, address.family)
      }
    }
    const onResponse = (response: IncomingMessage) => {
      const status = response.statusCode ?? 0
      const headers = responseHeaders(response)
      if (
        status < 200
        || status >= 300
        || request.maxResponseBytes === 0
        || methodHasNoResponseBody(request.method)
      ) {
        // PBX error/redirect bodies are an SSRF oracle and are never required
        // for provider decisions. Retain only the bounded response headers.
        response.destroy()
        succeed({ status, headers })
        return
      }
      const chunks: Buffer[] = []
      let total = 0
      response.on("data", (chunk: Buffer | Uint8Array | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        total += bytes.byteLength
        if (total > request.maxResponseBytes) {
          const error = new VoipEndpointSecurityError("VoIP response exceeded the size limit")
          response.destroy(error)
          clientRequest.destroy(error)
          fail(error)
          return
        }
        chunks.push(bytes)
      })
      response.once("end", () => succeed({
        status,
        headers,
        body: new Uint8Array(Buffer.concat(chunks, total)),
      }))
      response.once("aborted", () => fail(new Error("VoIP response was aborted")))
      response.once("error", fail)
      response.once("close", () => {
        if (!response.complete) fail(new Error("VoIP response closed before completion"))
      })
    }
    const requestOptions: HttpRequestOptions = {
      method: request.method,
      headers: request.headers,
      family: address.family,
      lookup: pinnedLookup,
    }
    const clientRequest = target.url.protocol === "https:"
      ? httpsRequest(target.url, requestOptions, onResponse)
      : httpRequest(target.url, requestOptions, onResponse)
    const onAbort = () => clientRequest.destroy(new Error("VoIP request was aborted"))
    request.signal?.addEventListener("abort", onAbort, { once: true })
    if (request.signal?.aborted) onAbort()
    const timer = setTimeout(() => clientRequest.destroy(new Error("VoIP request timed out")), request.timeoutMs)
    timer.unref?.()
    clientRequest.setTimeout(request.timeoutMs, () => {
      clientRequest.destroy(new Error("VoIP request timed out"))
    })
    clientRequest.once("error", fail)
    if (request.body !== undefined) clientRequest.write(request.body)
    clientRequest.end()
  })
}

function methodHasNoResponseBody(method: string): boolean {
  return method === "HEAD"
}

const pinnedVoipTransport: VoipEndpointTransport = async (target, request) => {
  const deadline = Date.now() + request.timeoutMs
  let lastError: unknown
  for (const address of target.addresses.slice(0, MAX_CONNECTION_CANDIDATES)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error("VoIP request timed out")
    try {
      return await requestOneAddress(target, address, { ...request, timeoutMs: remaining })
    } catch (error) {
      if (error instanceof VoipEndpointSecurityError) throw error
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("VoIP request failed")
}

function requestBody(body: BodyInit | null | undefined): string | Uint8Array | undefined {
  if (body === undefined || body === null) return undefined
  if (typeof body === "string") return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  }
  throw new VoipEndpointSecurityError("VoIP request body type is not allowed")
}

function requestHeaders(init: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {}
  const normalized = new Headers(init.headers)
  normalized.forEach((value, name) => {
    const lower = name.toLowerCase()
    if (FORBIDDEN_HEADERS.has(lower) || lower.startsWith("proxy-") || lower.startsWith(":")) {
      throw new VoipEndpointSecurityError(`VoIP request header is not allowed: ${name}`)
    }
    headers[name] = value
  })
  return headers
}

function removeHeader(headers: Record<string, string>, name: string): void {
  for (const header of Object.keys(headers)) {
    if (header.toLowerCase() === name.toLowerCase()) delete headers[header]
  }
}

/**
 * SSRF-safe fetch subset for tenant-configured PBX control endpoints.
 * Responses preserve bounded 2xx bodies needed by provider APIs, while every
 * non-2xx body is discarded to prevent an internal response-body oracle.
 */
export async function requestVoipEndpoint(
  rawUrl: string | URL,
  init: RequestInit = {},
  options: VoipEndpointRequestOptions = {},
): Promise<Response> {
  let method = (init.method || "GET").toUpperCase()
  if (!ALLOWED_METHODS.has(method)) {
    throw new VoipEndpointSecurityError(`VoIP request method is not allowed: ${method}`)
  }
  let headers = requestHeaders(init)
  let body = requestBody(init.body)
  if ((method === "GET" || method === "HEAD") && body !== undefined) {
    throw new VoipEndpointSecurityError(`VoIP ${method} request must not include a body`)
  }
  const bodyBytes = body === undefined
    ? 0
    : typeof body === "string"
      ? Buffer.byteLength(body)
      : body.byteLength
  if (bodyBytes > HARD_MAX_REQUEST_BYTES) {
    throw new VoipEndpointSecurityError("VoIP request body exceeded the size limit")
  }
  removeHeader(headers, "content-length")
  if (body !== undefined) headers["content-length"] = String(bodyBytes)
  if (!Object.keys(headers).some((name) => name.toLowerCase() === "accept-encoding")) {
    // The low-level pinned transport intentionally does not perform implicit
    // decompression. Asking for identity keeps the retained 2xx byte bound
    // meaningful and avoids parser ambiguity.
    headers["accept-encoding"] = "identity"
  }

  const timeoutMs = boundedInteger(
    options.timeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    1,
    60_000,
  )
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    0,
    HARD_MAX_RESPONSE_BYTES,
  )
  const maxRedirects = boundedInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS, 0, 5)
  const transport = options.transport ?? pinnedVoipTransport
  const deadline = Date.now() + timeoutMs
  let currentUrl = String(rawUrl)
  let redirects = 0

  while (true) {
    const remainingBeforeDns = deadline - Date.now()
    if (remainingBeforeDns <= 0) throw new Error("VoIP request timed out")
    const target = await validateVoipEndpoint(currentUrl, {
      resolver: options.resolver,
      privateOrigins: options.privateOrigins,
      dnsTimeoutMs: Math.min(
        remainingBeforeDns,
        boundedInteger(options.dnsTimeoutMs, DEFAULT_DNS_TIMEOUT_MS, 1, DEFAULT_REQUEST_TIMEOUT_MS),
      ),
    })
    const remainingBeforeRequest = deadline - Date.now()
    if (remainingBeforeRequest <= 0) throw new Error("VoIP request timed out")
    const response = await transport(target, {
      method,
      headers,
      body,
      timeoutMs: remainingBeforeRequest,
      maxResponseBytes,
      signal: init.signal,
    })
    const location = response.headers?.location
    if (!REDIRECT_STATUSES.has(response.status) || !location) {
      const responseBody = response.status >= 200 && response.status < 300
        ? response.body
        : undefined
      const responseText = responseBody === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: false }).decode(responseBody)
      const noBodyStatus = response.status === 204 || response.status === 205 || response.status === 304
      const safeResponseHeaders = response.status >= 200 && response.status < 300
        && response.headers?.["content-type"]
        ? { "content-type": response.headers["content-type"] }
        : undefined
      return new Response(noBodyStatus ? undefined : responseText, {
        status: response.status,
        // Do not expose error headers (including Content-Length) as a second
        // response oracle. Successful provider payloads only need their type.
        headers: safeResponseHeaders,
      })
    }
    if (redirects >= maxRedirects) {
      throw new VoipEndpointSecurityError("VoIP endpoint exceeded the redirect limit")
    }
    let redirected: URL
    try {
      redirected = new URL(location, target.url)
    } catch {
      throw new VoipEndpointSecurityError("VoIP endpoint returned an invalid redirect")
    }
    if (target.url.protocol === "https:" && redirected.protocol === "http:") {
      throw new VoipEndpointSecurityError("VoIP endpoint must not downgrade HTTPS to HTTP")
    }
    if (redirected.origin !== target.url.origin) {
      headers = { ...headers }
      removeHeader(headers, "authorization")
      removeHeader(headers, "cookie")
      removeHeader(headers, "proxy-authorization")
    }
    if (
      (response.status === 303 && method !== "GET" && method !== "HEAD")
      || ((response.status === 301 || response.status === 302) && method === "POST")
    ) {
      method = "GET"
      body = undefined
      headers = { ...headers }
      removeHeader(headers, "content-length")
      removeHeader(headers, "content-type")
    }
    currentUrl = redirected.toString()
    redirects += 1
  }
}
