from __future__ import annotations

import pathlib
import sys
import unittest


WORKER_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from collector import (  # noqa: E402
    _SNAPSHOT_SCRIPT,
    apply_empty_results_circuit_breaker,
    classify_session_safety,
    normalize_facebook_permalink,
    parse_article_snapshot,
)


CAPTURED_AT = "2026-07-29T21:30:00.000Z"


def public_snapshot(**updates: object) -> dict[str, object]:
    snapshot: dict[str, object] = {
        "innerText": (
            "Klinik.Media\n22 июля\n"
            "Araz market yenə qalmaqaldadır #Arazsupermarket"
        ),
        "audienceLabels": ["Поделился/-ась с Доступно всем"],
        "articleHtmlSha256": "a" * 64,
        "mediaKinds": ["IMAGE", "REEL"],
        "anchors": [
            {
                "href": "https://www.facebook.com/klinik.media/",
                "text": "Klinik.Media",
                "ariaLabel": "",
                "title": "",
            },
            {
                "href": (
                    "https://www.facebook.com/reel/1509355460500124/"
                    "?mibextid=tracking"
                ),
                "text": "22 июля",
                "ariaLabel": "",
                "title": "",
            },
            {
                "href": "https://klinik.media/araz-market-yene-qalmaqalda",
                "text": "source",
                "ariaLabel": "",
                "title": "",
            },
        ],
    }
    snapshot.update(updates)
    return snapshot


class PermalinkTests(unittest.TestCase):
    def test_reel_is_canonicalized_with_strong_external_id(self) -> None:
        result = normalize_facebook_permalink(
            "https://m.facebook.com/reel/1509355460500124/?ref=share"
        )
        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.external_id, "facebook:reel:1509355460500124")
        self.assertEqual(
            result.canonical_url,
            "https://www.facebook.com/reel/1509355460500124/",
        )

    def test_posts_story_video_and_photo_are_supported(self) -> None:
        cases = {
            "https://www.facebook.com/acme/posts/pfbidABCDEF0123456789/?__cft__=x":
                "facebook:post:pfbidABCDEF0123456789",
            "https://www.facebook.com/permalink.php?story_fbid=123456789&id=987654321":
                "facebook:post:123456789",
            "https://www.facebook.com/acme/videos/123456789/":
                "facebook:video:123456789",
            "https://www.facebook.com/photo.php?fbid=123456789&set=a.9":
                "facebook:photo:123456789",
        }
        for url, expected in cases.items():
            with self.subTest(url=url):
                parsed = normalize_facebook_permalink(url)
                self.assertIsNotNone(parsed)
                assert parsed is not None
                self.assertEqual(parsed.external_id, expected)

    def test_weak_share_and_non_facebook_urls_are_rejected(self) -> None:
        self.assertIsNone(
            normalize_facebook_permalink("https://www.facebook.com/share/r/AbCd/")
        )
        self.assertIsNone(
            normalize_facebook_permalink("https://example.com/posts/123456789")
        )


class ArticleParserTests(unittest.TestCase):
    def test_live_public_marker_and_strict_contract_shape(self) -> None:
        parsed = parse_article_snapshot(
            public_snapshot(),
            CAPTURED_AT,
            discovered_at_scroll=7,
        )
        self.assertIsNone(parsed.rejection)
        assert parsed.item is not None
        item = parsed.item
        self.assertEqual(
            set(item),
            {
                "kind",
                "externalId",
                "permalink",
                "authorName",
                "authorUrl",
                "text",
                "capturedAt",
                "audience",
                "evidence",
            },
        )
        self.assertEqual(item["kind"], "REEL")
        self.assertEqual(item["authorName"], "Klinik.Media")
        self.assertEqual(
            item["audience"],
            {
                "kind": "PUBLIC",
                "evidenceLabel": "Поделился/-ась с Доступно всем",
            },
        )
        self.assertEqual(
            set(item["evidence"]),
            {
                "articleHtmlSha256",
                "screenshotSha256",
                "parserVersion",
                "discoveredAtScroll",
                "dateRaw",
                "datePrecision",
                "mediaKinds",
                "outboundLinks",
            },
        )
        self.assertEqual(item["evidence"]["discoveredAtScroll"], 7)
        self.assertEqual(
            item["evidence"]["outboundLinks"],
            ["https://klinik.media/araz-market-yene-qalmaqalda"],
        )

    def test_non_public_article_is_rejected_fail_closed(self) -> None:
        parsed = parse_article_snapshot(
            public_snapshot(audienceLabels=["Friends"]),
            CAPTURED_AT,
        )
        self.assertIsNone(parsed.item)
        self.assertEqual(parsed.rejection, "not_explicitly_public")

    def test_article_without_strong_permalink_is_rejected(self) -> None:
        parsed = parse_article_snapshot(
            public_snapshot(
                anchors=[
                    {
                        "href": "https://www.facebook.com/share/r/weak",
                        "text": "post",
                    }
                ]
            ),
            CAPTURED_AT,
        )
        self.assertIsNone(parsed.item)
        self.assertEqual(parsed.rejection, "no_strong_permalink")

    def test_article_hash_is_mandatory(self) -> None:
        parsed = parse_article_snapshot(
            public_snapshot(articleHtmlSha256="not-a-hash"),
            CAPTURED_AT,
        )
        self.assertIsNone(parsed.item)
        self.assertEqual(parsed.rejection, "malformed")

    def test_dom_snapshot_reads_svg_title_without_returning_html(self) -> None:
        self.assertIn("svg[role=\"img\"] title", _SNAPSHOT_SCRIPT)
        self.assertIn("crypto.subtle.digest('SHA-256'", _SNAPSHOT_SCRIPT)
        self.assertNotIn("outerHTML,", _SNAPSHOT_SCRIPT)


class CircuitBreakerTests(unittest.TestCase):
    def test_verified_empty_search_after_eight_scrolls_is_partial(self) -> None:
        coverage = {
            "recentPostsVerified": True,
            "completedScrolls": 8,
            "articlesObserved": 0,
            "stopReason": "maximum_scrolls",
        }
        self.assertTrue(apply_empty_results_circuit_breaker(coverage, 8))
        self.assertEqual(coverage["deliveryStatus"], "PARTIAL")
        self.assertEqual(
            coverage["deliveryReason"],
            "SEARCH_RESULTS_EMPTY_ANOMALY",
        )
        self.assertEqual(coverage["stopReason"], "empty_results_anomaly")

    def test_empty_search_does_not_trip_before_minimum_or_with_articles(self) -> None:
        before_minimum = {
            "recentPostsVerified": True,
            "completedScrolls": 7,
            "articlesObserved": 0,
        }
        with_articles = {
            "recentPostsVerified": True,
            "completedScrolls": 8,
            "articlesObserved": 1,
        }
        self.assertFalse(apply_empty_results_circuit_breaker(before_minimum, 8))
        self.assertFalse(apply_empty_results_circuit_breaker(with_articles, 8))

    def test_checkpoint_and_explicit_block_are_classified(self) -> None:
        self.assertEqual(
            classify_session_safety(
                "https://www.facebook.com/checkpoint/123/",
                has_password_input=False,
                has_temporary_block_text=False,
            ),
            "FACEBOOK_TEMPORARILY_BLOCKED",
        )
        self.assertEqual(
            classify_session_safety(
                "https://www.facebook.com/",
                has_password_input=False,
                has_temporary_block_text=True,
            ),
            "FACEBOOK_TEMPORARILY_BLOCKED",
        )
        self.assertEqual(
            classify_session_safety(
                "https://www.facebook.com/login/",
                has_password_input=True,
                has_temporary_block_text=False,
            ),
            "FACEBOOK_AUTH_REQUIRED",
        )


if __name__ == "__main__":
    unittest.main()
