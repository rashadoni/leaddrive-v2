/**
 * Credential vault — N17 Phase 5 slice 1.
 *
 * AES-256-GCM symmetric encryption. Master key sourced from
 * `process.env.CRED_VAULT_KEY` (base64-encoded 32 bytes). Without
 * a key, slice 1 falls back to a deterministic dev key + emits
 * a single `console.warn` — lets local dev run without secrets
 * provisioning while making the prod-gap obvious in startup logs.
 *
 * GCM provides authenticated encryption: any bit-flip on the
 * ciphertext, IV, or AAD makes decryption fail with an error.
 * That's why we bind the AAD to (orgId, name) — the same ciphertext
 * pasted into a different credential's row won't decrypt.
 *
 * Slice 2: optional swap to AWS KMS / GCP KMS where the master key
 * never leaves the HSM and `encrypt/decrypt` become async network
 * calls. The function signatures here stay sync to match the slice-1
 * single-process model; the swap point is a `VaultClient` interface
 * the route would inject.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto"
import {
  SECRET_ALG_V1,
  type EncryptedSecret,
} from "./types"

const ALGORITHM = "aes-256-gcm" as const
const IV_BYTES = 12 // GCM standard nonce length
const TAG_BYTES = 16
const KEY_BYTES = 32

/**
 * Dev-fallback key when CRED_VAULT_KEY isn't set. SHA-256-style
 * deterministic 32-byte value — predictable enough to flag in logs,
 * NEVER used in production (slice-1 deploy checklist must set
 * CRED_VAULT_KEY before the migration runs).
 */
const DEV_FALLBACK_KEY = Buffer.from(
  "leaddrive-dev-fallback-key-DO-NOT-USE-IN-PROD-0001",
  "utf-8"
).subarray(0, KEY_BYTES) // truncate to 32 bytes deterministically

let warnedAboutFallback = false

function getMasterKey(): Buffer {
  const raw = process.env.CRED_VAULT_KEY
  if (!raw) {
    // Hard-fail in production — silently using a deterministic dev
    // key in prod would make every tenant's secret recoverable by
    // anyone who reads this source. Dev gets a warn + the fallback.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CRED_VAULT_KEY env var is required in production — must be a base64-encoded 32-byte secret"
      )
    }
    if (!warnedAboutFallback) {
      warnedAboutFallback = true
      // eslint-disable-next-line no-console
      console.warn(
        "[credentials/vault] CRED_VAULT_KEY not set — using dev fallback. " +
          "Production deployments MUST set this env var to a base64-encoded 32-byte secret."
      )
    }
    return DEV_FALLBACK_KEY
  }
  let key: Buffer
  try {
    key = Buffer.from(raw, "base64")
  } catch {
    throw new Error("CRED_VAULT_KEY is not valid base64")
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CRED_VAULT_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length})`
    )
  }
  return key
}

/**
 * Bind the AAD to (orgId, name) so the same ciphertext pasted into
 * a different credential row fails to decrypt — defends against an
 * attacker who can write to the named_credentials table but not
 * forge a new ciphertext.
 */
function buildAad(organizationId: string, name: string): Buffer {
  return Buffer.from(`${organizationId}\x00${name}`, "utf-8")
}

export interface EncryptInput {
  organizationId: string
  name: string
  plaintext: string
}

/**
 * Encrypt a plaintext secret under (orgId, name) AAD. Returns the
 * four blobs the route persists onto `named_credentials.secret*`.
 */
export function encryptSecret(input: EncryptInput): EncryptedSecret {
  if (!input.plaintext) {
    throw new Error("encryptSecret: plaintext is empty")
  }
  const key = getMasterKey()
  const iv = randomBytes(IV_BYTES)
  const aad = buildAad(input.organizationId, input.name)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(aad, { plaintextLength: Buffer.byteLength(input.plaintext) })
  const enc = Buffer.concat([cipher.update(input.plaintext, "utf-8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    alg: SECRET_ALG_V1,
  }
}

export interface DecryptInput {
  organizationId: string
  name: string
  encrypted: EncryptedSecret
}

/**
 * Decrypt a previously-encrypted secret. Throws when:
 *   - AAD doesn't match (wrong org or wrong name)
 *   - Ciphertext / IV / tag has been tampered with
 *   - Master key has rotated and ciphertext was encrypted under a
 *     prior key (caller surfaces as "re-enter the secret")
 *   - alg field is unknown (caller surfaces as migration required)
 */
export function decryptSecret(input: DecryptInput): string {
  if (input.encrypted.alg !== SECRET_ALG_V1) {
    throw new Error(`Unsupported secret algorithm: ${input.encrypted.alg}`)
  }
  const key = getMasterKey()
  const iv = Buffer.from(input.encrypted.iv, "base64")
  const tag = Buffer.from(input.encrypted.tag, "base64")
  const ct = Buffer.from(input.encrypted.ciphertext, "base64")
  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: ${iv.length}`)
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Invalid tag length: ${tag.length}`)
  }
  const aad = buildAad(input.organizationId, input.name)
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(ct), decipher.final()])
  return dec.toString("utf-8")
}

/**
 * Test-only: re-arm the one-shot fallback warning so the next
 * `getMasterKey()` call without env will warn again. Production
 * code never calls this.
 */
export function _resetFallbackWarningForTesting(): void {
  warnedAboutFallback = false
}
