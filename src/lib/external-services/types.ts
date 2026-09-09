/**
 * External services types — N17 Phase 5 slice 1.
 *
 * Slice 1 exposes a single low-level entrypoint (`callExternalService`)
 * that takes a resolved named credential + method/path/body and issues
 * an outbound HTTP request. Slice 2 generates per-operation typed
 * methods from an OpenAPI spec and routes them through the same
 * underlying client.
 */
import type { ResolvedCredential } from "@/lib/credentials/types"

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"

export interface ExternalServiceRequest {
  credential: ResolvedCredential
  method: HttpMethod
  /** Path relative to credential.baseUrl. Leading slash optional. */
  path: string
  /** Caller-supplied headers — override credential's auth header if same name. */
  headers?: Record<string, string>
  /** JSON body — engine stringifies + sets content-type. */
  jsonBody?: unknown
  /** Override timeout in ms. Default 10s, max 30s. */
  timeoutMs?: number
  /**
   * In-process test seam. Production callers omit this so the client uses the
   * DNS-validating, IP-pinned Node transport. Tests pass a mock so no real
   * network is dialled.
   */
  fetcher?: typeof fetch
}

export interface ExternalServiceResponse {
  status: number
  ok: boolean
  /** Lowercased header keys. */
  headers: Record<string, string>
  /** Decoded body — string for text/*, parsed JSON for application/json, null otherwise. */
  body: unknown
  durationMs: number
}

/** Hard ceiling on per-request wall clock, regardless of caller config. */
export const ABSOLUTE_REQUEST_TIMEOUT_MS = 30_000
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
