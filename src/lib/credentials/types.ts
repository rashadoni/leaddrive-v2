/**
 * Named-credential types — N17 Phase 5 slice 1.
 *
 * `NamedCredential` row + ResolvedCredential (post-decrypt) + the
 * per-authType config shapes. Tests + the http client both consume
 * `ResolvedCredential`; only the routes touch `NamedCredentialRow`.
 */

export type AuthType = "bearer" | "basic" | "api_key_header" | "none"

/* ─── Per-authType config ─────────────────────────────────────────────── */

/** Bearer: no extra config — the secret IS the token. */
export interface BearerAuthConfig {
  /* empty marker */
}

/** Basic: no extra config — secret is "user:pass" plaintext, base64'd on apply. */
export interface BasicAuthConfig {
  /* empty marker */
}

/** API-key-in-custom-header: caller picks the header name (X-API-Key, x-auth, ...). */
export interface ApiKeyHeaderAuthConfig {
  headerName: string
}

/** none: explicit "no auth required" — credential is still useful for baseUrl indirection. */
export interface NoneAuthConfig {
  /* empty marker */
}

export type AuthConfig =
  | { type: "bearer"; config: BearerAuthConfig }
  | { type: "basic"; config: BasicAuthConfig }
  | { type: "api_key_header"; config: ApiKeyHeaderAuthConfig }
  | { type: "none"; config: NoneAuthConfig }

/* ─── Vault crypto ────────────────────────────────────────────────────── */

/**
 * Marker for the algorithm + version that produced a ciphertext blob.
 * Migration safety: a future v2 (e.g. ChaCha20-Poly1305 or KMS-backed)
 * picks a new tag, and `decryptSecret` dispatches by this field.
 */
export const SECRET_ALG_V1 = "aes-256-gcm-v1" as const

export interface EncryptedSecret {
  /** Base64 ciphertext. */
  ciphertext: string
  /** Base64 12-byte IV. Random per encryption. */
  iv: string
  /** Base64 16-byte GCM auth tag. */
  tag: string
  /** Algorithm marker. */
  alg: typeof SECRET_ALG_V1
}

/* ─── Resolved credential (plaintext, in-memory only) ─────────────────── */

/**
 * Credential after vault decryption. Lives only in the scope of one
 * outbound request. The HTTP client + apply() helpers consume this
 * shape; the route never persists it.
 */
export interface ResolvedCredential {
  id: string
  name: string
  organizationId: string
  baseUrl: string
  authType: AuthType
  authConfig: Record<string, unknown>
  /** Decrypted plaintext — null only for authType=none. */
  secret: string | null
}

/* ─── DB row shape (post-Prisma read) ─────────────────────────────────── */

export interface NamedCredentialRow {
  id: string
  organizationId: string
  name: string
  description: string | null
  baseUrl: string
  authType: string // checked CHECK in DB
  authConfig: unknown // JSONB
  secretCiphertext: string | null
  secretIv: string | null
  secretTag: string | null
  secretAlg: string | null
  isActive: boolean
}
