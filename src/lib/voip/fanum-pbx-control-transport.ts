import { Agent, request as httpsRequest } from "node:https"
import { Readable } from "node:stream"
import { checkServerIdentity } from "node:tls"

import {
  FANUM_PBX_CONTROL_CA_PEM,
  FANUM_PBX_CONTROL_SERVERNAME,
} from "./fanum-pbx-control-ca"

type PinnedHttpsOptions = {
  caPem: string
  servername: string
}

/**
 * Build a fetch-shaped HTTPS client with one private trust root and one fixed
 * certificate name. The URL selects only the network address; it can never
 * weaken certificate verification or change the HTTP Host/SNI identity.
 *
 * Exported for a localhost TLS fixture. Production callers use the singleton
 * below with the reviewed public CA and fixed PBX control-plane name.
 */
export function createPinnedHttpsFetch(options: PinnedHttpsOptions) {
  if (!options.caPem.includes("-----BEGIN CERTIFICATE-----")) {
    throw new TypeError("Pinned PBX CA is missing")
  }
  if (!options.servername || /[\s\x00-\x1f\x7f]/.test(options.servername)) {
    throw new TypeError("Pinned PBX TLS server name is invalid")
  }

  const verifyServerIdentity = (
    _hostname: string,
    certificate: Parameters<typeof checkServerIdentity>[1],
  ) => checkServerIdentity(options.servername, certificate)
  const agent = new Agent({
    ca: options.caPem,
    checkServerIdentity: verifyServerIdentity,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    servername: options.servername,
  })

  return async function pinnedHttpsFetch(
    input: string | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = input instanceof URL ? new URL(input.toString()) : new URL(input)
    if (url.protocol !== "https:") {
      throw new TypeError("Pinned PBX control transport requires HTTPS")
    }
    if (url.username || url.password) {
      throw new TypeError("Pinned PBX control URL must not contain credentials")
    }
    if (init.redirect !== undefined && init.redirect !== "error") {
      throw new TypeError("Pinned PBX control transport forbids redirects")
    }

    const rawBody = init.body
    let body: string | Uint8Array | undefined
    if (rawBody === undefined || rawBody === null) {
      body = undefined
    } else if (typeof rawBody === "string") {
      body = rawBody
    } else if (rawBody instanceof Uint8Array) {
      body = rawBody
    } else {
      throw new TypeError("Pinned PBX control request body must be bytes or text")
    }

    const headers = new Headers(init.headers)
    // Keep the HTTP virtual host aligned with the pinned certificate identity,
    // even when the connection target is an IP address.
    headers.set("host", options.servername)

    return new Promise<Response>((resolve, reject) => {
      const request = httpsRequest(url, {
        agent,
        ca: options.caPem,
        checkServerIdentity: verifyServerIdentity,
        headers: Object.fromEntries(headers.entries()),
        method: init.method || "GET",
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        servername: options.servername,
        signal: init.signal ?? undefined,
      }, (incoming) => {
        const status = incoming.statusCode || 0
        if (status < 200 || status > 599) {
          incoming.destroy()
          reject(new Error("PBX control response status is invalid"))
          return
        }
        const responseHeaders = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item)
          } else if (value !== undefined) {
            responseHeaders.set(name, value)
          }
        }
        resolve(new Response(
          Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
          {
            headers: responseHeaders,
            status,
            statusText: incoming.statusMessage,
          },
        ))
      })
      request.once("error", reject)
      request.end(body)
    })
  }
}

export const secureFanumPbxControlFetch = createPinnedHttpsFetch({
  caPem: FANUM_PBX_CONTROL_CA_PEM,
  servername: FANUM_PBX_CONTROL_SERVERNAME,
})
