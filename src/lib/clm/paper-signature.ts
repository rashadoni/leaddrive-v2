/**
 * «Подписан на бумаге» — the rules of recording a contract signed on paper
 * (owner 2026-11-26, mock approved; «только админу» for a draft).
 *
 * Until this, only our own e-signature could make a contract «Действующий».
 * Most contracts in Azerbaijan are signed on paper with a stamp, and every one
 * of them stayed «Одобрен» or «Черновик» for good — so its renewal reminders,
 * its automatic «Истёк» and the live-value analytics, which all read active
 * contracts only, never saw it.
 *
 *  - An approved contract may be recorded by anyone who may edit contracts:
 *    the approval chain already passed.
 *  - A draft — a contract signed before it ever reached the CRM — skips
 *    approval, so only an administrator may record it.
 *  - The signing date is a calendar day, not in the future; the scan is
 *    required: PDF, JPG or PNG, at most 10 MB.
 *
 * Pure: the route (src/app/api/v1/contracts/[id]/paper-signature/route.ts)
 * does the I/O.
 */

export const PAPER_SIGNED_BY_PREFIX = "paper:"
export const SIGNED_COPY_PURPOSE = "signed_copy"
export const SIGNED_COPY_MAX_BYTES = 10 * 1024 * 1024

/** mime → extensions the stored name may carry. */
export const SIGNED_COPY_TYPES: Readonly<Record<string, readonly string[]>> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
}

export type PaperSignatureRefusal =
  | "ADMIN_REQUIRED_FOR_DRAFT"
  | "NOT_SIGNABLE"
  | "SIGNED_AT_INVALID"
  | "SIGNED_AT_IN_FUTURE"
  | "FILE_REQUIRED"
  | "FILE_TOO_LARGE"
  | "FILE_TYPE_NOT_ALLOWED"

/**
 * Who may record which contract. `draft` skips approval, so it is an
 * administrator's call; `approved` is anyone's who may edit contracts.
 */
export function paperSignatureRefusal(status: string, role: string | null | undefined): PaperSignatureRefusal | null {
  if (status === "approved") return null
  if (status === "draft") return role === "admin" || role === "superadmin" ? null : "ADMIN_REQUIRED_FOR_DRAFT"
  return "NOT_SIGNABLE"
}

/**
 * "YYYY-MM-DD" → that day at 00:00 UTC, the way contract dates are stored.
 * A day after `today` (the caller's latest possible calendar day) is refused.
 */
export function parseSignedAt(
  raw: unknown,
  now: Date = new Date(),
): { ok: true; date: Date; day: string } | { ok: false; code: "SIGNED_AT_INVALID" | "SIGNED_AT_IN_FUTURE" } {
  if (typeof raw !== "string") return { ok: false, code: "SIGNED_AT_INVALID" }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!match) return { ok: false, code: "SIGNED_AT_INVALID" }
  const [, y, m, d] = match
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(m) - 1 ||
    date.getUTCDate() !== Number(d) ||
    Number(y) < 1990
  ) {
    return { ok: false, code: "SIGNED_AT_INVALID" }
  }
  // The latest calendar day anywhere on Earth right now is UTC+14; a person in
  // Baku at 01:00 is already on a day UTC has not reached.
  const latest = new Date(now.getTime() + 14 * 3_600_000)
  const latestDay = Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate())
  if (date.getTime() > latestDay) return { ok: false, code: "SIGNED_AT_IN_FUTURE" }
  return { ok: true, date, day: `${y}-${m}-${d}` }
}

/** The extension the stored scan will carry, or a refusal. */
export function signedCopyExtension(
  file: { name: string; type: string; size: number } | null | undefined,
): { ok: true; ext: string; mimeType: string } | { ok: false; code: "FILE_REQUIRED" | "FILE_TOO_LARGE" | "FILE_TYPE_NOT_ALLOWED" } {
  if (!file || file.size < 1) return { ok: false, code: "FILE_REQUIRED" }
  if (file.size > SIGNED_COPY_MAX_BYTES) return { ok: false, code: "FILE_TOO_LARGE" }
  const mimeType = file.type.toLowerCase().trim()
  const allowed = SIGNED_COPY_TYPES[mimeType]
  const dot = file.name.lastIndexOf(".")
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : ""
  if (!allowed || !allowed.includes(ext)) return { ok: false, code: "FILE_TYPE_NOT_ALLOWED" }
  return { ok: true, ext, mimeType }
}

/** The user id behind a paper signature, or null when the contract was not signed on paper. */
export function paperSignerUserId(signedBy: string | null | undefined): string | null {
  if (!signedBy || !signedBy.startsWith(PAPER_SIGNED_BY_PREFIX)) return null
  return signedBy.slice(PAPER_SIGNED_BY_PREFIX.length) || null
}
