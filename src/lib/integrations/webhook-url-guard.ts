/**
 * Central SSRF protection for tenant-controlled outbound webhook URLs.
 *
 * There are two layers:
 *   - the synchronous assertions keep the provider-specific Slack/Teams and
 *     legacy generic call sites backwards-compatible;
 *   - validateOutboundWebhookUrl/requestOutboundWebhook are the production
 *     path for generic webhooks. They resolve every A/AAAA result, reject
 *     non-public addresses, pin the validated address into the socket lookup
 *     (closing the DNS-rebinding gap), and revalidate every redirect hop.
 *
 * Generic webhooks require HTTPS by default. A narrowly scoped caller may opt
 * into public HTTP only by passing `allowHttp: true` explicitly.
 */
import { lookup as dnsLookup } from "node:dns/promises"
import {
  request as httpRequest,
  type IncomingMessage,
  type RequestOptions as HttpRequestOptions,
} from "node:http"
import { request as httpsRequest } from "node:https"
import { BlockList, isIP } from "node:net"

/** The known-safe provider name — passed by the route so errors stay helpful. */
export type WebhookProvider = "slack" | "teams"

/** Non-retryable policy failure, distinct from transient DNS/network errors. */
export class OutboundWebhookSecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OutboundWebhookSecurityError"
  }
}

export interface ResolvedWebhookAddress {
  address: string
  family: 4 | 6
}

export type OutboundWebhookResolver = (
  hostname: string,
) => Promise<readonly ResolvedWebhookAddress[]>

export interface OutboundWebhookValidationOptions {
  /** HTTPS is required unless the individual caller explicitly passes true. */
  allowHttp?: boolean
  /**
   * Optional exact-host allowlist. When supplied it is enforced for the
   * initial URL and every redirect hop, after URL hostname normalization.
   */
  allowedHosts?: readonly string[]
  /** Maximum time spent waiting for A/AAAA lookup. */
  dnsTimeoutMs?: number
  /** Test seam; production callers should use the system resolver. */
  resolver?: OutboundWebhookResolver
}

export interface ValidatedOutboundWebhookTarget {
  url: URL
  addresses: readonly ResolvedWebhookAddress[]
}

export interface OutboundWebhookTransportRequest {
  method: string
  headers: Record<string, string>
  body?: string | Uint8Array
  timeoutMs: number
  maxResponseBytes: number
  responseBodyMode?: "text" | "bytes"
}

export interface OutboundWebhookTransportResponse {
  status: number
  location?: string
  headers?: Record<string, string>
  bodyText?: string
  bodyBytes?: Uint8Array
}

export type OutboundWebhookTransport = (
  target: ValidatedOutboundWebhookTarget,
  request: OutboundWebhookTransportRequest,
) => Promise<OutboundWebhookTransportResponse>

export interface OutboundWebhookRequestOptions
  extends OutboundWebhookValidationOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  /** Total budget for DNS, redirects, connection, and any retained response. */
  timeoutMs?: number
  /** Maximum serialized request body size. Defaults to 1 MiB. */
  maxBodyBytes?: number
  /**
   * Maximum response body to retain. Defaults to zero, so ordinary webhook
   * delivery destroys the response immediately after headers. Integrations
   * that need a small response payload must opt in explicitly.
   */
  maxResponseBytes?: number
  /** Number of redirects to follow after revalidating their targets. */
  maxRedirects?: number
  /**
   * Additional credential-bearing headers to remove when a redirect changes
   * origin. Authorization, Cookie, and Proxy-Authorization are always removed.
   */
  sensitiveHeaders?: readonly string[]
  /** Test seam; production callers use the IP-pinned Node transport. */
  transport?: OutboundWebhookTransport
}

export interface OutboundWebhookResponse {
  ok: boolean
  status: number
  url: string
  redirects: number
  headers?: Record<string, string>
  bodyText?: string
  bodyBytes?: Uint8Array
}

export interface OutboundResourceDownloadOptions
  extends OutboundWebhookValidationOptions {
  /** Total DNS, redirect, connection, and body-read budget. */
  timeoutMs?: number
  /** Required response cap; bounded to 25 MiB by the transport. */
  maxResponseBytes?: number
  /** Number of redirect hops to follow after validating and pinning each one. */
  maxRedirects?: number
  headers?: Record<string, string>
  sensitiveHeaders?: readonly string[]
  /** Test seam; production callers use the IP-pinned Node transport. */
  transport?: OutboundWebhookTransport
}

export interface OutboundResourceDownloadResponse {
  ok: boolean
  status: number
  url: string
  redirects: number
  headers?: Record<string, string>
  bodyBytes: Uint8Array
}

const DEFAULT_DNS_TIMEOUT_MS = 3_000
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024
const HARD_MAX_BODY_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 0
const HARD_MAX_RESPONSE_BYTES = 1024 * 1024
const HARD_MAX_RESOURCE_BYTES = 25 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3
const MAX_DNS_RESULTS = 32
const MAX_CONNECTION_CANDIDATES = 8
const FAILOVER_SAFE_METHODS = new Set(["GET", "HEAD"])
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
const FORBIDDEN_OUTBOUND_HEADERS = new Set([
  "host",
  "connection",
  "transfer-encoding",
  "upgrade",
  "keep-alive",
  "te",
  "trailer",
])

/**
 * Node's WHATWG URL parser canonicalizes decimal/octal/hex IPv4 spellings to
 * dotted decimal. BlockList then gives us one range implementation for literal
 * targets and DNS answers.
 */
// Keep IPv4 and IPv6 rules separate. Node's BlockList maps IPv4 checks into
// IPv4-mapped IPv6 form when IPv6 rules share the same instance; an
// `::ffff:0:0/96` rule would otherwise classify every public IPv4 as blocked.
const NON_PUBLIC_IPV4_ADDRESSES = new BlockList()
const NON_PUBLIC_IPV6_ADDRESSES = new BlockList()
const GLOBAL_UNICAST_IPV6_ADDRESSES = new BlockList()

// Current globally-routable IPv6 unicast space. Rejecting everything outside
// this allocation is deliberately conservative for a server-side webhook
// client and prevents locally-routed reserved ranges from becoming an SSRF
// bypass.
GLOBAL_UNICAST_IPV6_ADDRESSES.addSubnet("2000::", 3, "ipv6")

for (const [network, prefix] of [
  ["0.0.0.0", 8],       // this host / unspecified
  ["10.0.0.0", 8],      // RFC1918
  ["100.64.0.0", 10],   // shared address space (CGNAT)
  ["127.0.0.0", 8],     // loopback
  ["169.254.0.0", 16],  // link-local + cloud metadata
  ["172.16.0.0", 12],   // RFC1918
  ["192.0.0.0", 24],    // IETF protocol assignments
  ["192.0.2.0", 24],    // TEST-NET-1
  ["192.88.99.0", 24],  // deprecated 6to4 relay anycast
  ["192.168.0.0", 16],  // RFC1918
  ["198.18.0.0", 15],   // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24],  // TEST-NET-3
  ["224.0.0.0", 4],     // multicast
  ["240.0.0.0", 4],     // reserved + limited broadcast
] as const) {
  NON_PUBLIC_IPV4_ADDRESSES.addSubnet(network, prefix, "ipv4")
}

for (const [network, prefix] of [
  ["::", 96],           // unspecified, loopback, IPv4-compatible forms
  ["::ffff:0:0", 96],   // IPv4-mapped forms (never bypass IPv4 checks)
  ["64:ff9b::", 96],    // well-known NAT64 (embeds an IPv4 target)
  ["64:ff9b:1::", 48],  // local-use NAT64
  ["100::", 64],        // discard-only
  ["2001::", 23],       // IETF special-purpose assignments
  ["2001:db8::", 32],   // documentation
  ["2002::", 16],       // deprecated 6to4 (embeds an IPv4 target)
  ["3fff::", 20],       // documentation
  ["5f00::", 16],       // segment-routing SIDs
  ["fc00::", 7],        // unique-local
  ["fe80::", 10],       // link-local
  ["fec0::", 10],       // deprecated site-local
  ["ff00::", 8],        // multicast
] as const) {
  NON_PUBLIC_IPV6_ADDRESSES.addSubnet(network, prefix, "ipv6")
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "local",
  "metadata",
  "metadata.google.internal",
  "metadata.internal",
  "instance-data",
])

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
] as const

function normalizedHostname(url: URL): string {
  // Node versions differ on whether URL.hostname keeps IPv6 brackets.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname
}

function isBlockedHostname(hostname: string): boolean {
  return (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  )
}

function allowHttpByPolicy(explicit?: boolean): boolean {
  return explicit === true
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

function parseOutboundUrl(
  rawUrl: string,
  options: { allowHttp: boolean; label: "Webhook" | "Outbound" },
): URL {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 4_096) {
    throw new OutboundWebhookSecurityError(
      `Invalid ${options.label.toLowerCase()} URL`,
    )
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new OutboundWebhookSecurityError(
      `Invalid ${options.label.toLowerCase()} URL`,
    )
  }

  const allowedProtocols = options.allowHttp ? ["http:", "https:"] : ["https:"]
  if (!allowedProtocols.includes(parsed.protocol)) {
    const requirement = options.allowHttp ? "http: or https:" : "https:"
    throw new OutboundWebhookSecurityError(
      `${options.label} URL must use ${requirement} (got ${parsed.protocol})`,
    )
  }

  if (parsed.username || parsed.password) {
    throw new OutboundWebhookSecurityError(
      `${options.label} URL must not contain credentials`,
    )
  }

  const hostname = normalizedHostname(parsed)
  if (!hostname || isBlockedHostname(hostname)) {
    throw new OutboundWebhookSecurityError(
      `${options.label} URL references a blocked host: ${hostname}`,
    )
  }

  // Fragments never reach an HTTP server. Dropping them avoids storing a value
  // that appears different in the UI but has the same network destination.
  parsed.hash = ""
  return parsed
}

function assertPublicAddress(address: string, expectedFamily?: 4 | 6): 4 | 6 {
  const actualFamily = isIP(address)
  if (actualFamily !== 4 && actualFamily !== 6) {
    throw new OutboundWebhookSecurityError(
      "Webhook host resolved to an invalid IP address",
    )
  }
  if (expectedFamily !== undefined && actualFamily !== expectedFamily) {
    throw new OutboundWebhookSecurityError(
      "Webhook DNS response has an inconsistent address family",
    )
  }

  const isNonPublic = actualFamily === 4
    ? NON_PUBLIC_IPV4_ADDRESSES.check(address, "ipv4")
    : !GLOBAL_UNICAST_IPV6_ADDRESSES.check(address, "ipv6") ||
      NON_PUBLIC_IPV6_ADDRESSES.check(address, "ipv6")
  if (isNonPublic) {
    throw new OutboundWebhookSecurityError(
      "Webhook URL resolves to a private, local, or reserved address",
    )
  }
  return actualFamily
}

async function systemResolver(
  hostname: string,
): Promise<readonly ResolvedWebhookAddress[]> {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true })
  return answers.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }))
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Resolve and validate a generic outbound webhook URL.
 *
 * Every returned A/AAAA address must be public. Rejecting a mixed public/private
 * answer prevents a resolver or attacker from choosing the unsafe member later.
 */
export async function validateOutboundWebhookUrl(
  rawUrl: string,
  options: OutboundWebhookValidationOptions = {},
): Promise<ValidatedOutboundWebhookTarget> {
  const url = parseOutboundUrl(rawUrl, {
    allowHttp: allowHttpByPolicy(options.allowHttp),
    label: "Webhook",
  })
  const hostname = normalizedHostname(url)
  if (options.allowedHosts !== undefined) {
    const allowedHosts = new Set(options.allowedHosts
      .map(host => host.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean))
    if (!allowedHosts.has(hostname)) {
      throw new OutboundWebhookSecurityError(
        `Webhook URL host is not allowlisted: ${hostname}`,
      )
    }
  }
  const literalFamily = isIP(hostname)

  if (literalFamily === 4 || literalFamily === 6) {
    assertPublicAddress(hostname, literalFamily)
    return {
      url,
      addresses: [{ address: hostname, family: literalFamily }],
    }
  }

  const resolver = options.resolver ?? systemResolver
  const dnsTimeoutMs = boundedInteger(
    options.dnsTimeoutMs,
    DEFAULT_DNS_TIMEOUT_MS,
    1,
    DEFAULT_REQUEST_TIMEOUT_MS,
  )

  let answers: readonly ResolvedWebhookAddress[]
  try {
    answers = await withTimeout(
      resolver(hostname),
      dnsTimeoutMs,
      "Webhook DNS lookup timed out",
    )
  } catch (error) {
    if (error instanceof Error && error.message === "Webhook DNS lookup timed out") {
      throw error
    }
    throw new Error("Webhook hostname could not be resolved")
  }

  if (answers.length === 0) {
    throw new Error("Webhook hostname did not resolve to an address")
  }
  if (answers.length > MAX_DNS_RESULTS) {
    throw new OutboundWebhookSecurityError(
      "Webhook hostname returned too many DNS addresses",
    )
  }

  const deduplicated = new Map<string, ResolvedWebhookAddress>()
  for (const answer of answers) {
    const family = assertPublicAddress(answer.address, answer.family)
    deduplicated.set(`${family}:${answer.address}`, {
      address: answer.address,
      family,
    })
  }

  return { url, addresses: [...deduplicated.values()] }
}

function removeHeader(headers: Record<string, string>, name: string): void {
  for (const header of Object.keys(headers)) {
    if (header.toLowerCase() === name.toLowerCase()) delete headers[header]
  }
}

function assertAllowedOutboundHeaders(headers: Record<string, string>): void {
  for (const header of Object.keys(headers)) {
    const normalized = header.toLowerCase()
    if (
      FORBIDDEN_OUTBOUND_HEADERS.has(normalized) ||
      normalized.startsWith("proxy-") ||
      normalized.startsWith(":")
    ) {
      throw new OutboundWebhookSecurityError(
        `Webhook header is not allowed: ${header}`,
      )
    }
  }
}

function responseHeaders(response: IncomingMessage): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue
    normalized[name.toLowerCase()] = Array.isArray(value)
      ? value.join(", ")
      : value
  }
  return normalized
}

function requestOneAddress(
  target: ValidatedOutboundWebhookTarget,
  address: ResolvedWebhookAddress,
  request: OutboundWebhookTransportRequest,
): Promise<OutboundWebhookTransportResponse> {
  return new Promise((resolve, reject) => {
    let absoluteTimer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const clearAbsoluteTimer = () => {
      if (absoluteTimer) {
        clearTimeout(absoluteTimer)
        absoluteTimer = undefined
      }
    }
    const succeed = (response: OutboundWebhookTransportResponse) => {
      if (settled) return
      settled = true
      clearAbsoluteTimer()
      resolve(response)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearAbsoluteTimer()
      reject(error)
    }
    const pinnedLookup: NonNullable<HttpRequestOptions["lookup"]> = (
      _hostname: string,
      options,
      callback,
    ) => {
      if (options.all) {
        callback(null, [{
          address: address.address,
          family: address.family,
        }])
        return
      }
      callback(null, address.address, address.family)
    }

    const requestOptions: HttpRequestOptions = {
      method: request.method,
      headers: request.headers,
      family: address.family,
      lookup: pinnedLookup,
    }
    const onResponse = (response: IncomingMessage) => {
      const status = response.statusCode ?? 0
      const location = Array.isArray(response.headers.location)
        ? response.headers.location[0]
        : response.headers.location
      const headers = responseHeaders(response)

      // Ordinary webhook delivery only needs status/Location. Redirect bodies
      // are also irrelevant and must not delay validation of the next hop.
      if (
        request.maxResponseBytes === 0 ||
        REDIRECT_STATUSES.has(status)
      ) {
        response.destroy()
        succeed({ status, location, headers })
        return
      }

      const chunks: Buffer[] = []
      let receivedBytes = 0
      response.on("data", (chunk: Buffer | Uint8Array | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        receivedBytes += bytes.byteLength
        if (receivedBytes > request.maxResponseBytes) {
          const error = new OutboundWebhookSecurityError(
            `Webhook response body exceeds the ${request.maxResponseBytes} byte limit`,
          )
          response.destroy(error)
          clientRequest.destroy(error)
          fail(error)
          return
        }
        chunks.push(bytes)
      })
      response.once("end", () => {
        response.destroy()
        const body = Buffer.concat(chunks, receivedBytes)
        succeed({
          status,
          location,
          headers,
          ...(request.responseBodyMode === "bytes"
            ? { bodyBytes: body }
            : { bodyText: body.toString("utf8") }),
        })
      })
      response.once("aborted", () => {
        fail(new Error("Webhook response was aborted"))
      })
      response.once("error", fail)
      response.once("close", () => {
        if (!response.complete) {
          fail(new Error("Webhook response closed before completion"))
        }
      })
    }
    const clientRequest = target.url.protocol === "https:"
      ? httpsRequest(target.url, requestOptions, onResponse)
      : httpRequest(target.url, requestOptions, onResponse)

    // ClientRequest#setTimeout is an inactivity timeout, not a total deadline.
    // Keep it as a stalled-socket guard and add an absolute wall-clock abort.
    absoluteTimer = setTimeout(() => {
      clientRequest.destroy(new Error("Webhook request deadline exceeded"))
    }, request.timeoutMs)
    absoluteTimer.unref?.()
    clientRequest.setTimeout(request.timeoutMs, () => {
      clientRequest.destroy(new Error("Webhook request timed out"))
    })
    clientRequest.once("error", (error) => {
      fail(error)
    })

    if (request.body !== undefined) clientRequest.write(request.body)
    clientRequest.end()
  })
}

export function connectionCandidatesForOutboundRequest(
  target: Pick<ValidatedOutboundWebhookTarget, "addresses">,
  request: Pick<OutboundWebhookTransportRequest, "method" | "body">,
): readonly ResolvedWebhookAddress[] {
  const candidates = target.addresses.slice(0, MAX_CONNECTION_CANDIDATES)
  return request.body === undefined && FAILOVER_SAFE_METHODS.has(request.method.toUpperCase())
    ? candidates
    : candidates.slice(0, 1)
}

const pinnedNodeTransport: OutboundWebhookTransport = async (target, request) => {
  const deadline = Date.now() + request.timeoutMs
  // POST/PATCH/DELETE and every body-bearing request are not safely replayable:
  // a reset/timeout may occur after the first address accepted the operation.
  // Trying another DNS answer would duplicate it before the caller can mark
  // the delivery outcome unknown.
  const retryCandidates = connectionCandidatesForOutboundRequest(target, request)
  let lastError: unknown

  for (const candidate of retryCandidates) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) throw new Error("Webhook request timed out")

    try {
      return await requestOneAddress(target, candidate, {
        ...request,
        timeoutMs: remainingMs,
      })
    } catch (error) {
      if (error instanceof OutboundWebhookSecurityError) throw error
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Webhook request failed")
}

/**
 * Send one HTTP request through the SSRF-safe transport.
 *
 * Redirect following is deliberately manual. Each Location is parsed, DNS
 * resolved, range-checked, and pinned before the next socket is opened.
 */
async function requestOutboundHttp(
  rawUrl: string,
  options: OutboundWebhookRequestOptions,
  responsePolicy: {
    hardMaxResponseBytes: number
    responseBodyMode: "text" | "bytes"
  },
): Promise<OutboundWebhookResponse> {
  const timeoutMs = boundedInteger(
    options.timeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    1,
    60_000,
  )
  const maxRedirects = boundedInteger(
    options.maxRedirects,
    DEFAULT_MAX_REDIRECTS,
    0,
    10,
  )
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    0,
    responsePolicy.hardMaxResponseBytes,
  )
  const transport = options.transport ?? pinnedNodeTransport
  const deadline = Date.now() + timeoutMs
  let currentUrl = rawUrl
  let method = (options.method ?? "POST").toUpperCase()
  if (!ALLOWED_METHODS.has(method)) {
    throw new OutboundWebhookSecurityError(
      `Webhook method is not allowed: ${method}`,
    )
  }
  let headers = { ...(options.headers ?? {}) }
  assertAllowedOutboundHeaders(headers)
  let body = options.body
  if ((method === "GET" || method === "HEAD") && body !== undefined) {
    throw new OutboundWebhookSecurityError(
      `Webhook ${method} request must not include a body`,
    )
  }
  const bodyBytes = body === undefined
    ? 0
    : typeof body === "string"
      ? Buffer.byteLength(body)
      : body.byteLength
  const maxBodyBytes = boundedInteger(
    options.maxBodyBytes,
    DEFAULT_MAX_BODY_BYTES,
    0,
    HARD_MAX_BODY_BYTES,
  )
  if (bodyBytes > maxBodyBytes) {
    throw new OutboundWebhookSecurityError(
      `Webhook body exceeds the ${maxBodyBytes} byte limit`,
    )
  }
  removeHeader(headers, "content-length")
  if (body !== undefined) {
    headers["Content-Length"] = String(
      bodyBytes,
    )
  }
  let redirects = 0

  while (true) {
    const remainingBeforeDns = deadline - Date.now()
    if (remainingBeforeDns <= 0) throw new Error("Webhook request timed out")

    const target = await validateOutboundWebhookUrl(currentUrl, {
      allowHttp: options.allowHttp,
      allowedHosts: options.allowedHosts,
      resolver: options.resolver,
      dnsTimeoutMs: Math.min(
        remainingBeforeDns,
        boundedInteger(
          options.dnsTimeoutMs,
          DEFAULT_DNS_TIMEOUT_MS,
          1,
          DEFAULT_REQUEST_TIMEOUT_MS,
        ),
      ),
    })

    const remainingBeforeRequest = deadline - Date.now()
    if (remainingBeforeRequest <= 0) throw new Error("Webhook request timed out")

    const response = await transport(target, {
      method,
      headers,
      body,
      timeoutMs: remainingBeforeRequest,
      maxResponseBytes,
      responseBodyMode: responsePolicy.responseBodyMode,
    })

    if (!REDIRECT_STATUSES.has(response.status) || !response.location) {
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        url: target.url.toString(),
        redirects,
        ...(response.headers === undefined
          ? {}
          : { headers: response.headers }),
        ...(response.bodyText === undefined
          ? {}
          : { bodyText: response.bodyText }),
        ...(response.bodyBytes === undefined
          ? {}
          : { bodyBytes: response.bodyBytes }),
      }
    }

    if (redirects >= maxRedirects) {
      throw new OutboundWebhookSecurityError(
        `Webhook exceeded the ${maxRedirects} redirect limit`,
      )
    }

    let redirected: URL
    try {
      redirected = new URL(response.location, target.url)
    } catch {
      throw new OutboundWebhookSecurityError(
        "Webhook returned an invalid redirect URL",
      )
    }
    if (
      target.url.protocol === "https:" &&
      redirected.protocol === "http:"
    ) {
      throw new OutboundWebhookSecurityError(
        "Webhook redirect must not downgrade HTTPS to HTTP",
      )
    }

    if (redirected.origin !== target.url.origin) {
      headers = { ...headers }
      removeHeader(headers, "authorization")
      removeHeader(headers, "cookie")
      removeHeader(headers, "proxy-authorization")
      for (const sensitiveHeader of options.sensitiveHeaders ?? []) {
        removeHeader(headers, sensitiveHeader)
      }
    }

    // Match fetch semantics for redirects while keeping 307/308 bodies. A
    // 303 never changes GET or HEAD; other methods become a bodyless GET.
    if (
      (response.status === 303 && method !== "GET" && method !== "HEAD") ||
      ((response.status === 301 || response.status === 302) && method === "POST")
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

export async function requestOutboundWebhook(
  rawUrl: string,
  options: OutboundWebhookRequestOptions = {},
): Promise<OutboundWebhookResponse> {
  return requestOutboundHttp(rawUrl, options, {
    hardMaxResponseBytes: HARD_MAX_RESPONSE_BYTES,
    responseBodyMode: "text",
  })
}

/**
 * Download an untrusted HTTPS resource through the same DNS-pinned,
 * redirect-revalidating transport used for generic webhooks. This is for
 * bounded binary inputs such as call recordings; it deliberately exposes no
 * request method or body controls.
 */
export async function downloadOutboundResource(
  rawUrl: string,
  options: OutboundResourceDownloadOptions = {},
): Promise<OutboundResourceDownloadResponse> {
  const response = await requestOutboundHttp(rawUrl, {
    ...options,
    method: "GET",
    maxBodyBytes: 0,
    maxResponseBytes: options.maxResponseBytes ?? HARD_MAX_RESOURCE_BYTES,
  }, {
    hardMaxResponseBytes: HARD_MAX_RESOURCE_BYTES,
    responseBodyMode: "bytes",
  })

  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    redirects: response.redirects,
    ...(response.headers === undefined ? {} : { headers: response.headers }),
    bodyBytes: response.bodyBytes ?? new Uint8Array(),
  }
}

/**
 * Provider-specific synchronous guard used by Slack and Teams settings.
 * Provider host allowlists make DNS rebinding ineffective for reaching an
 * arbitrary tenant-selected host; the senders also reject redirects.
 */
export function assertSafeWebhookUrl(
  rawUrl: string,
  provider: WebhookProvider,
): void {
  const parsed = parseOutboundUrl(rawUrl, {
    allowHttp: false,
    label: "Webhook",
  })
  const host = normalizedHostname(parsed)

  // Keep provider endpoints hostname-only; neither Slack nor Teams documents
  // incoming webhook URLs using IP literals.
  if (isIP(host)) {
    throw new OutboundWebhookSecurityError(
      "Webhook URL must not be an IP address literal",
    )
  }

  if (provider === "slack") {
    if (host !== "hooks.slack.com") {
      throw new OutboundWebhookSecurityError(
        `Slack webhook URL must use hooks.slack.com (got ${host})`,
      )
    }
    return
  }

  const teamsAllowedSuffixes = [
    ".webhook.office.com",
    ".logic.azure.com",
  ]
  const teamsAllowedExact = ["outlook.office.com"]
  const allowed =
    teamsAllowedExact.includes(host) ||
    teamsAllowedSuffixes.some((suffix) => host.endsWith(suffix))
  if (!allowed) {
    throw new OutboundWebhookSecurityError(
      `Teams webhook URL must use a Microsoft domain (*.webhook.office.com, outlook.office.com, or *.logic.azure.com). Got: ${host}`,
    )
  }
}

/**
 * Backwards-compatible synchronous lexical guard for generic integration URLs.
 * New webhook code should use validateOutboundWebhookUrl/requestOutboundWebhook
 * so DNS answers are checked and pinned as well.
 */
export function assertSafeOutboundUrl(rawUrl: string): void {
  const parsed = parseOutboundUrl(rawUrl, {
    allowHttp: false,
    label: "Outbound",
  })
  const host = normalizedHostname(parsed)
  if (isIP(host)) {
    throw new OutboundWebhookSecurityError(
      "Outbound URL must not be an IP address literal",
    )
  }
}
