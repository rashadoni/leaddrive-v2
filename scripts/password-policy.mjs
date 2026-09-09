/** Shared password policy for application routes and privileged operator scripts. */
export const PASSWORD_MIN_GRAPHEMES = 12
export const PASSWORD_MAX_UTF8_BYTES = 72

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" })

const BUILTIN_COMPROMISED = new Set([
  "password", "password1", "password123", "p@ssword", "qwerty", "qwerty123",
  "123456", "1234567", "12345678", "123456789", "1234567890", "11111111",
  "00000000", "letmein", "welcome", "welcome1", "admin", "admin123",
  "iloveyou", "monkey", "dragon", "football", "baseball", "master",
  "login", "abc123", "qazwsx", "1q2w3e4r", "1qaz2wsx",
  "password123!", "changeme123!", "admin123!", "welcome123!",
  "leaddrive123!", "demo1234!", "demo2026!",
])

function compromisedPasswords() {
  const configured = (process.env.COMPROMISED_PASSWORDS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return configured.length ? new Set([...BUILTIN_COMPROMISED, ...configured]) : BUILTIN_COMPROMISED
}

/**
 * @param {unknown} password
 * @returns {string | null}
 */
export function passwordPolicyError(password) {
  if (typeof password !== "string") return "Password is required"

  // Reject huge public inputs before iteration or encoding. Every well-formed
  // UTF-8 representation is at least as large as its UTF-16 code-unit count.
  if (password.length > PASSWORD_MAX_UTF8_BYTES) {
    return `Password must be at most ${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes`
  }
  // bcrypt silently truncates after 72 bytes; never accept two strings whose
  // difference bcrypt would discard.
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_UTF8_BYTES) {
    return `Password must be at most ${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes`
  }
  // Do not let spaces, control/format characters, unpaired surrogates or
  // private-use characters pad an apparently short password.
  if (/[\p{C}\p{Z}]/u.test(password)) {
    return "Password must not contain whitespace, control, or invisible characters"
  }

  let graphemes = 0
  for (const _segment of GRAPHEME_SEGMENTER.segment(password)) graphemes++
  if (graphemes < PASSWORD_MIN_GRAPHEMES) {
    return `Password must be at least ${PASSWORD_MIN_GRAPHEMES} characters`
  }
  if (!/\p{Lu}/u.test(password)) return "Password must contain an uppercase letter"
  if (!/\p{Ll}/u.test(password)) return "Password must contain a lowercase letter"
  if (!/\p{Nd}/u.test(password)) return "Password must contain a number"
  if (!/[\p{P}\p{S}]/u.test(password)) return "Password must contain a special character"
  if (compromisedPasswords().has(password.toLowerCase())) {
    return "This password is too common or has appeared in a data breach. Choose a different password."
  }
  return null
}

/** Generate a random temporary credential that always satisfies this policy. */
export function generateStrongTemporaryPassword(randomBytes) {
  return `Aa1!${randomBytes(18).toString("base64url")}`
}
