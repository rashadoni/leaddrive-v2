/**
 * The only application boundary allowed to request an external social reply.
 *
 * Routes create a PENDING outbox record only. A different human approver must
 * approve it, and only the cron worker may call a direct/provider publisher.
 */
import {
  enqueueOutboundSocialReply,
  type SocialReplyEnqueueRequest,
  type SocialReplyEnqueueResult,
} from "@/lib/social/outbound-service"

export const SOCIAL_OUTBOUND_QUEUE_IMPLEMENTED = true as const

export type { SocialReplyEnqueueRequest, SocialReplyEnqueueResult }

export async function requestSocialReplyEnqueue(
  request: SocialReplyEnqueueRequest,
): Promise<SocialReplyEnqueueResult> {
  return enqueueOutboundSocialReply(request)
}
