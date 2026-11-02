import { createHash } from "node:crypto"
import { TextDecoder } from "node:util"
import { SaxesParser } from "saxes"
import { z } from "zod"

import { postOutboundResource } from "../../integrations/webhook-url-guard"

export const ZEYTUN_CLIENTS_MAX_BYTES = 25 * 1024 * 1024
const SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
const SERVICE = "ZTNMOBILE"
const SOAP_ACTION = "ZTNMOBILE#ZTNMOBILE:ListClients"
// Verified from the supplied WSDL. No dynamic WSDL imports or arbitrary methods.
const REQUEST = '<?xml version="1.0" encoding="UTF-8"?>' +
  `<soap:Envelope xmlns:soap="${SOAP}"><soap:Body>` +
  `<ListClients xmlns="${SERVICE}"><param1>Pharmacy</param1></ListClients>` +
  "</soap:Body></soap:Envelope>"

const configSchema = z.strictObject({
  organizationId: z.string().trim().min(1).max(128), endpoint: z.url(),
  username: z.string().min(1).max(256).regex(/^[^:\r\n]+$/),
  password: z.string().min(1).max(1024).regex(/^[^\r\n]+$/),
  allowPlainHttp: z.boolean().default(false),
})
export class ZeytunClientsReadError extends Error {
  constructor(readonly code: "invalid_configuration" | "https_required" | "authentication_required" | "upstream_unavailable" | "invalid_response") {
    super(code); this.name = "ZeytunClientsReadError"
  }
}
export function parseZeytunClientsConfig(input: unknown) {
  const result = configSchema.safeParse(input)
  if (!result.success) throw new ZeytunClientsReadError("invalid_configuration")
  const config = result.data
  const url = new URL(config.endpoint)
  if (url.username || url.password || url.hash || url.search || !["http:", "https:"].includes(url.protocol)) {
    throw new ZeytunClientsReadError("invalid_configuration")
  }
  if (url.protocol === "http:" && !config.allowPlainHttp) throw new ZeytunClientsReadError("https_required")
  return { ...config, endpoint: url.toString() }
}
export function zeytunClientsScopeKey(input: unknown): string {
  const config = parseZeytunClientsConfig(input)
  return createHash("sha256").update(JSON.stringify([
    "zeytun-list-clients-v1", config.organizationId, config.endpoint, config.username, "Pharmacy",
  ])).digest("hex")
}

/** Strict SOAP 1.1 wrapper; namespace-aware, no DTD/entities/import resolution.
 * The returned string is still untrusted and must pass the directory schema.
 */
export function decodeZeytunClientsSoap(payload: Uint8Array): string {
  try {
    if (!payload.byteLength || payload.byteLength > ZEYTUN_CLIENTS_MAX_BYTES) throw new Error()
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(payload)
    if (/<!DOCTYPE|<!ENTITY/.test(xml)) throw new Error()
    const parser = new SaxesParser({ xmlns: true })
    const expected = [[SOAP, "Envelope"], [SOAP, "Body"], [SERVICE, "ListClientsResponse"], [SERVICE, "return"]]
    let depth = 0
    let opened = 0
    const parts: string[] = []
    parser.on("error", () => { throw new Error() })
    parser.on("doctype", () => { throw new Error() })
    parser.on("processinginstruction", () => { throw new Error() })
    parser.on("xmldecl", (decl) => {
      if (decl.version !== "1.0" || (decl.encoding && decl.encoding.toLowerCase() !== "utf-8")) throw new Error()
    })
    parser.on("opentag", (tag) => {
      if (opened !== depth || depth >= expected.length || tag.uri !== expected[depth][0] || tag.local !== expected[depth][1]) throw new Error()
      for (const attr of Object.values(tag.attributes)) {
        if (attr.uri === "http://www.w3.org/2000/xmlns/") continue
        // 1C may annotate its xs:string return. All other data attributes fail closed.
        const [prefix, local] = attr.value.split(":")
        if (depth === 3 && attr.uri === "http://www.w3.org/2001/XMLSchema-instance" && attr.local === "type" &&
            local === "string" && tag.ns[prefix] === "http://www.w3.org/2001/XMLSchema") continue
        throw new Error()
      }
      depth++; opened++
    })
    parser.on("closetag", () => { depth-- })
    const text = (value: string) => {
      if (depth === 4) parts.push(value)
      else if (value.trim()) throw new Error()
    }
    parser.on("text", text)
    parser.on("cdata", text)
    parser.write(xml).close()
    if (opened !== 4 || depth !== 0 || !parts.length) throw new Error()
    return parts.join("")
  } catch {
    // XML/JSON errors can quote customer records. Never propagate raw errors.
    throw new ZeytunClientsReadError("invalid_response")
  }
}

/** One slow read, outside phone turns; callers own scheduling/backoff/storage. */
export async function fetchZeytunClientsSoap(input: unknown, download: typeof postOutboundResource = postOutboundResource) {
  const config = parseZeytunClientsConfig(input)
  let response: Awaited<ReturnType<typeof postOutboundResource>>
  try {
    response = await download(config.endpoint, {
      allowHttp: config.allowPlainHttp, allowedHosts: [new URL(config.endpoint).hostname],
      maxRedirects: 0, timeoutMs: 300_000, maxBodyBytes: 4096,
      maxResponseBytes: ZEYTUN_CLIENTS_MAX_BYTES, body: REQUEST,
      headers: {
        Accept: "text/xml", "Content-Type": "text/xml; charset=utf-8",
        "Accept-Encoding": "identity", SOAPAction: `"${SOAP_ACTION}"`,
        Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")}`,
      },
    })
  } catch { throw new ZeytunClientsReadError("upstream_unavailable") }
  if (response.status === 401 || response.status === 403) throw new ZeytunClientsReadError("authentication_required")
  if (!response.ok || response.status !== 200) throw new ZeytunClientsReadError("upstream_unavailable")
  return {
    payload: Buffer.from(decodeZeytunClientsSoap(response.bodyBytes), "utf8"),
    context: { organizationId: config.organizationId, observedAt: new Date().toISOString(), source: "live" as const },
    scopeKey: zeytunClientsScopeKey(config),
  }
}
