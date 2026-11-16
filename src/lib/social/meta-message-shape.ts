/**
 * The SHAPE of a Meta `message` that carried neither text nor a file we could take — for the log,
 * never its content.
 *
 * 2026-11-15 an Instagram customer's message landed as a bare «[media]», and nothing anywhere said
 * what it had been: the webhook body is not kept, and the Graph API returns the same message with an
 * empty `message` and no attachments. The next one names its attachment types, the payload keys and
 * the flags, so the parser can learn the form instead of guessing it. No URL, no text, no ids.
 */
type Rec = Record<string, unknown>

function record(value: unknown): Rec | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null
}

const SAFE_TOKEN_RE = /[^a-z0-9_.-]/gi

function token(value: unknown): string {
  return typeof value === "string" ? value.replace(SAFE_TOKEN_RE, "").slice(0, 40) || "?" : "?"
}

/**
 * The keys under a payload value, two levels down: `generic(elements[buttons+subtitle+title])`.
 * Keys only — never a value — so a card Meta sends in a form we do not read yet names its layout.
 */
function nestedKeys(value: unknown, depth: number): string {
  if (depth <= 0) return ""
  if (Array.isArray(value)) {
    const first = record(value[0])
    return first ? `[${Object.keys(first).map((k) => token(k) + nestedKeys(first[k], depth - 1)).sort().join("+")}]` : ""
  }
  const r = record(value)
  return r ? `(${Object.keys(r).map((k) => token(k) + nestedKeys(r[k], depth - 1)).sort().join("+")})` : ""
}

export function describeMetaMessageShape(message: unknown): string {
  const m = record(message)
  if (!m) return "message=none"
  const keys = Object.keys(m).map(token).sort().join(",")
  const attachments = Array.isArray(m.attachments) ? m.attachments : []
  const parts = attachments.slice(0, 5).map((raw) => {
    const a = record(raw)
    if (!a) return "?"
    const payload = record(a.payload)
    const payloadKeys = payload ? Object.keys(payload).map((k) => token(k) + nestedKeys(payload[k], 2)).sort().join("+") : ""
    return `${token(a.type)}{${payloadKeys}}`
  })
  const flags = ["is_unsupported", "is_deleted", "is_echo"].filter((flag) => m[flag] === true)
  return [
    `keys=${keys || "-"}`,
    `attachments=${parts.length ? parts.join(";") : "-"}`,
    ...(flags.length ? [`flags=${flags.join(",")}`] : []),
  ].join(" ")
}
