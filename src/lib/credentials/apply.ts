/**
 * Apply a resolved credential to HTTP request headers — N17 Phase 5 slice 1.
 *
 * Pure header-building. No I/O. The HTTP client (`callExternalService`)
 * calls this to merge the auth header into the caller's request before
 * dispatching.
 *
 * Per-authType handling:
 *   bearer         → Authorization: Bearer <secret>
 *   basic          → Authorization: Basic base64(secret)  (secret = "user:pass")
 *   api_key_header → <config.headerName>: <secret>
 *   none           → no header added
 *
 * Caller-supplied headers ALWAYS win — the auth header is added only
 * when no header with the same name already exists. That matches the
 * principle of least surprise: a handler that explicitly sets
 * `Authorization` should be able to override the credential.
 */
import type { ResolvedCredential } from "./types"

export interface ApplyResult {
  headers: Record<string, string>
}

export function applyCredentialToHeaders(
  credential: ResolvedCredential,
  callerHeaders: Record<string, string> = {}
): ApplyResult {
  // Normalise caller header keys to lowercase for the override check —
  // HTTP headers are case-insensitive but we store them in lowercase
  // canonical form so the client doesn't emit two competing entries.
  const merged: Record<string, string> = {}
  const seenKeys = new Set<string>()
  for (const [k, v] of Object.entries(callerHeaders)) {
    const lower = k.toLowerCase()
    merged[lower] = v
    seenKeys.add(lower)
  }

  switch (credential.authType) {
    case "bearer": {
      requireSecret(credential)
      if (!seenKeys.has("authorization")) {
        merged["authorization"] = `Bearer ${credential.secret}`
      }
      break
    }
    case "basic": {
      requireSecret(credential)
      // Caller-supplied secret should be "user:pass" plaintext; we
      // base64 it before sending. Defense-in-depth: detect a malformed
      // colon-less value to surface a caller bug rather than emit a
      // garbage Authorization header.
      if (!credential.secret!.includes(":")) {
        throw new Error(
          `basic auth credential "${credential.name}" secret must be in "user:pass" form`
        )
      }
      if (!seenKeys.has("authorization")) {
        const encoded = Buffer.from(credential.secret!, "utf-8").toString("base64")
        merged["authorization"] = `Basic ${encoded}`
      }
      break
    }
    case "api_key_header": {
      requireSecret(credential)
      const headerName = readApiKeyHeaderName(credential)
      const lower = headerName.toLowerCase()
      if (!seenKeys.has(lower)) {
        merged[lower] = credential.secret!
      }
      break
    }
    case "none": {
      // No auth applied. baseUrl indirection is the only value here.
      break
    }
    default: {
      throw new Error(`Unsupported authType: ${credential.authType}`)
    }
  }

  return { headers: merged }
}

function requireSecret(c: ResolvedCredential): void {
  if (!c.secret) {
    throw new Error(`Credential "${c.name}" (${c.authType}) has no decrypted secret`)
  }
}

function readApiKeyHeaderName(c: ResolvedCredential): string {
  const cfg = c.authConfig as Record<string, unknown>
  const name = cfg?.headerName
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      `api_key_header credential "${c.name}" missing headerName in authConfig`
    )
  }
  // RFC 7230: header names are tokens — disallow CR/LF (header
  // injection) and other illegal chars defensively.
  if (!/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/.test(name)) {
    throw new Error(`Invalid headerName "${name}" — disallowed character`)
  }
  return name
}
