import { request } from "node:https"
import { isIP } from "node:net"
import { contractAssert, identifier, type ReceiverEnvironment, type Submission } from "./contract"
import { prepareSubmission, type ReceiverBinding } from "./delivery"

/** Fixed, operator-provisioned VPN destination. Never accept this from a payload. */
export interface ReceiverTarget {
  integrationId: string
  organizationId: string
  environment: ReceiverEnvironment
  origin: string
  privateIpv4: string
}

export interface ReceiverCredentials {
  accessToken: string
  certificate: string | Buffer
  privateKey: string | Buffer
  ca: string | Buffer
}

export class ReceiverTransportError extends Error {
  constructor() {
    super("Customer receiving API transport failed; reconcile receipt before retry")
    this.name = "ReceiverTransportError"
  }
}

/** Deliberately narrow first profile: HTTPS 443, exact RFC1918 IPv4 and TLS DNS name. */
export function validateReceiverTarget(binding: ReceiverBinding, target: ReceiverTarget): URL {
  contractAssert(target.integrationId === binding.integrationId)
  contractAssert(target.organizationId === binding.organizationId && target.environment === binding.environment)
  let url: URL
  try { url = new URL(target.origin) } catch { throw new ReceiverTransportError() }
  contractAssert(url.protocol === "https:" && (url.port === "" || url.port === "443"))
  contractAssert(url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password)
  contractAssert(isIP(url.hostname) === 0 && url.hostname.length <= 253 && url.hostname.includes("."))
  contractAssert(url.hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
  contractAssert(isIP(target.privateIpv4) === 4)
  const [a, b] = target.privateIpv4.split(".").map(Number)
  contractAssert(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
  return url
}

/**
 * One bounded attempt. Resolves no DNS and follows no redirects. TLS verifies
 * the configured hostname against the configured CA while the socket uses the
 * exact approved private address. This does not provision or prove a VPN route.
 */
export async function sendReceiverSubmission(input: {
  binding: ReceiverBinding
  organizationId: string
  target: ReceiverTarget
  credentials: ReceiverCredentials
  correlationId: string
  submission: Submission
}): Promise<{ status: number; body: string; retryAfter?: string }> {
  const prepared = prepareSubmission(input.binding, input.organizationId, input.submission)
  const origin = validateReceiverTarget(input.binding, input.target)
  const correlationId = identifier(input.correlationId)
  const credentials = input.credentials
  contractAssert(typeof credentials.accessToken === "string" && credentials.accessToken.length >= 16 && credentials.accessToken.length <= 8192)
  contractAssert(/^[A-Za-z0-9._~+/-]+=*$/.test(credentials.accessToken))
  for (const material of [credentials.certificate, credentials.privateKey, credentials.ca]) {
    contractAssert((typeof material === "string" || Buffer.isBuffer(material)) && material.length > 0)
  }
  // Snapshot the pinned address before any asynchronous work or caller mutation.
  const address = input.target.privateIpv4
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (response?: { status: number; body: string; retryAfter?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(totalTimer)
      clearTimeout(connectTimer)
      if (response) resolve(response)
      else reject(new ReceiverTransportError())
    }
    let req: ReturnType<typeof request> | undefined
    const totalTimer = setTimeout(() => { finish(); req?.destroy() }, 30_000)
    const connectTimer = setTimeout(() => { finish(); req?.destroy() }, 5_000)
    try {
      req = request({
        protocol: "https:", hostname: origin.hostname, port: 443, servername: origin.hostname,
        path: prepared.relativePath, method: "PUT", agent: false,
        minVersion: "TLSv1.2", rejectUnauthorized: true,
        cert: credentials.certificate, key: credentials.privateKey, ca: credentials.ca,
        lookup: (_hostname, options, callback) => {
          // Node may request all addresses even with a single pinned destination.
          if (options.all) callback(null, [{ address, family: 4 }])
          else callback(null, address, 4)
        },
        headers: {
          "Content-Type": "application/json", "Accept": "application/json",
          "Content-Length": Buffer.byteLength(prepared.body, "utf8"),
          "Authorization": `Bearer ${credentials.accessToken}`,
          "Idempotency-Key": prepared.idempotencyKey, "X-Correlation-ID": correlationId,
        },
      }, (response) => {
        const chunks: Buffer[] = []
        let length = 0
        response.on("data", (chunk: Buffer) => {
          length += chunk.length
          if (length > 16 * 1024) { finish(); response.destroy(); req?.destroy(); return }
          chunks.push(chunk)
        })
        response.once("error", () => finish())
        response.once("aborted", () => finish())
        response.once("end", () => {
          const retryAfter = response.headers?.["retry-after"]
          finish({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"),
            ...(typeof retryAfter === "string" ? { retryAfter } : {}) })
        })
      })
      req.once("socket", (socket) => socket.once("secureConnect", () => clearTimeout(connectTimer)))
      req.once("error", () => finish())
      req.end(prepared.body)
    } catch {
      finish()
      req?.destroy()
    }
  })
}
