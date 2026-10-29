import { createHash, randomBytes, randomInt } from "node:crypto"

/**
 * Pairing a branch screen: an administrator gets a one-time code, types it on
 * the tablet at the branch, and the tablet gets a secret it keeps in an
 * httpOnly cookie. Only SHA-256 digests of both are stored: the code is a short
 * human string (rate-limited, ten minutes), the secret 256 random bits.
 */

// No 0/O, 1/I/L: the code is read off one screen and typed into another.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
export const BRANCH_SCREEN_CODE_LENGTH = 8
export const BRANCH_SCREEN_CODE_LIFETIME_MS = 10 * 60_000
export const BRANCH_SCREEN_COOKIE = "ld_branch_screen"
export const BRANCH_SCREEN_COOKIE_PATH = "/api/v1/public/attendance-screen"
// Browsers cap a cookie's life at 400 days; a screen is re-paired after that.
export const BRANCH_SCREEN_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

const digest = (value: string) => createHash("sha256").update(value).digest("hex")

/** Shown as `XXXX-XXXX`. */
export function generateBranchScreenCode(): { code: string; codeHash: string } {
  let code = ""
  for (let index = 0; index < BRANCH_SCREEN_CODE_LENGTH; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return { code: `${code.slice(0, 4)}-${code.slice(4)}`, codeHash: hashBranchScreenCode(code)! }
}

/** Whatever was typed — lower case, spaces, the dash — or null when it cannot be a code. */
export function normalizeBranchScreenCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 32) return null
  const code = raw.toUpperCase().replace(/[\s-]/g, "")
  if (code.length !== BRANCH_SCREEN_CODE_LENGTH || [...code].some(char => !CODE_ALPHABET.includes(char))) return null
  return code
}

export function hashBranchScreenCode(raw: unknown): string | null {
  const code = normalizeBranchScreenCode(raw)
  return code ? digest(`mtm-branch-screen-code:v1:${code}`) : null
}

export function generateBranchScreenSecret(): { secret: string; secretHash: string } {
  const secret = `mtms1.${randomBytes(32).toString("base64url")}`
  return { secret, secretHash: hashBranchScreenSecret(secret)! }
}

export function hashBranchScreenSecret(secret: unknown): string | null {
  if (typeof secret !== "string" || !/^mtms1\.[A-Za-z0-9_-]{43}$/.test(secret)) return null
  return digest(`mtm-branch-screen-secret:v1:${secret}`)
}
