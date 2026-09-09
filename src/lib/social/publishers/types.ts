export interface SocialReplySenderAccount {
  id: string
  platform: string
  handle: string
  displayName: string | null
  /** Encrypted OAuth token as stored on SocialAccount (purpose `oauth:{platform}:{handle}`). */
  accessToken: string | null
  tokenExpiresAt?: Date | null
}

export interface SocialReplyPublishInput {
  /** Target object on the platform: comment/post id from SocialMention.externalId. */
  externalId: string
  /** SocialMention.sourceType — comment | post | mention | dm | manual | unknown. */
  sourceType: string
  sourceMetadata?: unknown
  replyText: string
  senderAccount: SocialReplySenderAccount
}

export interface SocialReplyPublishResult {
  ok: boolean
  /** Platform id of the created reply when available. */
  externalReplyId?: string
  error?: string
  /** True when a retry may succeed (network/rate limit), false for permanent failures. */
  retriable?: boolean
}

export interface SocialReplyPublisher {
  platform: string
  publishReply(input: SocialReplyPublishInput): Promise<SocialReplyPublishResult>
}
