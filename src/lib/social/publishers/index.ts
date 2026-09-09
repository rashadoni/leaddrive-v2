import { instagramReplyPublisher, facebookReplyPublisher } from "./meta"
import { youtubeReplyPublisher } from "./youtube"
import type { SocialReplyPublisher } from "./types"

export type { SocialReplyPublisher, SocialReplyPublishInput, SocialReplyPublishResult, SocialReplySenderAccount } from "./types"

/** Platforms with a working live publisher. Others fall back to dry-run. */
export const LIVE_REPLY_PLATFORMS = ["instagram", "facebook", "youtube"] as const

/** All platforms that can have a reply channel setting (sender account + send mode). */
export const SOCIAL_REPLY_PLATFORMS = ["instagram", "facebook", "twitter", "tiktok", "youtube", "vkontakte"] as const

const publishers: Record<string, SocialReplyPublisher> = {
  instagram: instagramReplyPublisher,
  facebook: facebookReplyPublisher,
  youtube: youtubeReplyPublisher,
}

/** Returns null for platforms without a live adapter yet (tiktok, twitter, vkontakte). */
export function getSocialReplyPublisher(platform: string): SocialReplyPublisher | null {
  return publishers[platform] ?? null
}
