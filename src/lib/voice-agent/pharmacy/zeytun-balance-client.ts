import { createHash } from "node:crypto"
import { z } from "zod"

import { postOutboundResource } from "../../integrations/webhook-url-guard"
import { ZeytunAvailableBalances, ZEYTUN_BALANCES_MAX_BYTES } from "./zeytun-available-balances"

const configSchema = z.strictObject({
  organizationId: z.string().trim().min(1).max(128),
  endpoint: z.url(),
  username: z.string().min(1).max(256).regex(/^[^:\r\n]+$/),
  password: z.string().min(1).max(1024).regex(/^[^\r\n]+$/),
  // Supplied by the server, never selected by the model or a caller's search.
  request: z.strictObject({
    GUID: z.uuid().transform((value) => value.toLowerCase()),
    METRO: z.boolean(),
    Warehouse: z.uuid().transform((value) => value.toLowerCase()),
  }),
  // Server-owned opt-in for the observed legacy endpoint, never an LLM field.
  allowPlainHttp: z.boolean().default(false),
})

export class ZeytunBalanceReadError extends Error {
  constructor(readonly code: "invalid_configuration" | "https_required" | "authentication_required" | "upstream_unavailable" | "invalid_response") {
    // Never surface response bodies, endpoint credentials, or Basic headers.
    super(code)
    this.name = "ZeytunBalanceReadError"
  }
}

export function parseZeytunBalanceConfig(input: unknown) {
  const parsed = configSchema.safeParse(input)
  if (!parsed.success) throw new ZeytunBalanceReadError("invalid_configuration")
  const config = parsed.data
  const url = new URL(config.endpoint)
  if (url.username || url.password || url.hash || url.search || !["http:", "https:"].includes(url.protocol)) {
    throw new ZeytunBalanceReadError("invalid_configuration")
  }
  if (url.protocol === "http:" && !config.allowPlainHttp) throw new ZeytunBalanceReadError("https_required")
  return { ...config, endpoint: url.toString() }
}

/** Password rotation retains the scope; a different account/request does not. */
export function zeytunBalanceScopeKey(input: unknown): string {
  const config = parseZeytunBalanceConfig(input)
  return createHash("sha256").update(JSON.stringify([
    config.organizationId, config.endpoint, config.username,
    config.request.GUID, config.request.METRO, config.request.Warehouse,
  ])).digest("hex")
}

/** One bounded read-only POST query, no retries/redirects. Run outside phone turns. */
export async function fetchZeytunAvailableBalances(
  input: unknown,
  download: typeof postOutboundResource = postOutboundResource,
) {
  const config = parseZeytunBalanceConfig(input)
  let response: Awaited<ReturnType<typeof postOutboundResource>>
  try {
    response = await download(config.endpoint, {
      allowHttp: config.allowPlainHttp,
      allowedHosts: [new URL(config.endpoint).hostname],
      maxRedirects: 0,
      // The verified response took ~29 s; allow headroom within the shared cap.
      timeoutMs: 60_000,
      maxBodyBytes: 4096,
      body: JSON.stringify(config.request),
      maxResponseBytes: ZEYTUN_BALANCES_MAX_BYTES,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
        Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")}`,
      },
    })
  } catch {
    throw new ZeytunBalanceReadError("upstream_unavailable")
  }
  if (response.status === 401 || response.status === 403) throw new ZeytunBalanceReadError("authentication_required")
  if (!response.ok || response.status !== 200) throw new ZeytunBalanceReadError("upstream_unavailable")
  try {
    const feed = new ZeytunAvailableBalances(response.bodyBytes, {
      organizationId: config.organizationId, source: "live", observedAt: new Date().toISOString(),
    })
    return { feed, payload: response.bodyBytes, scopeKey: zeytunBalanceScopeKey(config) }
  } catch {
    throw new ZeytunBalanceReadError("invalid_response")
  }
}

export async function readZeytunAvailableBalances(
  input: unknown,
  download: typeof postOutboundResource = postOutboundResource,
): Promise<ZeytunAvailableBalances> {
  return (await fetchZeytunAvailableBalances(input, download)).feed
}
