import { z } from "zod"

import { downloadOutboundResource, type OutboundResourceDownloadOptions } from "../../integrations/webhook-url-guard"
import { ZeytunAvailableBalances, ZEYTUN_BALANCES_MAX_BYTES } from "./zeytun-available-balances"

const configSchema = z.strictObject({
  organizationId: z.string().trim().min(1).max(128),
  endpoint: z.url(),
  username: z.string().min(1).max(256).regex(/^[^:\r\n]+$/),
  password: z.string().min(1).max(1024).regex(/^[^\r\n]+$/),
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

type Download = (url: string, options: OutboundResourceDownloadOptions) => ReturnType<typeof downloadOutboundResource>

/** One bounded GET, no retries/writes/redirects. Schedule outside phone turns. */
export async function readZeytunAvailableBalances(
  input: unknown,
  download: Download = downloadOutboundResource,
): Promise<ZeytunAvailableBalances> {
  const parsed = configSchema.safeParse(input)
  if (!parsed.success) throw new ZeytunBalanceReadError("invalid_configuration")
  const config = parsed.data
  const url = new URL(config.endpoint)
  if (url.username || url.password || url.hash || url.search || !["http:", "https:"].includes(url.protocol)) {
    throw new ZeytunBalanceReadError("invalid_configuration")
  }
  if (url.protocol === "http:" && !config.allowPlainHttp) throw new ZeytunBalanceReadError("https_required")
  let response: Awaited<ReturnType<Download>>
  try {
    response = await download(url.toString(), {
      allowHttp: config.allowPlainHttp,
      allowedHosts: [url.hostname],
      maxRedirects: 0,
      timeoutMs: 30_000,
      maxResponseBytes: ZEYTUN_BALANCES_MAX_BYTES,
      headers: {
        Accept: "application/json",
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
    return new ZeytunAvailableBalances(response.bodyBytes, {
      organizationId: config.organizationId, source: "live", observedAt: new Date().toISOString(),
    })
  } catch {
    throw new ZeytunBalanceReadError("invalid_response")
  }
}
