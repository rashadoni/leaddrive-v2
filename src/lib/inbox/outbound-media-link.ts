/**
 * A short-lived address at which Meta can fetch ONE file an agent is sending to a customer.
 *
 * Instagram and Messenger do not take the bytes of an attachment: the send call names a URL and
 * Meta downloads it. Our inbox files are sealed on disk and served only to a signed-in session, so
 * there is no such URL. This makes one — for the single file being sent, for a few minutes.
 *
 * The link is the capability, so it carries everything it grants and nothing else: organisation,
 * the stored file name and an expiry, under an HMAC keyed from the server's auth secret. It cannot
 * be turned into a link to another file or another organisation, and after the expiry it is dead.
 * The file is on its way to a customer outside the company anyway; what the link must not do is
 * outlive the send or reach a second file.
 */
import { createHmac, timingSafeEqual } from "crypto"

const LINK_TTL_MS = 10 * 60_000
const CONTEXT = "inbox-outbound-media:v1"
const STORED_NAME = /^[0-9a-f]{8,64}(?:\.[a-z0-9]{1,10})?$/
const UPLOAD_URL = /^\/uploads\/inbox\/([^/]+)\/([^/]+)$/

function secret(): string | null {
  const value = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  return value && value.length >= 16 ? value : null
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(`${CONTEXT}\n${payload}`).digest("base64url")
}

function publicBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://app.leaddrivecrm.org").replace(/\/+$/, "")
}

/**
 * The public address of an uploaded inbox file (`/uploads/inbox/<org>/<name>`), or null when the
 * file is not this organisation's or the server has no secret to sign with.
 */
export function createOutboundMediaLink(uploadUrl: string, organizationId: string, now = Date.now()): string | null {
  const key = secret()
  const match = UPLOAD_URL.exec(uploadUrl)
  if (!key || !match || match[1] !== organizationId || !STORED_NAME.test(match[2])) return null
  const payload = Buffer.from(JSON.stringify({ o: organizationId, f: match[2], e: now + LINK_TTL_MS })).toString("base64url")
  // The stored name ends the path so that whoever fetches it sees the file's extension.
  return `${publicBase()}/api/v1/public/inbox-media/${payload}.${sign(payload, key)}/${match[2]}`
}

/** What a presented token grants — null for a forged, altered or expired one. */
export function readOutboundMediaToken(
  token: string,
  now = Date.now(),
): { organizationId: string; uploadUrl: string; fileName: string } | null {
  const key = secret()
  const [payload, signature, ...rest] = token.split(".")
  if (!key || !payload || !signature || rest.length) return null
  const expected = Buffer.from(sign(payload, key))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { o?: unknown; f?: unknown; e?: unknown }
    if (typeof data.o !== "string" || typeof data.f !== "string" || typeof data.e !== "number") return null
    if (!data.o || !STORED_NAME.test(data.f) || data.e < now) return null
    return { organizationId: data.o, uploadUrl: `/uploads/inbox/${data.o}/${data.f}`, fileName: data.f }
  } catch {
    return null
  }
}
