/**
 * «A word in a comment → a ready message in Direct» (owner 2026-11-22, by the approved mock-up).
 *
 * The owner's reels say «write SAY / TAPŞIRIQ / GECƏ in Direct», and people write the word under
 * the reel instead. A rule names the word and the message; when a comment carries the word, the
 * message goes to its author as the comment's one private reply (Meta: one per comment, within
 * 7 days — lib/social/instagram-comments), and the comment is marked answered.
 *
 * What keeps this from being a spam cannon:
 *   • the text is the organization's own, typed by an administrator — no model writes it, so the
 *     price rule (lib/ai/offer-grounding) has nothing to check;
 *   • one message per person per rule per day, however many times they repeat the word;
 *   • a conversation whose «AI rejimi» is off stays silent (lib/inbox/conversation-auto-reply) —
 *     this writes to a customer by itself, so it asks the switch like every other automatic sender;
 *   • a failed read of anything means no message.
 *
 * Rules live in `Organization.settings.commentKeywordRules`: a handful per organization, read once
 * per incoming comment. This file is the pure part — the screen imports it; reading and saving are in
 * lib/inbox/comment-keyword-rules.
 */

export const COMMENT_KEYWORD_RULES_MAX = 20
export const COMMENT_KEYWORD_MAX_CHARS = 40
/** Instagram takes a Direct text of up to 1000 characters. */
export const COMMENT_KEYWORD_MESSAGE_MAX_CHARS = 1000
/** How long the same person does not get the same rule's message again. */
export const COMMENT_KEYWORD_REPEAT_MS = 24 * 60 * 60 * 1000

export type CommentKeywordRule = {
  id: string
  keyword: string
  message: string
  /** One connected page, or null for every page of the organization. */
  channelConfigId: string | null
  enabled: boolean
}

type Rec = Record<string, unknown>
function rec(value: unknown): Rec {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Rec : {}
}

const FOLD: Record<string, string> = {
  "ə": "e", "ı": "i", "i̇": "i", "ö": "o", "ü": "u", "ş": "s", "ç": "c", "ğ": "g", "ё": "е",
}

/**
 * The form two spellings of one word share: case and Azerbaijani diacritics do not matter — a
 * phone keyboard without «Ə» writes «GECE», and the reel said «GECƏ».
 */
export function foldKeyword(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("az")
    .replace(/i̇|[əıöüşçğё]/g, (ch) => FOLD[ch] ?? ch)
    .trim()
}

export function keywordWords(text: string): string[] {
  return foldKeyword(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/**
 * Does the comment carry the rule's word (or phrase) as whole words? «GECƏLƏR» is not «GECƏ».
 *
 * A keyword of signs only — «+», «++», «?» — is matched as a whole token between spaces (owner
 * 2026-11-25: reels ask to comment «+»): «+» and «+ maraqlıdır» carry it, «5+3» and «a+» do not.
 */
export function commentHasKeyword(text: string, keyword: string): boolean {
  const needle = keywordWords(keyword)
  if (needle.length === 0) {
    const sign = keyword.trim()
    if (!sign) return false
    return text.trim().split(/\s+/u).some((token) => token === sign)
  }
  const hay = keywordWords(text)
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true
  }
  return false
}

/** Stored rules, cleaned: anything malformed is dropped rather than half-applied. */
export function readCommentKeywordRules(orgSettings: unknown): CommentKeywordRule[] {
  const raw = rec(orgSettings).commentKeywordRules
  if (!Array.isArray(raw)) return []
  const out: CommentKeywordRule[] = []
  for (const item of raw) {
    const r = rec(item)
    const id = typeof r.id === "string" ? r.id : ""
    const keyword = typeof r.keyword === "string" ? r.keyword.trim() : ""
    const message = typeof r.message === "string" ? r.message.trim() : ""
    if (!id || !keyword || !message) continue
    if (keyword.length > COMMENT_KEYWORD_MAX_CHARS || message.length > COMMENT_KEYWORD_MESSAGE_MAX_CHARS) continue
    out.push({
      id,
      keyword,
      message,
      channelConfigId: typeof r.channelConfigId === "string" && r.channelConfigId ? r.channelConfigId : null,
      enabled: r.enabled !== false,
    })
    if (out.length >= COMMENT_KEYWORD_RULES_MAX) break
  }
  return out
}

/** The first enabled rule the comment matches on this page; a rule for one page beats a rule for all. */
export function matchCommentKeywordRule(
  rules: readonly CommentKeywordRule[],
  text: string,
  channelConfigId: string | null | undefined,
): CommentKeywordRule | null {
  const live = rules.filter((r) => r.enabled && (!r.channelConfigId || r.channelConfigId === channelConfigId))
  const ordered = [...live.filter((r) => r.channelConfigId), ...live.filter((r) => !r.channelConfigId)]
  return ordered.find((r) => commentHasKeyword(text, r.keyword)) ?? null
}

