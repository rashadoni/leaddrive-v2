import { EMAIL_COMMENT_PREFIX, parseCommentSender } from "@/lib/ticketing/chat-transcript"
import { isPublicTicketStatus, publicSlaPhase, type PublicSlaPhase, type PublicTicketStatus } from "@/lib/ticketing/portal-ticket-presentation"
import { portalCommentView, portalTicketSubject } from "@/lib/ticketing/portal-ticket-view"

/**
 * The demo's real ticket as its customer sees it — the prospect, who opened it
 * from their own WhatsApp (src/lib/demo-center/demo-whatsapp-agent.ts). The
 * portal's own rules: the customer-facing subject, a public status, the next
 * committed target only (no breach flag, no escalation level), public
 * comments in the customer's view. Never an id, the phone, the description,
 * an internal note or who on the team holds it.
 *
 * Pure: the demo page receives it from the server, and it is tested apart.
 */

export interface DemoWhatsAppTicketMessage {
  readonly author: "customer" | "assistant" | "agent"
  readonly text: string
  readonly at: string
}

export interface DemoWhatsAppTicketView {
  readonly number: string
  readonly subject: string
  readonly status: PublicTicketStatus | "unknown"
  readonly createdAt: string
  readonly sla: PublicSlaPhase
  readonly messageCount: number
  /** The latest public messages, oldest first. */
  readonly messages: readonly DemoWhatsAppTicketMessage[]
}

/**
 * The webhook files a message without words by a placeholder in Russian
 * («[Изображение]»); the demo is Azerbaijani, and says what it was.
 */
const MEDIA_PLACEHOLDERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\[Изображение\]$/, "Şəkil"],
  [/^\[Видео\]$/, "Video"],
  [/^\[(?:Аудио|Голосовое) сообщение\]$/, "Səsli mesaj"],
  [/^\[Документ: [^\]]*\]$/, "Sənəd"],
  [/^\[Стикер\]$/, "Stiker"],
  [/^\[Локация: [^\]]*\]$/, "Məkan"],
  [/^\[Контакт\]$/, "Kontakt"],
]

export function demoMediaLabel(text: string): string {
  const trimmed = text.trim()
  for (const [pattern, label] of MEDIA_PLACEHOLDERS) if (pattern.test(trimmed)) return label
  return text
}

/** How many of the latest messages the demo shows; the rest are counted. */
export const DEMO_WHATSAPP_TICKET_MESSAGES = 6

export function demoWhatsAppTicketView(row: {
  ticketNumber: string
  subject: string
  status: string
  createdAt: Date
  slaFirstResponseDueAt: Date | null
  firstResponseAt: Date | null
  slaDueAt: Date | null
  /** Public comments, newest first. */
  comments: ReadonlyArray<{ comment: string; userId: string | null; createdAt: Date }>
  publicCommentCount: number
}): DemoWhatsAppTicketView {
  return {
    number: row.ticketNumber,
    subject: demoMediaLabel(portalTicketSubject(row.subject)),
    status: isPublicTicketStatus(row.status) ? row.status : "unknown",
    createdAt: row.createdAt.toISOString(),
    sla: publicSlaPhase({
      status: row.status,
      firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
      slaFirstResponseDueAt: row.slaFirstResponseDueAt?.toISOString() ?? null,
      slaDueAt: row.slaDueAt?.toISOString() ?? null,
    }),
    messageCount: row.publicCommentCount,
    messages: row.comments
      .slice(0, DEMO_WHATSAPP_TICKET_MESSAGES)
      .reverse()
      .map((comment) => {
        // The demo files every customer message with its prefix, so a public
        // comment with neither a prefix nor a person is the system's (the
        // automatic acknowledgement): support, never «Siz».
        const view = comment.userId || parseCommentSender(comment.comment) || comment.comment.startsWith(EMAIL_COMMENT_PREFIX)
          ? portalCommentView(comment)
          : { text: comment.comment, author: "assistant" as const }
        return { author: view.author, text: demoMediaLabel(view.text), at: comment.createdAt.toISOString() }
      }),
  }
}
