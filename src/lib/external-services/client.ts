/**
 * External-service HTTP client — N17 Phase 5 slice 1.
 *
 * Single low-level entrypoint that takes a `ResolvedCredential` +
 * method/path and issues an outbound request. Applies the credential's
 * auth header, applies a bounded timeout/response, and normalises the
 * response shape.
 *
 * Slice 1 ships JSON + text body decoding. Slice 2 generates per-
 * operation typed methods from an OpenAPI spec and routes through
 * here. Slice 2 also wires this into the N3 sandbox as
 * `crm.http.<credName>.get(path)`.
 *
 * Pure — no Prisma, no Next, no env reads. The route layer calls this
 * after decrypting the credential via the vault.
 */
import { applyCredentialToHeaders } from "@/lib/credentials/apply"
import {
  OutboundWebhookSecurityError,
  requestOutboundWebhook,
  type OutboundWebhookResolver,
  type OutboundWebhookTransport,
} from "@/lib/integrations/webhook-url-guard"
import {
  ABSOLUTE_REQUEST_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type ExternalServiceRequest,
  type ExternalServiceResponse,
} from "./types"

export class ExternalServiceError extends Error {
  constructor(
    public readonly kind:
      | "invalid_base_url"
      | "invalid_path"
      | "fetch_failed"
      | "timeout"
      | "decode_failed",
    message: string
  ) {
    super(message)
    this.name = "ExternalServiceError"
  }
}

/**
 * IPv4 ranges blocked at the baseUrl boundary. SSRF defence: tenant
 * code (slice 2 sandbox) chooses the credential's baseUrl, and an
 * attacker would otherwise be able to point a credential at
 * cloud metadata (169.254.169.254 → IMDS), loopback (127.0.0.0/8),
 * link-local (169.254.0.0/16), or RFC1918 private ranges to pivot
 * inside the host network.
 *
 * This is an early lexical rejection only. The actual request also resolves
 * every A/AAAA answer, rejects mixed/private results, and pins a validated
 * address into the socket via requestOutboundWebhook.
 */
function isBlockedIPv4(host: string): boolean {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const [a, b] = m.slice(1).map(Number)
  if (a === 127) return true                              // 127.0.0.0/8 loopback
  if (a === 10) return true                               // 10.0.0.0/8
  if (a === 169 && b === 254) return true                 // 169.254.0.0/16 link-local + IMDS
  if (a === 172 && b >= 16 && b <= 31) return true        // 172.16.0.0/12
  if (a === 192 && b === 168) return true                 // 192.168.0.0/16
  if (a === 0) return true                                // 0.0.0.0/8
  return false
}

function isBlockedIPv6(host: string): boolean {
  // URL parser strips brackets — host comes in as the literal address.
  const lower = host.toLowerCase()
  if (lower === "::1") return true                        // IPv6 loopback
  if (lower === "::") return true                         // unspecified
  if (/^fc[0-9a-f]{2}:/.test(lower) || /^fd[0-9a-f]{2}:/.test(lower))
    return true                                            // unique local fc00::/7
  // Link-local fe80::/10 covers fe80::–febf::. Earlier `startsWith("fe80:")`
  // missed fe81-febf which are equally link-local.
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true
  // IPv4-mapped IPv6: ::ffff:<v4> — these reach the IPv4 host they
  // encode. ::ffff:127.0.0.1 → loopback, ::ffff:169.254.169.254 →
  // IMDS. No legitimate baseUrl uses IPv4-mapped form; block the
  // whole prefix rather than parsing the embedded IPv4. The
  // `::ffff:0:` translated variant is a subset of this — no separate
  // check needed.
  if (lower.startsWith("::ffff:")) return true
  // NAT64 well-known prefix (RFC 6052) — 64:ff9b::/96 also wraps an
  // IPv4 address that the host network may route. Block for the same
  // reason as ::ffff:.
  if (lower.startsWith("64:ff9b:")) return true
  // Site-local fec0::/10 (deprecated by RFC 4291 in 2004, but some
  // stacks still route it). Architecturally private; block for
  // parity with RFC1918 / link-local.
  if (/^fe[c-f][0-9a-f]:/.test(lower)) return true
  return false
}

function isBlockedHost(host: string): boolean {
  // Node's URL.hostname returns IPv6 literals WITH brackets ("[::1]")
  // on some versions; strip them before the IPv6 check.
  const lower = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "")
  if (lower === "localhost") return true
  return isBlockedIPv4(lower) || isBlockedIPv6(lower)
}

/**
 * Build the absolute URL. Rejects:
 *   - non-https schemes on baseUrl (slice 1 hardening — slice 2
 *     allows http only if env-flagged for self-hosted internal
 *     services).
 *   - URLs with embedded credentials (`https://user:pass@host`) —
 *     credentials in URL get logged by every proxy + may leak via
 *     the Referer header; the vault is the only sanctioned secret
 *     channel.
 *   - hostnames in private / loopback / link-local IP ranges — SSRF
 *     pivot guard (see `isBlockedHost`).
 *   - path containing `..` (defense against path-traversal escapes
 *     out of the credential's baseUrl scope).
 *   - absolute http(s) URLs in `path` (caller should set baseUrl).
 */
function buildUrl(baseUrl: string, path: string): string {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new ExternalServiceError("invalid_base_url", `Malformed baseUrl: ${baseUrl}`)
  }
  if (parsed.protocol !== "https:") {
    throw new ExternalServiceError(
      "invalid_base_url",
      `baseUrl must use https (got ${parsed.protocol}//) — slice 1 hardening`
    )
  }
  if (parsed.username || parsed.password) {
    throw new ExternalServiceError(
      "invalid_base_url",
      `baseUrl must not contain embedded credentials (user:pass@host) — use the vault instead`
    )
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new ExternalServiceError(
      "invalid_base_url",
      `baseUrl host "${parsed.hostname}" is in a blocked range (loopback/private/link-local/IMDS)`
    )
  }
  if (/^https?:\/\//i.test(path)) {
    throw new ExternalServiceError(
      "invalid_path",
      `path must be relative to baseUrl, not absolute (got ${path})`
    )
  }
  if (path.split("/").some(seg => seg === "..")) {
    throw new ExternalServiceError(
      "invalid_path",
      `path may not contain ".." segments — would escape baseUrl scope`
    )
  }
  if (path.includes("\\")) {
    throw new ExternalServiceError(
      "invalid_path",
      "path may not contain backslashes",
    )
  }

  // Normalise: baseUrl trailing slash + path leading slash. Build the base
  // from the parsed URL so a query/fragment cannot change slash handling.
  const base = new URL(parsed.toString())
  base.search = ""
  base.hash = ""
  if (!base.pathname.endsWith("/")) base.pathname += "/"
  const cleaned = path.startsWith("/") ? path.slice(1) : path
  const resolved = new URL(cleaned, base)

  // WHATWG URL treats `//host`, backslashes, and encoded dot segments as
  // structural navigation. Enforce the intended credential origin and base
  // path after canonicalization so none of those forms can escape its scope.
  if (resolved.origin !== parsed.origin) {
    throw new ExternalServiceError(
      "invalid_path",
      "path must remain on the credential baseUrl origin",
    )
  }
  if (!resolved.pathname.startsWith(base.pathname)) {
    throw new ExternalServiceError(
      "invalid_path",
      "path must remain within the credential baseUrl path",
    )
  }

  return resolved.toString()
}

const MAX_EXTERNAL_RESPONSE_BYTES = 1024 * 1024
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function normalizeResponseHeaders(headers: Headers): Record<string, string> {
  const normalized: Record<string, string> = {}
  headers.forEach((value, name) => {
    normalized[name.toLowerCase()] = value
  })
  return normalized
}

async function readBoundedFetcherBody(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  if (maxBytes === 0 || response.body === null) return undefined

  const advertisedLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    await response.body.cancel().catch(() => undefined)
    throw new OutboundWebhookSecurityError(
      `Webhook response body exceeds the ${maxBytes} byte limit`,
    )
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new OutboundWebhookSecurityError(
          `Webhook response body exceeds the ${maxBytes} byte limit`,
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), received).toString("utf8")
}

/**
 * Preserve the existing injected-fetch test seam without using global fetch in
 * production. The common request policy still handles method/header/body
 * validation and redirects; this adapter only replaces the final socket dial.
 */
function transportForFetcher(fetcher: typeof fetch): OutboundWebhookTransport {
  return async (target, outboundRequest) => {
    const response = await fetcher(target.url.toString(), {
      method: outboundRequest.method,
      headers: outboundRequest.headers,
      body: outboundRequest.body,
      redirect: "manual",
      signal: AbortSignal.timeout(outboundRequest.timeoutMs),
    })
    const headers = normalizeResponseHeaders(response.headers)
    const location = headers.location

    if (REDIRECT_STATUSES.has(response.status)) {
      await response.body?.cancel().catch(() => undefined)
      return { status: response.status, location, headers }
    }

    return {
      status: response.status,
      location,
      headers,
      bodyText: await readBoundedFetcherBody(
        response,
        outboundRequest.maxResponseBytes,
      ),
    }
  }
}

// An injected fetcher is an in-process test seam and never opens the validated
// socket itself. Supply a deterministic public answer so unit tests remain
// hermetic; production (no fetcher) always uses real DNS plus pinned transport.
const INJECTED_FETCH_RESOLVER: OutboundWebhookResolver = async () => [{
  address: "93.184.216.34",
  family: 4,
}]

export async function callExternalService(
  request: ExternalServiceRequest
): Promise<ExternalServiceResponse> {
  const startedAt = Date.now()
  const url = buildUrl(request.credential.baseUrl, request.path)
  const { headers: authHeaders } = applyCredentialToHeaders(
    request.credential,
    request.headers ?? {}
  )

  let bodyText: string | undefined
  if (request.jsonBody !== undefined) {
    try {
      bodyText = JSON.stringify(request.jsonBody)
    } catch (e) {
      throw new ExternalServiceError(
        "decode_failed",
        `jsonBody is not JSON-serialisable: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    if (!Object.keys(authHeaders).some(k => k === "content-type")) {
      authHeaders["content-type"] = "application/json"
    }
  }

  const timeoutMs = Math.min(
    Math.max(1, Math.floor(request.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)),
    ABSOLUTE_REQUEST_TIMEOUT_MS
  )

  let res: Awaited<ReturnType<typeof requestOutboundWebhook>>
  try {
    res = await requestOutboundWebhook(url, {
      method: request.method,
      headers: authHeaders,
      body: bodyText,
      allowHttp: false,
      timeoutMs,
      maxResponseBytes: MAX_EXTERNAL_RESPONSE_BYTES,
      // Strip every caller/credential header when a redirect crosses origin.
      // This includes custom API-key headers, not only Authorization/Cookie.
      sensitiveHeaders: Object.keys(authHeaders),
      ...(request.fetcher
        ? {
            resolver: INJECTED_FETCH_RESOLVER,
            transport: transportForFetcher(request.fetcher),
          }
        : {}),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/aborted|deadline|timed out|timeout/i.test(msg)) {
      throw new ExternalServiceError(
        "timeout",
        `External request to ${url} timed out after ${timeoutMs}ms`
      )
    }
    if (e instanceof OutboundWebhookSecurityError) {
      const kind = /response body exceeds/i.test(msg)
        ? "decode_failed"
        : /url|host|address|dns|private|local|reserved|https/i.test(msg)
          ? "invalid_base_url"
          : "fetch_failed"
      throw new ExternalServiceError(kind, `External request blocked: ${msg}`)
    }
    throw new ExternalServiceError(
      "fetch_failed",
      `External request to ${url} failed: ${msg}`
    )
  }

  const responseHeaders: Record<string, string> = {}
  for (const [name, value] of Object.entries(res.headers ?? {})) {
    responseHeaders[name.toLowerCase()] = value
  }

  // Body decoding: JSON for application/json, string for text/*,
  // null otherwise (binary body — slice 2 will add base64 mode).
  const contentType = responseHeaders["content-type"] ?? ""
  let body: unknown = null
  try {
    if (contentType.includes("application/json")) {
      const text = res.bodyText ?? ""
      body = text ? JSON.parse(text) : null
    } else if (contentType.startsWith("text/")) {
      body = res.bodyText ?? ""
    } else {
      body = null
    }
  } catch (e) {
    throw new ExternalServiceError(
      "decode_failed",
      `Could not decode response body from ${url}: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  return {
    status: res.status,
    ok: res.ok,
    headers: responseHeaders,
    body,
    durationMs: Date.now() - startedAt,
  }
}
