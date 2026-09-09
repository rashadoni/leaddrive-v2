const EMPTY_AUTH_ERROR_CODES = new Set(["undefined", "null"])

/**
 * Auth.js error values arrive from the URL and therefore cannot be trusted to
 * contain a real code. Older redirects emitted the literal strings
 * `undefined` and `null`; treating those as errors both confused users and
 * kept a broken query parameter alive across retries.
 */
export function normalizeLoginErrorCode(value: string | null | undefined): string | null {
  const code = value?.trim()
  if (!code || EMPTY_AUTH_ERROR_CODES.has(code)) return null
  return code
}
