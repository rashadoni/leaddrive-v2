import {
  ASSISTANT_ESCALATION_DESCRIPTION_HEAD,
  EMAIL_COMMENT_PREFIX,
  WHATSAPP_CHAT_DESCRIPTION_HEAD,
  WHATSAPP_INBOUND_DESCRIPTION_HEAD,
  isOperatorSenderName,
  parseCommentSender,
  parseWebChatDescription,
  stripAssistantRoutingMarkers,
  type WebChatRole,
} from "@/lib/ticketing/chat-transcript"
import { customerFacingTicketSubject } from "@/lib/ticketing/customer-ticket-text"

/**
 * A ticket as its customer reads it in the portal.
 *
 * The stored ticket is written for the team: comments carry the sender prefix
 * the chat sync puts on them («[Клиент (WhatsApp)] …», «[Da Vinci Bot] …»), and a
 * ticket a chat opened has a description of Russian headers and routing details
 * («Триггеры: AI marker [ESCALATE], keyword:complaint»). The agent's page turns
 * that into a card in the agent's language; until 2026-10-17 the portal handed
 * it to the customer as it was, and showed Da Vinci's replies as the
 * customer's own messages (a comment with no `userId` was taken for the
 * customer's). The storage stays — other code reads it — and this is the
 * customer's view of it.
 */

export type PortalCommentAuthor = "agent" | "assistant" | "customer"

export type PortalCommentView = {
  text: string
  author: PortalCommentAuthor
  /** The channel a customer message came through ("WhatsApp", "Email"), when the record says. */
  channel: string | null
}

export function portalCommentView(comment: { comment: string; userId: string | null }): PortalCommentView {
  // Written by a person on the team: their words, exactly.
  if (comment.userId) return { text: comment.comment, author: "agent", channel: null }

  const raw = comment.comment
  if (raw.startsWith(EMAIL_COMMENT_PREFIX)) {
    return { text: raw.slice(EMAIL_COMMENT_PREFIX.length).trimStart(), author: "customer", channel: "Email" }
  }
  const sender = parseCommentSender(raw)
  // No prefix: the customer's own portal reply.
  if (!sender) return { text: raw, author: "customer", channel: null }
  if (sender.sender === "customer") return { text: sender.body, author: "customer", channel: sender.channel }
  if (isOperatorSenderName(sender.name)) return { text: sender.body, author: "agent", channel: null }
  return { text: stripAssistantRoutingMarkers(sender.body), author: "assistant", channel: null }
}

/** Where a ticket a chat opened came from — the portal says it in the customer's language. */
export type PortalTicketOrigin = "whatsapp" | "assistant_chat" | "website_chat"

/** A message of the website chat a ticket was opened from, as the visitor sent or read it. */
export type PortalChatTranscriptEntry = { text: string; author: PortalCommentAuthor; createdAt: string }

const WEBSITE_CHAT_AUTHOR: Record<WebChatRole, PortalCommentAuthor> = { visitor: "customer", bot: "assistant", agent: "agent" }

const GENERATED_DESCRIPTION_ORIGIN: ReadonlyArray<[head: string, origin: PortalTicketOrigin]> = [
  [WHATSAPP_INBOUND_DESCRIPTION_HEAD, "whatsapp"],
  [WHATSAPP_CHAT_DESCRIPTION_HEAD, "whatsapp"],
  [ASSISTANT_ESCALATION_DESCRIPTION_HEAD, "assistant_chat"],
  // The same writers before their headers were Russian.
  ["Created from WhatsApp chat.", "whatsapp"],
  ["Automatically created on AI chat escalation.", "assistant_chat"],
]

export type PortalDescriptionView = {
  description: string | null
  origin: PortalTicketOrigin | null
  /** The website chat the ticket was opened from; empty for every other ticket. */
  chatTranscript: PortalChatTranscriptEntry[]
}

/**
 * The description of a ticket a WhatsApp or Da Vinci chat opened is withheld:
 * it is the team's summary, and every message in it is also in the ticket's
 * conversation, which the customer does see.
 *
 * The website chat's description is the exception: its writer copies nothing
 * into comments, so the transcript in it is the only place the visitor's own
 * words are — withholding it would leave the customer a ticket with a subject
 * and no content. The customer gets the chat itself instead, message by
 * message as they saw it in the widget (everything a session holds is shown to
 * its visitor — public/web-chat/messages), and not the team's part: the
 * pre-chat form, the page address, the English labels and UTC timestamps.
 *
 * Any other description is the customer's or an agent's own text and is shown
 * as written.
 */
export function portalDescriptionView(description: string | null): PortalDescriptionView {
  if (!description) return { description: null, origin: null, chatTranscript: [] }
  const websiteChat = parseWebChatDescription(description)
  if (websiteChat) {
    return {
      description: null,
      origin: "website_chat",
      chatTranscript: websiteChat.messages
        .filter((message) => message.text)
        .map((message) => ({ text: message.text, author: WEBSITE_CHAT_AUTHOR[message.role], createdAt: message.at })),
    }
  }
  const head = description.trimStart().split("\n", 1)[0].trim()
  const generated = GENERATED_DESCRIPTION_ORIGIN.find(([known]) => head === known)
  return generated
    ? { description: null, origin: generated[1], chatTranscript: [] }
    : { description, origin: null, chatTranscript: [] }
}

export const portalTicketSubject = customerFacingTicketSubject
