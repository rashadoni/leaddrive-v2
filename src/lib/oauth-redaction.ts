const OAUTH_SECRET_KEYS = [
  "access_token",
  "appsecret_proof",
  "client_secret",
  "code",
  "fb_exchange_token",
  "id_token",
  "refresh_token",
  "token",
].join("|")

const URL_CREDENTIAL_RE = new RegExp(`([?&](?:${OAUTH_SECRET_KEYS})=)([^&#\\s"'<>]+)`, "gi")
const JSON_CREDENTIAL_RE = new RegExp(`("(?:${OAUTH_SECRET_KEYS})"\\s*:\\s*")([^"]*)(")`, "gi")
const FIELD_CREDENTIAL_RE = new RegExp(`\\b(${OAUTH_SECRET_KEYS})(\\s*[:=]\\s*['"]?)([^'",&\\s}\\]]+)`, "gi")

export function redactOAuthProviderText(text: string): string {
  if (!text) return text
  return text
    .replace(URL_CREDENTIAL_RE, "$1[REDACTED]")
    .replace(JSON_CREDENTIAL_RE, "$1[REDACTED]$3")
    .replace(FIELD_CREDENTIAL_RE, "$1$2[REDACTED]")
}
