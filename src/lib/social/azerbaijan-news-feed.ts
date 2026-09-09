export type AzerbaijanNewsFeedDefinition = {
  publisher: string
  publisherHost: string
  providerKey: string
  url: string
}

export type AzerbaijanNewsFeedItem = {
  publisher: string
  publisherHost: string
  providerKey: string
  url: string
  title: string
  description: string | null
  imageUrl: string | null
  publishedAt: Date
}

export const AZERBAIJAN_NEWS_FEEDS: AzerbaijanNewsFeedDefinition[] = [
  {
    publisher: "APA.AZ",
    publisherHost: "apa.az",
    providerKey: "apa",
    url: "https://apa.az/rss",
  },
  {
    publisher: "Banker.az",
    publisherHost: "banker.az",
    providerKey: "banker",
    url: "https://banker.az/feed/",
  },
  {
    publisher: "Qafqazinfo",
    publisherHost: "qafqazinfo.az",
    providerKey: "qafqazinfo",
    url: "https://qafqazinfo.az/rss",
  },
  {
    publisher: "Modern.az",
    publisherHost: "modern.az",
    providerKey: "modern",
    url: "https://modern.az/rss",
  },
]

function decodeXmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  }
  return value
    .replace(/&#(\d+);/gu, (_match, raw: string) => String.fromCodePoint(Number(raw)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, raw: string) => String.fromCodePoint(Number.parseInt(raw, 16)))
    .replace(/&([a-z]+);/giu, (match, entity: string) => named[entity.toLowerCase()] ?? match)
    // Qafqazinfo escapes the CDATA delimiters themselves. Decode entities
    // first so both literal and `&lt;![CDATA[...]]&gt;` wrappers are removed
    // before plainText strips HTML tags.
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
}

function plainText(value: string): string {
  return decodeXmlEntities(value).replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

function tagValue(block: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const value = block.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "iu"))?.[1]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function enclosureUrl(block: string): string | null {
  const tag = block.match(/<enclosure\b[^>]*>/iu)?.[0]
  return tag?.match(/\burl\s*=\s*(["'])(.*?)\1/iu)?.[2]?.trim() || null
}

function elementAttribute(block: string, tagName: string, attributeName: string): string | null {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const escapedAttribute = attributeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const tag = block.match(new RegExp(`<${escapedTag}\\b[^>]*>`, "iu"))?.[0]
  return tag?.match(new RegExp(`\\b${escapedAttribute}\\s*=\\s*(["'])(.*?)\\1`, "iu"))?.[2]?.trim() || null
}

function rssImageUrl(block: string): string | null {
  const imageBlock = tagValue(block, "image")
  return enclosureUrl(block)
    || (imageBlock ? tagValue(imageBlock, "url") : null)
    || elementAttribute(block, "media:content", "url")
    || elementAttribute(block, "media:thumbnail", "url")
}

function normalizePublisherUrl(raw: string, publisherHost: string): string | null {
  try {
    const url = new URL(decodeXmlEntities(raw))
    const host = url.hostname.toLowerCase().replace(/^www\./u, "")
    const expected = publisherHost.toLowerCase().replace(/^www\./u, "")
    if (url.protocol !== "https:" || (host !== expected && !host.endsWith(`.${expected}`))) return null
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

function normalizeImageUrl(raw: string | null, articleUrl: string): string | null {
  if (!raw) return null
  try {
    const url = new URL(decodeXmlEntities(raw), articleUrl)
    return url.protocol === "https:" ? url.toString() : null
  } catch {
    return null
  }
}

export function parseAzerbaijanNewsRss(
  xml: string,
  feed: AzerbaijanNewsFeedDefinition,
): AzerbaijanNewsFeedItem[] {
  const items: AzerbaijanNewsFeedItem[] = []
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)) {
    const block = match[1]
    const titleRaw = tagValue(block, "title")
    const linkRaw = tagValue(block, "link") || tagValue(block, "guid")
    const publishedRaw = tagValue(block, "pubDate")
      || tagValue(block, "published")
      || tagValue(block, "updated")
    if (!titleRaw || !linkRaw || !publishedRaw) continue

    const url = normalizePublisherUrl(linkRaw, feed.publisherHost)
    const publishedAt = new Date(decodeXmlEntities(publishedRaw))
    const title = plainText(titleRaw)
    if (!url || !title || !Number.isFinite(publishedAt.getTime())) continue

    const descriptionRaw = tagValue(block, "description")
      || tagValue(block, "content:encoded")
      || tagValue(block, "summary")
    const description = descriptionRaw ? plainText(descriptionRaw).slice(0, 1_200) || null : null
    items.push({
      publisher: feed.publisher,
      publisherHost: feed.publisherHost,
      providerKey: feed.providerKey,
      url,
      title,
      description,
      imageUrl: normalizeImageUrl(rssImageUrl(block), url),
      publishedAt,
    })
  }
  return items
}
