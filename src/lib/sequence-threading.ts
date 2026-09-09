/**
 * E1 (Creatio 10X roadmap) — sequence email threading.
 *
 * Follow-up emails of a cadence land in the recipient's EXISTING thread:
 * we mint our own RFC Message-IDs (providers honor an explicit Message-ID
 * header), remember them per enrollment (SequenceEnrollment.threading), and
 * stamp In-Reply-To/References + «Re: root subject» on every follow-up whose
 * step says threadMode="continue". If the recipient has REPLIED into the
 * thread (inbound EmailLog whose inReplyTo points at one of our ids), the
 * next follow-up threads from THEIR reply — the chain looks like a live
 * conversation, not a blast.
 *
 * Pure helpers + one injectable-client resolver; callers own the RLS scope.
 */
import { randomBytes } from "crypto"
import type { PrismaClient } from "@prisma/client"
import { EMAIL_REPLY_DOMAIN } from "./email-reply-address"

/** References header keeps at most this many ids (RFC has no limit; MTAs truncate long headers). */
export const MAX_THREAD_IDS = 20

/**
 * A header-safe RFC message id: no control chars/CRLF, bounded length. Inbound
 * ids are recipient-controlled — anything unsafe is IGNORED (the follow-up
 * falls back to our own last id) rather than being allowed to make sendEmail's
 * header sanitizer throw on every retry and brick the enrollment.
 */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 32 || c === 127) return true
  }
  return false
}

export function isSafeRfcMessageId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length >= 3 &&
    id.length <= 500 &&
    // no whitespace (incl. CR/LF) and no control chars — either would blow up
    // the header sanitizer downstream
    !/\s/.test(id) &&
    !hasControlChars(id)
  )
}

/** Extract the FIRST <id> token from a raw In-Reply-To/References header value. */
export function firstRfcMessageId(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const m = raw.match(/<[^<>\s]{1,498}>/)
  return m && isSafeRfcMessageId(m[0]) ? m[0] : null
}

export type ThreadMode = "continue" | "new"

export interface ThreadingState {
  /** Subject of the thread's first email — follow-ups become «Re: <this>». */
  rootSubject: string
  /** Message-IDs we minted for this enrollment, oldest → newest (cap MAX_THREAD_IDS). */
  messageIds: string[]
}

/** Tolerant parse of whatever is stored on the enrollment. */
export function parseThreading(raw: unknown): ThreadingState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const rootSubject = typeof o.rootSubject === "string" ? o.rootSubject : ""
  const messageIds = Array.isArray(o.messageIds)
    ? o.messageIds.filter((m): m is string => typeof m === "string" && m.length > 0).slice(-MAX_THREAD_IDS)
    : []
  if (!rootSubject && messageIds.length === 0) return null
  return { rootSubject, messageIds }
}

/** Mint an RFC 5322 Message-ID on our reply domain (providers honor it). */
export function generateSequenceMessageId(domain?: string): string {
  const host = domain || EMAIL_REPLY_DOMAIN
  return `<seq.${Date.now().toString(36)}.${randomBytes(9).toString("base64url")}@${host}>`
}

/** «Re: root» unless the subject already carries a re-prefix (any case, also «Отв:»). */
export function reSubject(rootSubject: string): string {
  return /^\s*(re|отв)\s*:/i.test(rootSubject) ? rootSubject : `Re: ${rootSubject}`
}

export interface ThreadPlan {
  /** Headers to pass to sendEmail (always carries our Message-ID). */
  headers: Record<string, string>
  /** Subject to actually send (rewritten to «Re: …» when continuing). */
  subject: string
  /** New enrollment.threading value to persist AFTER a successful send. */
  nextThreading: ThreadingState
}

/**
 * Build the headers/subject for the email about to go out and the state to
 * persist once it is sent.
 *
 * @param replyTargetId  Message-ID of the recipient's own reply inside this
 *                       thread (from resolveReplyTarget) — when present, the
 *                       follow-up threads from it instead of our last send.
 */
export function planThreadedSend(args: {
  threading: ThreadingState | null
  mode: ThreadMode
  subject: string
  newMessageId: string
  replyTargetId?: string | null
}): ThreadPlan {
  const { threading, mode, subject, newMessageId, replyTargetId } = args
  const headers: Record<string, string> = { "Message-ID": newMessageId }

  const continuing = mode === "continue" && threading && threading.messageIds.length > 0
  if (!continuing) {
    return {
      headers,
      subject,
      nextThreading: { rootSubject: subject, messageIds: [newMessageId] },
    }
  }

  const anchor = replyTargetId || threading.messageIds[threading.messageIds.length - 1]
  // References = our chain (+ the recipient's reply id when threading from it),
  // oldest first per RFC 5322 convention.
  const references = [...threading.messageIds]
  if (replyTargetId && !references.includes(replyTargetId)) references.push(replyTargetId)
  headers["In-Reply-To"] = anchor
  headers["References"] = references.slice(-MAX_THREAD_IDS).join(" ")

  return {
    headers,
    subject: threading.rootSubject ? reSubject(threading.rootSubject) : subject,
    nextThreading: {
      rootSubject: threading.rootSubject || subject,
      messageIds: [...threading.messageIds, newMessageId].slice(-MAX_THREAD_IDS),
    },
  }
}

/**
 * The recipient's most recent reply INSIDE this thread, if any: an inbound
 * EmailLog whose In-Reply-To points at one of our minted ids. Scoped strictly
 * to (org, contact) — a stranger's or another tenant's reply never anchors
 * the thread. Returns the reply's Message-ID or null.
 */
export async function resolveReplyTarget(
  client: Pick<PrismaClient, "emailLog">,
  args: { organizationId: string; contactId?: string | null; threading: ThreadingState | null },
): Promise<string | null> {
  const { organizationId, contactId, threading } = args
  if (!contactId || !threading || threading.messageIds.length === 0) return null
  const reply = await client.emailLog.findFirst({
    where: {
      organizationId,
      contactId,
      direction: "inbound",
      inReplyTo: { in: threading.messageIds },
      messageId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { messageId: true },
  })
  // The stored id is recipient-controlled — an unsafe one is ignored (the
  // follow-up anchors on our own last id) instead of poisoning the headers.
  return isSafeRfcMessageId(reply?.messageId) ? reply.messageId : null
}
