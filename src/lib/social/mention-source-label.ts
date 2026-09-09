/**
 * Человекочитаемый ответ на вопрос «откуда эта находка»: страница Facebook,
 * группа, аккаунт Instagram/TikTok или издание для новостей.
 *
 * Отдельного поля в базе нет — источник восстанавливается из тех же полей,
 * которые уже пишут адаптеры. Правило одно: лучше честный NULL, чем
 * правдоподобная подстановка. Клиентский отчёт не имеет права называть
 * поисковую фразу «страницей».
 */

export type MentionSourceKind = "page" | "group" | "account" | "publisher"

export type MentionSourceLabel = {
  label: string
  handle: string | null
  url: string | null
  kind: MentionSourceKind
}

export type MentionSourceInput = {
  platform: string
  url?: string | null
  canonicalUrl?: string | null
  parentPostUrl?: string | null
  authorName?: string | null
  authorHandle?: string | null
  /**
   * У поста автор И ЕСТЬ площадка (страница Facebook, аккаунт Instagram), а у
   * комментария автор — посторонний человек. Без этого различия строка
   * «Источник» повторяла бы «Автора» и выдавала комментатора за страницу.
   */
  isComment?: boolean
}

// Разбор имени страницы идёт по БЕЛОМУ списку формы, а не по чёрному списку
// разделов: чёрный список в адаптере работает только потому, что там путь
// обязан состоять ровно из одного сегмента, а здесь точкой входа служит
// ссылка на пост. Без позитивной проверки любой служебный путь Facebook
// (/login, /l.php, /plugins/…) печатался бы в клиентском отчёте как страница.
const FACEBOOK_PAGE_SLUG = /^[\p{L}\p{N}][\p{L}\p{N}._-]{4,}$/u
// Разделы самого Facebook, которые по форме проходят как имя страницы.
const FACEBOOK_NON_PAGE_SEGMENTS = new Set([
  "groups", "watch", "events", "marketplace", "reel", "reels", "share",
  "stories", "permalink.php", "story.php", "profile.php", "photo.php",
  "photo", "photos", "people", "pages", "hashtag", "search", "media",
  "video", "videos", "login", "l.php", "sharer.php", "sharer", "plugins",
  "help", "business", "notes", "privacy", "policies", "settings", "gaming",
  "watchparty", "campaign", "ads", "legal", "terms", "recover", "checkpoint",
])

function parsed(value: string | null | undefined): URL | null {
  if (!value || typeof value !== "string") return null
  try {
    const url = new URL(value.trim())
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

export function publisherHostFromUrl(value: string | null | undefined): string | null {
  const url = parsed(value)
  if (!url) return null
  const host = url.hostname.toLowerCase().replace(/\.$/u, "").replace(/^www\./u, "")
  return host || null
}

function text(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : ""
  return trimmed || null
}

function segments(url: URL): string[] {
  // WHATWG URL процентно кодирует всё, что вне ASCII, поэтому азербайджанское
  // или русское имя страницы без декодирования попало бы в отчёт как
  // %D0%9E%D0%B1%D0%B0…
  return url.pathname.split("/").filter(Boolean).map(segment => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  })
}

function facebookHost(url: URL): boolean {
  return /(^|\.)facebook\.com$/iu.test(url.hostname)
}

/**
 * Страница/группа Facebook из ЛЮБОГО facebook-URL — в отличие от адаптера,
 * который выводит handle автора и потому обязан отвергать URL поста.
 * Здесь пост как раз и есть точка входа: ссылка на комментарий или пост
 * несёт в себе владельца площадки.
 */
function facebookPage(slug: string | null | undefined): MentionSourceLabel | null {
  const value = text(slug)
  if (!value || !FACEBOOK_PAGE_SLUG.test(value)) return null
  if (FACEBOOK_NON_PAGE_SEGMENTS.has(value.toLowerCase())) return null
  return {
    label: value,
    handle: value,
    url: `https://www.facebook.com/${encodeURIComponent(value)}`,
    kind: "page",
  }
}

function facebookOwnerFromUrl(value: string | null | undefined): MentionSourceLabel | null {
  const url = parsed(value)
  if (!url || !facebookHost(url)) return null
  const path = segments(url)
  if (path.length === 0) return null

  const first = path[0].toLowerCase()
  if (first === "groups") {
    const groupId = text(path[1])
    if (!groupId) return null
    return {
      label: `facebook.com/groups/${groupId}`,
      handle: groupId,
      url: `https://www.facebook.com/groups/${encodeURIComponent(groupId)}`,
      kind: "group",
    }
  }
  // Современный корень страницы без короткого имени: /p/{Название}-{id}/.
  // Такой URL приходит от актора как facebookUrl, и без этой ветки он
  // деградировал бы до буквы «p».
  if (first === "p" || first === "pg") return facebookPage(path[1])
  // …/{page} и …/{page}/posts/… одинаково несут имя страницы первым сегментом.
  return facebookPage(path[0])
}

function tiktokAccountFromUrl(value: string | null | undefined): MentionSourceLabel | null {
  const url = parsed(value)
  if (!url || !/(^|\.)tiktok\.com$/iu.test(url.hostname)) return null
  const handle = segments(url).find(segment => segment.startsWith("@"))
  const account = text(handle?.slice(1))
  if (!account) return null
  return {
    label: `@${account}`,
    handle: account,
    url: `https://www.tiktok.com/@${account}`,
    kind: "account",
  }
}

function instagramAccountFromUrl(value: string | null | undefined): MentionSourceLabel | null {
  const url = parsed(value)
  if (!url || !/(^|\.)instagram\.com$/iu.test(url.hostname)) return null
  const path = segments(url)
  // /p/{shortcode}/ и /reel/{shortcode}/ владельца НЕ содержат — это тот
  // случай, где источник честнее не показывать вовсе.
  if (path.length === 0 || ["p", "reel", "reels", "tv", "explore", "stories"].includes(path[0].toLowerCase())) {
    return null
  }
  const account = text(path[0])
  if (!account) return null
  return {
    label: `@${account}`,
    handle: account,
    url: `https://www.instagram.com/${account}/`,
    kind: "account",
  }
}

function accountFromHandle(handle: string | null | undefined): MentionSourceLabel | null {
  const value = text(handle)?.replace(/^@/u, "")
  if (!value) return null
  return { label: `@${value}`, handle: value, url: null, kind: "account" }
}

/**
 * Возвращает источник находки либо null, когда достоверно определить его
 * нельзя (например, комментарий под постом Instagram: в ссылке вида
 * /p/{shortcode}/ владельца нет).
 */
export function mentionSourceLabel(input: MentionSourceInput): MentionSourceLabel | null {
  const platform = (input.platform ?? "").trim().toLowerCase()
  const primaryUrl = text(input.canonicalUrl) ?? text(input.url)
  const postUrl = text(input.parentPostUrl)
  // У поста автор — сама площадка, у комментария — посторонний человек.
  // Поэтому фолбэк на автора разрешён только для постов: иначе строка
  // «Источник» дублировала бы «Автора» и выдавала комментатора за страницу.
  const authorIsPublisher = input.isComment !== true

  if (platform === "web" || platform === "news" || platform === "google_alerts") {
    // Для web-новостей издание уже проставлено адаптером Google Alerts:
    // authorName = имя издания, authorHandle = домен.
    const host = text(input.authorHandle) ?? publisherHostFromUrl(primaryUrl ?? postUrl)
    const name = text(input.authorName) ?? host
    if (!name) return null
    return {
      label: name,
      handle: host,
      url: host ? `https://${host}` : null,
      kind: "publisher",
    }
  }

  if (platform === "facebook") {
    const owner = facebookOwnerFromUrl(postUrl) ?? facebookOwnerFromUrl(primaryUrl)
    if (owner) return owner
    if (!authorIsPublisher) return null
    return facebookPage(input.authorHandle)
      ?? accountFromHandle(input.authorHandle)
      ?? (text(input.authorName) ? { label: text(input.authorName)!, handle: null, url: null, kind: "page" } : null)
  }

  if (platform === "instagram") {
    return instagramAccountFromUrl(primaryUrl)
      ?? instagramAccountFromUrl(postUrl)
      ?? (authorIsPublisher ? accountFromHandle(input.authorHandle) : null)
  }

  if (platform === "tiktok") {
    return tiktokAccountFromUrl(primaryUrl)
      ?? tiktokAccountFromUrl(postUrl)
      ?? (authorIsPublisher ? accountFromHandle(input.authorHandle) : null)
  }

  const fallbackAccount = authorIsPublisher ? accountFromHandle(input.authorHandle) : null
  if (fallbackAccount) return fallbackAccount
  const host = publisherHostFromUrl(primaryUrl ?? postUrl)
  return host ? { label: host, handle: host, url: `https://${host}`, kind: "publisher" } : null
}
