export type TikTokOrganicSurface = "comment" | "mention"

export interface ParsedTikTokOrganicEvent {
  surface: TikTokOrganicSurface
  externalId: string
  text: string
  authorName: string | null
  authorHandle: string | null
  authorAvatar: string | null
  url: string | null
  publishedAt: Date
  sourceMetadata: Record<string, unknown>
}

export interface ParsedTikTokLeadAdEvent {
  externalId: string
  tiktokLeadId: string
  contactName: string
  email: string | null
  phone: string | null
  formId: string | null
  campaignId: string | null
  adGroupId: string | null
  adId: string | null
  createdAt: Date
  sourceMetadata: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function dateValue(value: unknown): Date {
  const raw = typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value
  const date = typeof raw === "number" || typeof raw === "string" ? new Date(raw) : null
  return date && !Number.isNaN(date.getTime()) ? date : new Date()
}

function eventItems(body: unknown): Record<string, unknown>[] {
  const root = asRecord(body)
  const candidates = [
    root.events,
    root.items,
    root.data,
    root.leads,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(asRecord)
  }
  return [root]
}

function nestedEventData(item: Record<string, unknown>): Record<string, unknown> {
  return {
    ...item,
    ...asRecord(item.data),
    ...asRecord(item.comment),
    ...asRecord(item.mention),
    ...asRecord(item.lead),
  }
}

function fieldsRecord(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return asRecord(value)
  const result: Record<string, unknown> = {}
  for (const item of value) {
    const row = asRecord(item)
    const key = stringValue(row.name) || stringValue(row.key) || stringValue(row.field)
    const val = row.value ?? row.values
    if (key) result[key] = Array.isArray(val) ? val[0] : val
  }
  return result
}

function organicSurface(item: Record<string, unknown>, data: Record<string, unknown>): TikTokOrganicSurface {
  const raw = [
    item.event,
    item.type,
    item.event_type,
    item.object,
    data.event,
    data.type,
    data.event_type,
    data.object,
  ].map((value) => String(value || "").toLowerCase()).join(" ")
  return raw.includes("mention") ? "mention" : "comment"
}

export function parseTikTokOrganicWebhook(body: unknown): ParsedTikTokOrganicEvent[] {
  const parsed: Array<ParsedTikTokOrganicEvent | null> = eventItems(body).map((item) => {
    const data = nestedEventData(item)
    const surface = organicSurface(item, data)
    const commentId = stringValue(data.comment_id) || stringValue(data.commentId) || stringValue(data.id)
    const mentionId = stringValue(data.mention_id) || stringValue(data.mentionId)
    const eventId = surface === "mention" ? (mentionId || commentId) : commentId
    if (!eventId) return null

    const text = stringValue(data.text) || stringValue(data.comment_text) || stringValue(data.content)
    if (!text) return null

    const videoId = stringValue(data.video_id) || stringValue(data.videoId) || stringValue(data.item_id)
    const postId = stringValue(data.post_id) || stringValue(data.postId) || videoId
    const author = asRecord(data.author)
    const authorName = stringValue(data.author_name) || stringValue(data.authorName) || stringValue(author.name)
    const authorHandle = stringValue(data.author_handle) || stringValue(data.authorHandle) || stringValue(author.username) || stringValue(author.handle)
    const authorAvatar = stringValue(data.author_avatar) || stringValue(data.authorAvatar) || stringValue(author.avatar_url)
    const sourceUrl = stringValue(data.source_url) || stringValue(data.sourceUrl) || stringValue(data.post_url) || stringValue(data.video_url) || stringValue(data.url)

    return {
      surface,
      externalId: `tiktok_organic:${surface}:${eventId}`,
      text,
      authorName,
      authorHandle,
      authorAvatar,
      url: sourceUrl,
      publishedAt: dateValue(data.created_at || data.createdAt || item.created_at || item.createdAt),
      sourceMetadata: {
        platform: "tiktok",
        surface,
        provider: "tiktok_organic",
        commentId,
        mentionId,
        postId,
        videoId,
        parentCommentId: stringValue(data.parent_comment_id) || stringValue(data.parentCommentId),
        sourcePostUrl: sourceUrl,
        rawEventType: stringValue(item.event) || stringValue(item.type) || stringValue(item.event_type),
      },
    }
  })
  return parsed.filter((event): event is ParsedTikTokOrganicEvent => event !== null)
}

export function parseTikTokLeadAdWebhook(body: unknown): ParsedTikTokLeadAdEvent[] {
  const parsed: Array<ParsedTikTokLeadAdEvent | null> = eventItems(body).map((item) => {
    const data = nestedEventData(item)
    const fields = fieldsRecord(data.fields || data.field_data || data.answers)
    const leadId = stringValue(data.lead_id) || stringValue(data.leadId) || stringValue(data.id)
    if (!leadId) return null

    const email = stringValue(data.email) || stringValue(fields.email) || stringValue(fields.Email)
    const phone = stringValue(data.phone) || stringValue(data.phone_number) || stringValue(fields.phone) || stringValue(fields.phone_number) || stringValue(fields.Phone)
    const name =
      stringValue(data.full_name)
      || stringValue(data.name)
      || stringValue(fields.full_name)
      || stringValue(fields.name)
      || email
      || phone
      || "TikTok lead"

    const formId = stringValue(data.form_id) || stringValue(data.formId)
    const campaignId = stringValue(data.campaign_id) || stringValue(data.campaignId)
    const adGroupId = stringValue(data.adgroup_id) || stringValue(data.adGroupId) || stringValue(data.ad_group_id)
    const adId = stringValue(data.ad_id) || stringValue(data.adId)
    const createdAt = dateValue(data.created_at || data.createdAt || item.created_at || item.createdAt)

    return {
      externalId: `tiktok_business:lead_ad:${leadId}`,
      tiktokLeadId: leadId,
      contactName: name.slice(0, 200),
      email,
      phone,
      formId,
      campaignId,
      adGroupId,
      adId,
      createdAt,
      sourceMetadata: {
        platform: "tiktok",
        surface: "lead_ad",
        provider: "tiktok_business",
        tiktokLeadId: leadId,
        formId,
        campaignId,
        adGroupId,
        adId,
        fields,
      },
    }
  })
  return parsed.filter((event): event is ParsedTikTokLeadAdEvent => event !== null)
}
