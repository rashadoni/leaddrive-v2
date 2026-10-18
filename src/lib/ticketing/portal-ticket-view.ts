import {
  ASSISTANT_ESCALATION_DESCRIPTION_HEAD,
  DESCRIPTION_CHAT_MARKERS,
  EMAIL_COMMENT_PREFIX,
  WHATSAPP_CHAT_DESCRIPTION_HEAD,
  WHATSAPP_INBOUND_DESCRIPTION_HEAD,
  WEB_CHAT_TRANSCRIPT_HEAD,
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

/**
 * U+2060 WORD JOINER: no width and no line break, so a text shows exactly the
 * same with it — and a token with it inside is no longer that token.
 */
const WORD_JOINER = "\u2060"

function withWordJoiner(token: string): string {
  return token[0] + WORD_JOINER + token.slice(1)
}

/**
 * The description the customer typed in the portal, as it is stored. The body
 * of an e-mail to a support intake address (`public/email-inbound`) is stored
 * the same way: anyone can send one, with no login.
 *
 * Nothing on a ticket says its description is the customer's: the agent's page
 * (`parseChatDescription`) and the portal (`portalDescriptionView`) decide from
 * the text itself whether a chat channel wrote it. A description with a line
 * «--- ИСТОРИЯ ЧАТА ---» followed by «[Оператор] …» or «[Da Vinci] …» lines
 * showed on the agent's page as a chat card with messages the team never
 * wrote; one in the website chat's format did the same, in the customer's own
 * portal too; one that began with a generated head («Создан из WhatsApp чата.»)
 * was withheld from the customer's own portal as the team's summary (until
 * 2026-10-19).
 *
 * Each of those tokens is stored with a WORD JOINER after its first character:
 * on screen the text is exactly what the customer typed, and no reader takes it
 * for a generated description. The readers are unchanged, so what the channels
 * write, and every description stored before, reads as it did. A description
 * with none of the tokens is stored as typed.
 *
 * The portal chat widget's «create ticket» button sends the chat it built in
 * the customer's browser through the same route; it is the customer's text as
 * much as anything typed, and reads on the agent's page as text.
 */
export function customerDescriptionForStorage(text: string): string {
  let stored = text
  for (const marker of DESCRIPTION_CHAT_MARKERS) {
    // One at a time: «--- X --- X ---» holds two that overlap.
    while (stored.includes(marker)) stored = stored.replace(marker, withWordJoiner(marker))
  }
  // `parseWebChatDescription` opens at a line that is exactly the head.
  stored = stored.replace(new RegExp(`^${WEB_CHAT_TRANSCRIPT_HEAD}$`, "gm"), withWordJoiner(WEB_CHAT_TRANSCRIPT_HEAD))
  const indent = stored.length - stored.trimStart().length
  const head = stored.slice(indent).split("\n", 1)[0].trim()
  if (GENERATED_DESCRIPTION_ORIGIN.some(([known]) => head === known)) {
    stored = stored.slice(0, indent + 1) + WORD_JOINER + stored.slice(indent + 1)
  }
  return stored
}

export const portalTicketSubject = customerFacingTicketSubject
