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
  enabled?: boolean
}

export type SaveCommentKeywordRulesResult =
  | { ok: true; rules: CommentKeywordRule[] }
  | { ok: false; error: "too_many" | "empty" | "too_long" | "duplicate_keyword" | "unknown_channel" }

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
    if (!keyword || !message || keywordWords(keyword).length === 0) return { ok: false, error: "empty" }
    if (keyword.length > COMMENT_KEYWORD_MAX_CHARS || message.length > COMMENT_KEYWORD_MESSAGE_MAX_CHARS) {
      return { ok: false, error: "too_long" }
    }
    const channelConfigId = item.channelConfigId || null
    const key = `${channelConfigId ?? "*"}|${keywordWords(keyword).join(" ")}`
    if (seen.has(key)) return { ok: false, error: "duplicate_keyword" }
    seen.add(key)
    rules.push({ id: item.id || randomUUID(), keyword, message, channelConfigId, enabled: item.enabled !== false })
  }
  const channelIds = [...new Set(rules.map((r) => r.channelConfigId).filter((id): id is string => !!id))]
  if (channelIds.length > 0) {
    const owned = await prisma.channelConfig.count({
      where: { organizationId, id: { in: channelIds }, channelType: "instagram" },
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
