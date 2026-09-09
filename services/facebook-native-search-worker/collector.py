"""Bounded collector for Facebook's authenticated native search UI."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence
from urllib.parse import parse_qs, quote, urlencode, urlsplit, urlunsplit

from config import RuntimeLimits


FACEBOOK_ORIGIN = "https://www.facebook.com"
MAX_ARTICLE_TEXT = 12_000
MAX_AUTHOR_NAME = 300
PARSER_VERSION = "facebook-native-dom-v1"

_STABLE_ID = re.compile(r"^(?:[0-9]{5,}|pfbid[A-Za-z0-9_-]{8,})$")
_AUTH_PATH_PARTS = {
    "login",
    "recover",
    "two_step_verification",
    "confirmemail",
    "auth_platform",
}
_TEMPORARY_BLOCK_PATH_PARTS = {
    "checkpoint",
    "temporarily_blocked",
}
_RESERVED_PROFILE_PATHS = {
    "about",
    "ads",
    "business",
    "events",
    "groups",
    "hashtag",
    "help",
    "home.php",
    "login",
    "marketplace",
    "messages",
    "notifications",
    "pages",
    "photo",
    "photo.php",
    "privacy",
    "reel",
    "search",
    "settings",
    "share",
    "story.php",
    "watch",
}
_RECENT_LABELS = (
    "recent posts",
    "recent publications",
    "недавние публикации",
    "последние публикации",
    "son gönderiler",
    "son paylaşımlar",
    "ən son paylaşımlar",
    "neueste beiträge",
    "publicaciones recientes",
    "publicações recentes",
    "publications récentes",
    "post recenti",
)
_PUBLIC_LABELS = (
    "public",
    "shared with public",
    "доступно всем",
    "общедоступно",
    "публично",
    "herkese açık",
    "ictimai",
    "ictimaiyyətə açıq",
    "öffentlich",
    "público",
    "pública",
    "publique",
    "pubblico",
    "publiczna",
)
_TIME_HINTS = (
    "ago",
    "hour",
    "minute",
    "day",
    "yesterday",
    "today",
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
    "мин",
    "час",
    "дн",
    "сегодня",
    "вчера",
    "январ",
    "феврал",
    "март",
    "апрел",
    "мая",
    "июн",
    "июл",
    "август",
    "сентябр",
    "октябр",
    "ноябр",
    "декабр",
    "saat",
    "dəqiqə",
    "gün",
    "iyul",
    "iyun",
)

_TEMPORARY_BLOCK_SCRIPT = """
() => {
  const text = String(document.body?.innerText || '').toLocaleLowerCase();
  const title = String(document.title || '').toLocaleLowerCase();
  const combined = `${title}\\n${text}`;
  const phrases = [
    "you're temporarily blocked",
    "you’re temporarily blocked",
    "temporarily blocked",
    "account temporarily locked",
    "we limit how often you can",
    "try again later",
    "вы временно заблокированы",
    "аккаунт временно заблокирован",
    "мы ограничиваем частоту",
    "повторите попытку позже",
    "geçici olarak engellendin",
    "daha sonra tekrar dene",
    "bu özelliği çok hızlı kullandın",
    "müvəqqəti olaraq bloklanıb",
    "sonra yenidən cəhd edin"
  ];
  return phrases.some((phrase) => combined.includes(phrase));
}
"""


class CollectorError(RuntimeError):
    """A classified error whose detail is safe to persist and log."""

    def __init__(self, code: str, *, fatal: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.fatal = fatal


@dataclass(frozen=True)
class StablePermalink:
    canonical_url: str
    external_id: str
    kind: str


@dataclass(frozen=True)
class ParsedArticle:
    item: dict[str, Any] | None
    rejection: str | None


@dataclass(frozen=True)
class CollectionResult:
    items: list[dict[str, Any]]
    coverage: dict[str, Any]


def _fold(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(normalized.split())


def _stable_id(value: str | None) -> str | None:
    if value and _STABLE_ID.fullmatch(value):
        return value
    return None


def normalize_facebook_permalink(value: str) -> StablePermalink | None:
    """Return only Facebook URLs containing a strong, stable publication ID."""

    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError):
        return None
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme not in {"http", "https"} or port not in {None, 80, 443}:
        return None
    if host not in {"facebook.com", "www.facebook.com", "m.facebook.com"}:
        return None

    segments = [segment for segment in parsed.path.split("/") if segment]
    lowered = [segment.casefold() for segment in segments]
    query = parse_qs(parsed.query, keep_blank_values=False)

    def first_query(name: str) -> str | None:
        values = query.get(name)
        return values[0] if values else None

    stable: str | None = None
    kind: str | None = None
    canonical_path: str | None = None
    canonical_query: list[tuple[str, str]] = []

    if len(segments) >= 2 and lowered[0] == "reel":
        stable = _stable_id(segments[1])
        kind = "reel"
        canonical_path = f"/reel/{segments[1]}/"
    elif "posts" in lowered:
        index = lowered.index("posts")
        if index + 1 < len(segments):
            stable = _stable_id(segments[index + 1])
            kind = "post"
            prefix = segments[: index + 2]
            canonical_path = "/" + "/".join(prefix) + "/"
    elif "videos" in lowered:
        index = lowered.index("videos")
        if index + 1 < len(segments):
            stable = _stable_id(segments[index + 1])
            kind = "video"
            prefix = segments[: index + 2]
            canonical_path = "/" + "/".join(prefix) + "/"
    elif parsed.path.casefold().rstrip("/") in {"/permalink.php", "/story.php"}:
        stable = _stable_id(first_query("story_fbid"))
        kind = "post"
        author_id = _stable_id(first_query("id"))
        canonical_path = "/permalink.php"
        if stable:
            canonical_query.append(("story_fbid", stable))
        if author_id:
            canonical_query.append(("id", author_id))
    elif (
        parsed.path.casefold().rstrip("/") in {"/photo", "/photo.php"}
        or "photos" in lowered
    ):
        stable = _stable_id(first_query("fbid"))
        if stable:
            kind = "photo"
            canonical_path = "/photo.php"
            canonical_query.append(("fbid", stable))
    elif parsed.path.casefold().rstrip("/") == "/watch":
        stable = _stable_id(first_query("v"))
        if stable:
            kind = "video"
            canonical_path = "/watch/"
            canonical_query.append(("v", stable))

    if not stable or not kind or not canonical_path:
        return None
    canonical = urlunsplit(
        (
            "https",
            "www.facebook.com",
            canonical_path,
            urlencode(canonical_query),
            "",
        )
    )
    return StablePermalink(
        canonical_url=canonical,
        external_id=f"facebook:{kind}:{stable}",
        kind=kind,
    )


def _public_evidence(labels: Sequence[str]) -> str | None:
    for raw in labels:
        folded = _fold(raw)
        if not folded or len(folded) > 200:
            continue
        if any(
            re.search(
                rf"(?:^|[\s,:;·()\-]){re.escape(candidate)}"
                rf"(?:$|[\s,:;·()\-])",
                folded,
            )
            for candidate in _PUBLIC_LABELS
        ):
            return raw.strip()[:200]
    return None


def _looks_like_time(value: str) -> bool:
    folded = _fold(value)
    if not folded or len(folded) > 100:
        return False
    return any(hint in folded for hint in _TIME_HINTS) or bool(
        re.search(r"\b\d{1,2}[:./-]\d{1,4}\b", folded)
    )


def _author_from_anchors(
    anchors: Sequence[Mapping[str, Any]],
    permalink: StablePermalink,
) -> tuple[str | None, str | None]:
    for anchor in anchors:
        href = anchor.get("href")
        text = anchor.get("text")
        if not isinstance(href, str) or not isinstance(text, str):
            continue
        name = " ".join(text.split()).strip()
        if not name or len(name) > MAX_AUTHOR_NAME or _looks_like_time(name):
            continue
        try:
            parsed = urlsplit(href)
        except ValueError:
            continue
        if (parsed.hostname or "").lower().rstrip(".") not in {
            "facebook.com",
            "www.facebook.com",
            "m.facebook.com",
        }:
            continue
        if normalize_facebook_permalink(href) is not None:
            continue
        parts = [part for part in parsed.path.split("/") if part]
        if parsed.path.casefold().rstrip("/") == "/profile.php":
            profile_id = _stable_id(parse_qs(parsed.query).get("id", [None])[0])
            if not profile_id:
                continue
            return name, f"{FACEBOOK_ORIGIN}/profile.php?id={quote(profile_id)}"
        if not parts or parts[0].casefold() in _RESERVED_PROFILE_PATHS:
            continue
        if len(parts) > 2:
            continue
        return name, f"{FACEBOOK_ORIGIN}/{quote(parts[0], safe='._-')}/"
    return None, None


def _published_label(
    anchors: Sequence[Mapping[str, Any]],
    permalink: StablePermalink,
) -> str | None:
    fallback: str | None = None
    for anchor in anchors:
        href = anchor.get("href")
        if not isinstance(href, str):
            continue
        normalized = normalize_facebook_permalink(href)
        if normalized is None or normalized.external_id != permalink.external_id:
            continue
        values = [anchor.get("ariaLabel"), anchor.get("text"), anchor.get("title")]
        for raw in values:
            if not isinstance(raw, str):
                continue
            candidate = " ".join(raw.split()).strip()
            if not candidate or len(candidate) > 100:
                continue
            if _looks_like_time(candidate):
                return candidate
            fallback = fallback or candidate
    return fallback


def _clean_article_text(value: str) -> str:
    value = value.replace("\x00", "")
    lines = [" ".join(line.split()) for line in value.splitlines()]
    compact: list[str] = []
    previous_blank = False
    for line in lines:
        is_blank = not line
        if is_blank and previous_blank:
            continue
        compact.append(line)
        previous_blank = is_blank
    return "\n".join(compact).strip()[:MAX_ARTICLE_TEXT]


def _date_precision(value: str | None) -> str:
    if not value:
        return "UNKNOWN"
    folded = _fold(value)
    if any(
        hint in folded
        for hint in (
            "ago",
            "minute",
            "hour",
            "yesterday",
            "today",
            "мин",
            "час",
            "сегодня",
            "вчера",
            "dəqiqə",
            "saat",
        )
    ):
        return "RELATIVE"
    if re.search(r"\b\d{1,2}:\d{2}\b", folded):
        return "EXACT"
    if _looks_like_time(folded):
        return "DATE"
    return "UNKNOWN"


def _outbound_links(anchors: Sequence[Mapping[str, Any]]) -> list[str]:
    output: list[str] = []
    for anchor in anchors:
        href = anchor.get("href")
        if not isinstance(href, str) or len(href) > 2048:
            continue
        try:
            parsed = urlsplit(href)
        except ValueError:
            continue
        host = (parsed.hostname or "").lower().rstrip(".")
        if (
            parsed.scheme not in {"http", "https"}
            or not host
            or parsed.username
            or parsed.password
            or host in {"facebook.com", "www.facebook.com", "m.facebook.com"}
            or host.endswith(".facebook.com")
        ):
            continue
        normalized = urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path or "/", parsed.query, "")
        )
        if normalized not in output:
            output.append(normalized)
        if len(output) >= 20:
            break
    return output


def parse_article_snapshot(
    snapshot: Mapping[str, Any],
    captured_at: str,
    discovered_at_scroll: int = 0,
) -> ParsedArticle:
    labels = snapshot.get("audienceLabels")
    anchors = snapshot.get("anchors")
    inner_text = snapshot.get("innerText")
    article_hash = snapshot.get("articleHtmlSha256")
    if (
        not isinstance(labels, list)
        or not all(isinstance(label, str) for label in labels)
        or not isinstance(anchors, list)
        or not isinstance(inner_text, str)
        or not isinstance(article_hash, str)
        or not re.fullmatch(r"[a-f0-9]{64}", article_hash)
    ):
        return ParsedArticle(None, "malformed")

    public_label = _public_evidence(labels)
    if public_label is None:
        return ParsedArticle(None, "not_explicitly_public")

    normalized_links: list[StablePermalink] = []
    for anchor in anchors:
        if not isinstance(anchor, dict):
            continue
        href = anchor.get("href")
        if not isinstance(href, str):
            continue
        normalized = normalize_facebook_permalink(href)
        if normalized and all(
            existing.external_id != normalized.external_id
            for existing in normalized_links
        ):
            normalized_links.append(normalized)
    if not normalized_links:
        return ParsedArticle(None, "no_strong_permalink")

    # A timestamp permalink usually appears before media/navigation links. When
    # several publication IDs are present, prefer the first strong URL rather
    # than guessing from volatile DOM class names.
    permalink = normalized_links[0]
    text = _clean_article_text(inner_text)
    if not text:
        return ParsedArticle(None, "empty_text")
    author_name, author_url = _author_from_anchors(anchors, permalink)
    published = _published_label(anchors, permalink)
    outbound_links = _outbound_links(anchors)
    raw_media = snapshot.get("mediaKinds", [])
    allowed_media = {"IMAGE", "VIDEO", "REEL", "LINK"}
    media_kinds: list[str] = []
    if isinstance(raw_media, list):
        for media_kind in raw_media:
            if (
                isinstance(media_kind, str)
                and media_kind in allowed_media
                and media_kind not in media_kinds
            ):
                media_kinds.append(media_kind)
    if permalink.kind == "reel" and "REEL" not in media_kinds:
        media_kinds.append("REEL")
    if permalink.kind == "video" and "VIDEO" not in media_kinds:
        media_kinds.append("VIDEO")
    if outbound_links and "LINK" not in media_kinds:
        media_kinds.append("LINK")

    item: dict[str, Any] = {
        "kind": permalink.kind.upper(),
        "externalId": permalink.external_id,
        "permalink": permalink.canonical_url,
        "authorName": author_name,
        "authorUrl": author_url,
        "text": text,
        "capturedAt": captured_at,
        "audience": {
            "kind": "PUBLIC",
            "evidenceLabel": public_label[:300],
        },
        "evidence": {
            "articleHtmlSha256": article_hash,
            "screenshotSha256": None,
            "parserVersion": PARSER_VERSION,
            "discoveredAtScroll": max(0, int(discovered_at_scroll)),
            "dateRaw": published[:160] if published else None,
            "datePrecision": _date_precision(published),
            "mediaKinds": media_kinds[:8],
            "outboundLinks": outbound_links,
        },
    }
    return ParsedArticle(item, None)


_SNAPSHOT_SCRIPT = """
async (article) => {
  const anchors = Array.from(article.querySelectorAll('a[href]'))
    .slice(0, 160)
    .map((anchor) => ({
      href: String(anchor.href || '').slice(0, 2048),
      text: String(anchor.innerText || anchor.textContent || '').trim().slice(0, 500),
      ariaLabel: String(anchor.getAttribute('aria-label') || '').slice(0, 300),
      title: String(anchor.getAttribute('title') || '').slice(0, 300),
    }));
  const audienceLabels = Array.from(
    article.querySelectorAll('[aria-label], [title], img[alt], svg[aria-label]')
  )
    .slice(0, 400)
    .flatMap((node) => [
      node.getAttribute('aria-label'),
      node.getAttribute('title'),
      node.getAttribute('alt'),
    ])
    .filter(Boolean)
    .map((value) => String(value).trim().slice(0, 300));
  for (const title of article.querySelectorAll('svg[role="img"] title')) {
    const value = String(title.textContent || '').trim().slice(0, 300);
    if (value) audienceLabels.push(value);
  }
  const htmlBytes = new TextEncoder().encode(String(article.outerHTML || ''));
  const htmlDigest = await crypto.subtle.digest('SHA-256', htmlBytes);
  const articleHtmlSha256 = Array.from(new Uint8Array(htmlDigest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const mediaKinds = [];
  if (article.querySelector('img[src]')) mediaKinds.push('IMAGE');
  if (article.querySelector('video, [aria-label*="video" i]')) mediaKinds.push('VIDEO');
  if (article.querySelector('a[href*="/reel/"]')) mediaKinds.push('REEL');
  return {
    innerText: String(article.innerText || '').slice(0, 25000),
    anchors,
    audienceLabels,
    articleHtmlSha256,
    mediaKinds,
  };
}
"""

_SWITCH_SCRIPT = """
(element) => {
  const labelledBy = String(element.getAttribute('aria-labelledby') || '')
    .split(/\\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.innerText || '')
    .join(' ');
  const parentText = String(element.parentElement?.innerText || '').slice(0, 500);
  return {
    label: [
      element.getAttribute('aria-label') || '',
      labelledBy,
      parentText,
    ].join(' ').trim(),
    checked: element.getAttribute('aria-checked'),
  };
}
"""


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _snapshot_fingerprint(snapshot: Mapping[str, Any]) -> str:
    anchors = snapshot.get("anchors")
    hrefs = []
    if isinstance(anchors, list):
        for anchor in anchors:
            if isinstance(anchor, dict) and isinstance(anchor.get("href"), str):
                hrefs.append(anchor["href"][:500])
    material = f"{snapshot.get('innerText', '')[:1000]}\n" + "\n".join(hrefs[:20])
    return hashlib.sha256(material.encode("utf-8", errors="replace")).hexdigest()


def _is_recent_label(value: str) -> bool:
    folded = _fold(value)
    return any(candidate in folded for candidate in _RECENT_LABELS)


def classify_session_safety(
    url: str,
    *,
    has_password_input: bool,
    has_temporary_block_text: bool,
) -> str | None:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return "SESSION_CHECK_FAILED"
    path_parts = {part.casefold() for part in parsed.path.split("/") if part}
    if path_parts & _TEMPORARY_BLOCK_PATH_PARTS or has_temporary_block_text:
        return "FACEBOOK_TEMPORARILY_BLOCKED"
    if path_parts & _AUTH_PATH_PARTS or has_password_input:
        return "FACEBOOK_AUTH_REQUIRED"
    return None


def apply_empty_results_circuit_breaker(
    coverage: dict[str, Any],
    minimum_scrolls: int,
) -> bool:
    if (
        coverage.get("recentPostsVerified") is True
        and int(coverage.get("completedScrolls", 0)) >= minimum_scrolls
        and int(coverage.get("articlesObserved", 0)) == 0
    ):
        coverage["deliveryStatus"] = "PARTIAL"
        coverage["deliveryReason"] = "SEARCH_RESULTS_EMPTY_ANOMALY"
        coverage["stopReason"] = "empty_results_anomaly"
        return True
    return False


class FacebookNativeCollector:
    """Attach to one persistent Chrome context and collect one query at a time."""

    def __init__(self, cdp_url: str, limits: RuntimeLimits) -> None:
        self.cdp_url = cdp_url
        self.limits = limits
        self._playwright: Any = None
        self._browser: Any = None
        self._page: Any = None

    def __enter__(self) -> "FacebookNativeCollector":
        try:
            from playwright.sync_api import sync_playwright

            self._playwright = sync_playwright().start()
            self._browser = self._playwright.chromium.connect_over_cdp(
                self.cdp_url,
                timeout=self.limits.navigation_timeout_seconds * 1000,
            )
            if len(self._browser.contexts) != 1:
                raise CollectorError("CDP_CONTEXT_INVALID", fatal=True)
            context = self._browser.contexts[0]
            self._page = context.new_page()
            self._page.set_default_timeout(
                self.limits.navigation_timeout_seconds * 1000
            )
            self._assert_safe_session()
            return self
        except CollectorError:
            self.__exit__(None, None, None)
            raise
        except Exception as exc:
            self.__exit__(None, None, None)
            raise CollectorError("CDP_UNAVAILABLE", fatal=True) from exc

    def __exit__(self, *_: object) -> None:
        # Never call browser.close(): this worker does not own the persistent
        # Chrome process. It closes only the tab it created and disconnects.
        if self._page is not None:
            try:
                self._page.close()
            except Exception:
                pass
            self._page = None
        if self._playwright is not None:
            try:
                self._playwright.stop()
            except Exception:
                pass
            self._playwright = None
        self._browser = None

    def _assert_safe_session(self) -> None:
        if self._page is None:
            raise CollectorError("CDP_PAGE_UNAVAILABLE", fatal=True)
        try:
            code = classify_session_safety(
                self._page.url,
                has_password_input=(
                    self._page.locator('input[type="password"]').count() > 0
                ),
                has_temporary_block_text=bool(
                    self._page.evaluate(_TEMPORARY_BLOCK_SCRIPT)
                ),
            )
            if code:
                raise CollectorError(code, fatal=True)
        except CollectorError:
            raise
        except Exception as exc:
            raise CollectorError("SESSION_CHECK_FAILED", fatal=True) from exc

    def _verify_search_route(self, query: str, *, require_filters: bool = False) -> None:
        parsed = urlsplit(self._page.url)
        if (
            (parsed.hostname or "").lower() not in {"facebook.com", "www.facebook.com"}
            or not parsed.path.startswith("/search/top")
        ):
            raise CollectorError("SEARCH_ROUTE_CHANGED", fatal=True)
        current_query = parse_qs(parsed.query).get("q", [""])[0]
        if _fold(current_query) != _fold(query):
            raise CollectorError("SEARCH_QUERY_MISMATCH", fatal=True)
        if require_filters and not parse_qs(parsed.query).get("filters"):
            raise CollectorError("RECENT_POSTS_FILTER_URL_MISSING", fatal=True)

    def _recent_switch(self) -> Any:
        switches = self._page.locator('[role="switch"]')
        count = min(switches.count(), 30)
        for index in range(count):
            switch = switches.nth(index)
            info = switch.evaluate(_SWITCH_SCRIPT)
            if (
                isinstance(info, dict)
                and isinstance(info.get("label"), str)
                and _is_recent_label(info["label"])
            ):
                return switch
        raise CollectorError("RECENT_POSTS_FILTER_UNAVAILABLE", fatal=True)

    def _ensure_recent_posts(self, query: str) -> None:
        switch = self._recent_switch()
        checked = switch.get_attribute("aria-checked")
        if checked != "true":
            switch.click(timeout=self.limits.navigation_timeout_seconds * 1000)
            self._page.wait_for_timeout(2500)
            self._assert_safe_session()
            self._verify_search_route(query, require_filters=True)
            switch = self._recent_switch()
            checked = switch.get_attribute("aria-checked")
        if checked != "true":
            raise CollectorError("RECENT_POSTS_FILTER_NOT_ACTIVE", fatal=True)
        self._verify_search_route(query, require_filters=True)

    def _harvest(
        self,
        feed: Any,
        captured_at: str,
        seen_snapshots: set[str],
        seen_items: set[str],
        items: list[dict[str, Any]],
        coverage: dict[str, Any],
        discovered_at_scroll: int,
    ) -> int:
        articles = feed.locator('[role="article"]')
        new_snapshot_count = 0
        count = min(articles.count(), 500)
        for index in range(count):
            try:
                snapshot = articles.nth(index).evaluate(_SNAPSHOT_SCRIPT)
            except Exception:
                coverage["rejectedMalformed"] += 1
                continue
            if not isinstance(snapshot, dict):
                coverage["rejectedMalformed"] += 1
                continue
            fingerprint = _snapshot_fingerprint(snapshot)
            if fingerprint in seen_snapshots:
                continue
            seen_snapshots.add(fingerprint)
            new_snapshot_count += 1
            coverage["articlesObserved"] += 1
            parsed = parse_article_snapshot(
                snapshot,
                captured_at,
                discovered_at_scroll=discovered_at_scroll,
            )
            if parsed.item is None:
                key = {
                    "not_explicitly_public": "rejectedNotExplicitlyPublic",
                    "no_strong_permalink": "rejectedNoStrongPermalink",
                    "missing_author": "rejectedMissingAuthor",
                    "empty_text": "rejectedEmptyText",
                }.get(parsed.rejection, "rejectedMalformed")
                coverage[key] += 1
                continue
            external_id = parsed.item["externalId"]
            coverage["strongPermalinksObserved"] += 1
            if external_id in seen_items:
                coverage["duplicateItems"] += 1
                continue
            seen_items.add(external_id)
            if len(items) < self.limits.max_items_per_query:
                items.append(parsed.item)
                coverage["acceptedPublicItems"] += 1
            else:
                coverage["rejectedItemCap"] += 1
        return new_snapshot_count

    def collect(self, query: str) -> CollectionResult:
        if self._page is None:
            raise CollectorError("COLLECTOR_NOT_CONNECTED", fatal=True)
        normalized_query = " ".join(query.split())
        if not 1 <= len(normalized_query) <= 160:
            raise CollectorError("QUERY_INVALID")
        search_url = f"{FACEBOOK_ORIGIN}/search/top/?{urlencode({'q': normalized_query})}"
        coverage: dict[str, Any] = {
            "searchPath": "/search/top/",
            "recentPostsVerified": False,
            "requestedMinScrolls": self.limits.min_scrolls,
            "requestedMaxScrolls": self.limits.max_scrolls,
            "completedScrolls": 0,
            "articlesObserved": 0,
            "strongPermalinksObserved": 0,
            "acceptedPublicItems": 0,
            "duplicateItems": 0,
            "rejectedNotExplicitlyPublic": 0,
            "rejectedNoStrongPermalink": 0,
            "rejectedMissingAuthor": 0,
            "rejectedEmptyText": 0,
            "rejectedMalformed": 0,
            "rejectedItemCap": 0,
            "stopReason": "not_started",
        }
        try:
            self._page.goto(
                search_url,
                wait_until="domcontentloaded",
                timeout=self.limits.navigation_timeout_seconds * 1000,
            )
            self._assert_safe_session()
            self._verify_search_route(normalized_query)
            self._ensure_recent_posts(normalized_query)
            coverage["recentPostsVerified"] = True

            feed = self._page.locator('[role="feed"]').first
            feed.wait_for(
                state="visible",
                timeout=self.limits.navigation_timeout_seconds * 1000,
            )
            captured_at = _iso_now()
            items: list[dict[str, Any]] = []
            seen_snapshots: set[str] = set()
            seen_items: set[str] = set()
            self._harvest(
                feed,
                captured_at,
                seen_snapshots,
                seen_items,
                items,
                coverage,
                0,
            )
            stagnant_scrolls = 0
            for scroll_number in range(1, self.limits.max_scrolls + 1):
                self._page.evaluate(
                    "() => window.scrollBy(0, Math.max(window.innerHeight * 0.9, 700))"
                )
                self._page.wait_for_timeout(
                    int(self.limits.scroll_wait_seconds * 1000)
                )
                self._assert_safe_session()
                self._verify_search_route(normalized_query)
                discovered = self._harvest(
                    feed,
                    captured_at,
                    seen_snapshots,
                    seen_items,
                    items,
                    coverage,
                    scroll_number,
                )
                coverage["completedScrolls"] = scroll_number
                stagnant_scrolls = stagnant_scrolls + 1 if discovered == 0 else 0
                if (
                    scroll_number >= self.limits.min_scrolls
                    and len(items) >= self.limits.max_items_per_query
                ):
                    coverage["stopReason"] = "item_cap_after_minimum"
                    break
                if (
                    scroll_number >= self.limits.min_scrolls
                    and stagnant_scrolls
                    >= self.limits.stagnant_scrolls_after_minimum
                ):
                    coverage["stopReason"] = "no_new_articles_after_minimum"
                    break
            else:
                coverage["stopReason"] = "maximum_scrolls"
            apply_empty_results_circuit_breaker(
                coverage,
                self.limits.min_scrolls,
            )
            return CollectionResult(items=items, coverage=coverage)
        except CollectorError:
            raise
        except Exception as exc:
            # Playwright messages may include page fragments, so only the
            # classified code is allowed to cross this boundary.
            raise CollectorError("BROWSER_OPERATION_FAILED") from exc
