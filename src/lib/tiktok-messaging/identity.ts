/** Browser-safe identity helpers. Native IDs can never collide with numeric legacy IDs. */
export const messagingConversationKey = (businessId: string, conversationId: string) => `tiktok-messaging:${encodeURIComponent(businessId)}:${encodeURIComponent(conversationId)}`
export const messagingMessageKey = (businessId: string, messageId: string) => `tiktok-messaging:${encodeURIComponent(businessId)}:${encodeURIComponent(messageId)}`

export function nativeTikTokReplyTarget(messages: readonly { metadata?: unknown }[]): string | null {
  for (const message of messages) {
    const meta = message.metadata && typeof message.metadata === "object" ? message.metadata as Record<string, unknown> : {}
    if (meta.provider === "tiktok_messaging" && typeof meta.businessId === "string" && typeof meta.providerConversationId === "string") {
      return messagingConversationKey(meta.businessId, meta.providerConversationId)
    }
  }
  return null
}
