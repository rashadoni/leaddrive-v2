import { sendWhatsAppMessage } from "@/lib/whatsapp"
import {
  detectOmnichannelReplyLocale,
  guardOmnichannelCommitments,
  type OmnichannelCommitmentGuardResult,
} from "@/lib/inbox/omnichannel-commitment-rules"

type WhatsAppReopenNotificationInput = {
  organizationId: string
  to: string
  ticketNumber: string
  customerText: string
  contactId?: string
}

/**
 * Send the customer-facing ticket-reopen acknowledgement through the same
 * deterministic final commitment boundary as generated omnichannel replies.
 *
 * The ticket number and reopen state are trusted action results, but the
 * legacy copy also promised an unconfirmed near-term manager callback. Until
 * the guard supports typed confirmed-action fragments, fail closed on the
 * complete candidate rather than letting that promise bypass the boundary.
 */
export async function sendGuardedWhatsAppReopenNotification(
  input: WhatsAppReopenNotificationInput,
): Promise<OmnichannelCommitmentGuardResult> {
  const candidate = `Sorğunuz (${input.ticketNumber}) yenidən açıldı. Menecer tezliklə sizinlə əlaqə saxlayacaq.`
  const guarded = guardOmnichannelCommitments(candidate, {
    customerText: input.customerText,
    locale: detectOmnichannelReplyLocale(input.customerText),
  })

  await sendWhatsAppMessage({
    to: input.to,
    message: guarded.text,
    organizationId: input.organizationId,
    contactId: input.contactId,
  })

  return guarded
}
