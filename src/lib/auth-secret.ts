/**
 * Server-only validation for the key shared by Auth.js, session fingerprints,
 * and MTM mobile JWTs. Do not import this module from client components.
 */

const PRODUCTION_PLACEHOLDERS = new Set([
  "change-me-in-production",
  "changeme",
  "dev-secret-change-in-production",
  "ld-dev-fallback-secret-change-me",
  "ld-fallback-secret-change-me",
  "nextauth-secret",
  "replace-me",
  "replace-with-a-random-secret",
  "secret",
  "your-secret-here",
])

export const MIN_PRODUCTION_AUTH_SECRET_BYTES = 32
const MIN_PRODUCTION_AUTH_SECRET_UNIQUE_CHARACTERS = 8

export class AuthSecretConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthSecretConfigurationError"
  }
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new AuthSecretConfigurationError("Auth secret validation is server-only")
  }
}

/**
 * Validate without normalising: silently trimming a signing key could make
 * different processes disagree about which bytes sign and verify tokens.
 *
 * Development and tests may use short local-only values. Production requires
 * at least 32 UTF-8 bytes and basic character diversity; operators should use
 * a randomly generated 32-byte value, not a human-authored passphrase.
 */
export function validateAuthSecret(
  rawSecret: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  assertServerRuntime()

  if (typeof rawSecret !== "string" || rawSecret.length === 0) {
    throw new AuthSecretConfigurationError("NEXTAUTH_SECRET is required")
  }
  if (/\s/u.test(rawSecret)) {
    throw new AuthSecretConfigurationError("NEXTAUTH_SECRET must not contain whitespace")
  }

  if (nodeEnv === "production") {
    if (PRODUCTION_PLACEHOLDERS.has(rawSecret.toLowerCase())) {
      throw new AuthSecretConfigurationError("NEXTAUTH_SECRET is a known placeholder")
    }

    const byteLength = new TextEncoder().encode(rawSecret).byteLength
    if (byteLength < MIN_PRODUCTION_AUTH_SECRET_BYTES) {
      throw new AuthSecretConfigurationError(
        `NEXTAUTH_SECRET must be at least ${MIN_PRODUCTION_AUTH_SECRET_BYTES} bytes in production`,
      )
    }
    if (new Set(rawSecret).size < MIN_PRODUCTION_AUTH_SECRET_UNIQUE_CHARACTERS) {
      throw new AuthSecretConfigurationError(
        "NEXTAUTH_SECRET has insufficient character diversity for production",
      )
    }
  }

  return rawSecret
}

export function requireAuthSecret(
  env: Pick<NodeJS.ProcessEnv, "NEXTAUTH_SECRET" | "NODE_ENV"> = process.env,
): string {
  return validateAuthSecret(env.NEXTAUTH_SECRET, env.NODE_ENV)
}
