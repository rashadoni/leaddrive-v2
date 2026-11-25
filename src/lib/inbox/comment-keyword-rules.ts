/**
 * Reading and saving the «word in a comment → message in Direct» rules. What a rule is, how a word
 * is matched and the limits are in lib/inbox/comment-keyword-model.
 */
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import {
  COMMENT_KEYWORD_MAX_CHARS,
  COMMENT_KEYWORD_MESSAGE_MAX_CHARS,
  COMMENT_KEYWORD_RULES_MAX,
  keywordWords,
  readCommentKeywordRules,
  type CommentKeywordRule,
} from "@/lib/inbox/comment-keyword-model"

export * from "@/lib/inbox/comment-keyword-model"

type Rec = Record<string, unknown>
function rec(value: unknown): Rec {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Rec : {}
}

export async function loadCommentKeywordRules(organizationId: string): Promise<CommentKeywordRule[]> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
  return readCommentKeywordRules(org?.settings)
}

export type CommentKeywordRuleInput = {
  id?: string | null
  keyword: string
  message: string
  channelConfigId?: string | null
  postId?: string | null
  postLabel?: string | null
  enabled?: boolean
}

export type SaveCommentKeywordRulesResult =
  | { ok: true; rules: CommentKeywordRule[] }
  | { ok: false; error: "too_many" | "empty" | "too_long" | "duplicate_keyword" | "unknown_channel" | "post_needs_page" }

/**
 * Replaces the organization's rule list. Two rules for the same word on the same page are refused:
 * which message a person would get must not depend on the order of a list.
 */
export async function saveCommentKeywordRules(
  organizationId: string,
  input: readonly CommentKeywordRuleInput[],
): Promise<SaveCommentKeywordRulesResult> {
  if (input.length > COMMENT_KEYWORD_RULES_MAX) return { ok: false, error: "too_many" }
  const rules: CommentKeywordRule[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const keyword = item.keyword.trim()
    const message = item.message.trim()
    // A sign such as «+» is a keyword too (commentHasKeyword matches it as a whole token), but one
    // with a space inside could never be one token.
    const words = keywordWords(keyword)
    if (!keyword || !message || (words.length === 0 && /\s/u.test(keyword))) return { ok: false, error: "empty" }
    if (keyword.length > COMMENT_KEYWORD_MAX_CHARS || message.length > COMMENT_KEYWORD_MESSAGE_MAX_CHARS) {
      return { ok: false, error: "too_long" }
    }
    const channelConfigId = item.channelConfigId || null
    const postId = item.postId?.trim() || null
    // A post belongs to one page: a rule for a post names that page too.
    if (postId && !channelConfigId) return { ok: false, error: "post_needs_page" }
    const postLabel = postId ? (item.postLabel?.trim().slice(0, 120) || null) : null
    const key = `${channelConfigId ?? "*"}|${postId ?? "*"}|${words.length ? words.join(" ") : keyword}`
    if (seen.has(key)) return { ok: false, error: "duplicate_keyword" }
    seen.add(key)
    rules.push({ id: item.id || randomUUID(), keyword, message, channelConfigId, postId, postLabel, enabled: item.enabled !== false })
  }
  const channelIds = [...new Set(rules.map((r) => r.channelConfigId).filter((id): id is string => !!id))]
  if (channelIds.length > 0) {
    const owned = await prisma.channelConfig.count({
      where: { organizationId, id: { in: channelIds }, channelType: { in: ["instagram", "facebook"] } },
    })
    if (owned !== channelIds.length) return { ok: false, error: "unknown_channel" }
  }
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
  if (!org) return { ok: false, error: "unknown_channel" }
  await prisma.organization.update({
    where: { id: organizationId },
    data: { settings: { ...rec(org.settings), commentKeywordRules: rules } },
  })
  return { ok: true, rules }
}
