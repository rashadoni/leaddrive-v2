export const MAX_CONVERSATION_TAGS = 25
export const MAX_CONVERSATION_TAG_LENGTH = 48

export type ConversationTagsValidation =
  | { ok: true; tags: string[] }
  | { ok: false; error: string }

export function normalizeConversationTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ")
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    normalized.push(tag)
  }

  return normalized
}

export function validateConversationTagsInput(value: unknown): ConversationTagsValidation {
  if (!Array.isArray(value)) {
    return { ok: false, error: "tags must be an array" }
  }

  if (value.length > MAX_CONVERSATION_TAGS) {
    return { ok: false, error: `tags must contain at most ${MAX_CONVERSATION_TAGS} items` }
  }

  if (!value.every((item) => typeof item === "string")) {
    return { ok: false, error: "tags must contain only strings" }
  }

  const tags = normalizeConversationTags(value)
  const tooLong = tags.find((tag) => tag.length > MAX_CONVERSATION_TAG_LENGTH)
  if (tooLong) {
    return { ok: false, error: `tag must be ${MAX_CONVERSATION_TAG_LENGTH} characters or fewer` }
  }

  return { ok: true, tags }
}
