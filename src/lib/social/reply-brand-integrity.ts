const BRAND_NORMALIZATION_RE = /[^\p{L}\p{N}]+/gu

export const SUBJECT_BOUND_REPLY_PROMPT_VERSION = "social-reply-v3-strict-subject"
export const TENANT_RESPONDER_REPLY_PROMPT_VERSION = "social-reply-v4-tenant-responder"

export function normalizeBrandName(value: string): string {
  return value
    .replace(/[™®©]/g, " ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/ı/g, "i")
    .replace(BRAND_NORMALIZATION_RE, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function containsNormalizedPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false
  return ` ${text} `.includes(` ${phrase} `)
}

export function findForeignBrandMentions(
  replyText: string,
  targetBrandName: string,
  organizationBrandNames: string[],
): string[] {
  const normalizedReply = normalizeBrandName(replyText)
  const normalizedTarget = normalizeBrandName(targetBrandName)
  const seen = new Set<string>()

  return organizationBrandNames.filter((candidate) => {
    const normalizedCandidate = normalizeBrandName(candidate)
    if (!normalizedCandidate || seen.has(normalizedCandidate)) return false
    seen.add(normalizedCandidate)

    if (
      normalizedCandidate === normalizedTarget
      || normalizedCandidate.includes(normalizedTarget)
      || normalizedTarget.includes(normalizedCandidate)
    ) {
      return false
    }
    return containsNormalizedPhrase(normalizedReply, normalizedCandidate)
  })
}

export function isExternalCommentOrReply(input: {
  contentKind?: string | null
  sourceType?: string | null
}): boolean {
  const contentKind = input.contentKind?.trim().toUpperCase()
  if (contentKind === "COMMENT" || contentKind === "REPLY") return true

  const sourceType = input.sourceType?.trim().toLowerCase()
  return sourceType === "comment" || sourceType === "reply"
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function isOfficialAuthorReason(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("official_author")
}

function hasOfficialAuthorMetadata(metadata: Record<string, unknown>): boolean {
  const subjectRelevance = asRecord(metadata.subjectRelevance)
  const relevance = asRecord(metadata.relevance)
  return metadata.officialArchive === true
    || metadata.officialAuthor === true
    || isOfficialAuthorReason(metadata.officialAuthorReason)
    || isOfficialAuthorReason(metadata.relevanceReason)
    || isOfficialAuthorReason(metadata.reason)
    || isOfficialAuthorReason(subjectRelevance.reason)
    || isOfficialAuthorReason(relevance.reason)
}

function isDirectSocialPublication(input: {
  contentKind?: string | null
  sourceType?: string | null
}): boolean {
  if (isExternalCommentOrReply(input)) return false
  const contentKind = input.contentKind?.trim().toUpperCase()
  const sourceType = input.sourceType?.trim().toLowerCase()
  return contentKind === "POST"
    || contentKind === "VIDEO"
    // Global-search adapters historically persisted discovered social posts as
    // MENTION. An official-author stamp still proves that this row is the
    // brand's own direct publication.
    || contentKind === "MENTION"
    || sourceType === "post"
    || sourceType === "video"
    || sourceType === "mention"
}

export function isOwnedSocialContent(input: {
  accountId?: string | null
  contentKind?: string | null
  sourceType?: string | null
  sourceMetadata?: unknown
  replyIdentityAccountIds?: string[]
}): boolean {
  const metadata = asRecord(input.sourceMetadata)
  // Comments and replies authored by customers remain actionable even when
  // their provider payload inherits ownership metadata from an official post.
  // TikTok's `owner` flag is author-specific and identifies a real reply from
  // the official video owner.
  if (isExternalCommentOrReply(input)) return metadata.owner === true
  if (metadata.ownership === "owned" || metadata.authorScope === "official") return true
  if (
    input.accountId
    && input.replyIdentityAccountIds?.includes(input.accountId)
  ) return true

  // Archive/relevance stamps describe an official direct publication, not
  // every child object in its thread. Require publication provenance so
  // inherited stamps never suppress customer comments, replies, reviews or DMs.
  return isDirectSocialPublication(input) && hasOfficialAuthorMetadata(metadata)
}

export interface ManualTaskIntegrityInput {
  mention: {
    contentKind?: string | null
    sourceType?: string | null
    accountId?: string | null
    sourceMetadata?: unknown
  }
  replyIdentityAccountIds?: string[]
  subjectId: string | null
  subjectName: string | null
  draftSubjectId: string | null
  draftReplyText: string | null
  draftPromptVersion: string | null
  draftAgentId: string | null
  draftAgentBinding: string | null
  subjectAssignedAgentId: string | null
  draftSenderAccountId: string | null
  channelSenderAccountId: string | null
}

export interface ManualTaskIntegrity {
  safe: boolean
  reasons: Array<
    "owned_source"
    | "subject_missing"
    | "subject_mismatch"
    | "legacy_brand_binding"
    | "subject_agent_mismatch"
    | "official_sender_missing"
    | "official_sender_mismatch"
  >
  foreignBrandNames: string[]
}

export function assessManualTaskIntegrity(
  task: ManualTaskIntegrityInput,
  organizationBrandNames: string[],
): ManualTaskIntegrity {
  const reasons: ManualTaskIntegrity["reasons"] = []
  if (isOwnedSocialContent({
    accountId: task.mention.accountId,
    contentKind: task.mention.contentKind,
    sourceType: task.mention.sourceType,
    sourceMetadata: task.mention.sourceMetadata,
    replyIdentityAccountIds: task.replyIdentityAccountIds,
  })) reasons.push("owned_source")
  if (!task.subjectId || !task.subjectName) reasons.push("subject_missing")
  if (task.subjectId !== task.draftSubjectId) reasons.push("subject_mismatch")
  if (task.draftPromptVersion !== TENANT_RESPONDER_REPLY_PROMPT_VERSION) reasons.push("legacy_brand_binding")
  const expectedAgentBinding = task.subjectAssignedAgentId ? "SUBJECT" : "SAFE_DEFAULT"
  if (
    task.draftAgentBinding !== expectedAgentBinding
    || (task.subjectAssignedAgentId
      ? task.draftAgentId !== task.subjectAssignedAgentId
      : task.draftAgentId !== null)
  ) reasons.push("subject_agent_mismatch")
  if (!task.channelSenderAccountId) reasons.push("official_sender_missing")
  else if (task.draftSenderAccountId !== task.channelSenderAccountId) reasons.push("official_sender_mismatch")

  // Kept in the response contract for old clients. Monitored subjects are
  // reply targets/context, not responder identities, so their names are no
  // longer treated as forbidden brands in a tenant-level draft.
  void organizationBrandNames
  return { safe: reasons.length === 0, reasons, foreignBrandNames: [] }
}
