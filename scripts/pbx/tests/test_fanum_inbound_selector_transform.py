from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
TRANSFORM_PATH = ROOT / "scripts" / "pbx" / "fanum-inbound-dialplan-transform.py"
SPEC = importlib.util.spec_from_file_location("fanum_inbound_selector_transform", TRANSFORM_PATH)
assert SPEC and SPEC.loader
transform = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = transform
SPEC.loader.exec_module(transform)


PREFIX = """[unrelated]
exten => s,1,NoOp(leave me byte-for-byte)

[from-fanum-provider]
"""
WILDCARD_ROUTE = """exten => _X.,1,NoOp(Fanum provider catch-all)
 same => n,Set(CHANNEL(language)=az)
 same => n,Set(DENOISE(rx)=on)
 same => n,Set(AGC(rx)=5000)
 same => n,Hangup()
"""
SUFFIX = """
[fanum-ai-bridge]
exten => s,1,AudioSocket(${FANUM_SAFE_CALL_ID},127.0.0.1:9092)
"""
SELECTOR_DID = "994125550100"
SAFE_DESTINATION_ALIAS = "fanum-inbound-browser"


class InboundSelectorTransformTest(unittest.TestCase):
    def test_adds_one_exact_selector_without_changing_the_reviewed_wildcard(self):
        source = PREFIX + WILDCARD_ROUTE + SUFFIX

        changed = transform.install_route(source, SELECTOR_DID)

        exact_route = (
            f"exten => {SELECTOR_DID},1,"
            f"Gosub(fanum-inbound-browser,s,1({SAFE_DESTINATION_ALIAS}))\n"
        )
        self.assertEqual(changed.replace(exact_route, "", 1), source)
        self.assertEqual(changed.count(exact_route), 1)
        self.assertIn(WILDCARD_ROUTE, changed)
        self.assertNotIn("Gosub(fanum-inbound-browser,s,1(${EXTEN}))", changed)
        self.assertEqual(transform.verify_installed_route(changed, SELECTOR_DID), None)

    def test_rejects_any_change_to_the_reviewed_wildcard_shape(self):
        mutations = (
            WILDCARD_ROUTE.replace("NoOp(Fanum provider catch-all)", "Answer()"),
            WILDCARD_ROUTE.replace("CHANNEL(language)", "CALLERID(name)"),
            WILDCARD_ROUTE.replace(
                "DENOISE(rx)",
                "DENOISE(tx)\n same => n,Playback(silence/1)",
            ),
            WILDCARD_ROUTE.replace("AGC(rx)", "VOLUME(rx)"),
            WILDCARD_ROUTE.replace("Hangup()", "Dial(PJSIP/elsewhere)"),
        )

        for route in mutations:
            with self.subTest(route=route):
                with self.assertRaises(transform.DialplanRefused):
                    transform.install_route(PREFIX + route + SUFFIX, SELECTOR_DID)

    def test_selector_file_is_one_strict_lf_terminated_numeric_line(self):
        with tempfile.TemporaryDirectory() as temporary:
            selector = Path(temporary) / "selector"
            selector.write_bytes(f"{SELECTOR_DID}\n".encode("ascii"))
            self.assertEqual(transform.read_selector(selector), SELECTOR_DID)

            for invalid in (
                b"",
                b"9941\r\n",
                b"+994125550100\n",
                b"994125550100",
                b"994125550100\n994125550101\n",
                b"9941 2555 0100\n",
            ):
                with self.subTest(invalid=invalid):
                    selector.write_bytes(invalid)
                    with self.assertRaises(transform.DialplanRefused):
                        transform.read_selector(selector)

    def test_loaded_context_proves_exact_selector_and_preserved_wildcard(self):
        report = """[ Context 'from-fanum-provider' created by 'pbx_config' ]
  '994125550100' => 1. Gosub(fanum-inbound-browser,s,1(fanum-inbound-browser)) [extensions_fanum.conf:8]
  '_X.' =>          1. NoOp(Fanum provider catch-all)                   [extensions_fanum.conf:2]
                    2. Set(CHANNEL(language)=az)                       [extensions_fanum.conf:3]
                    3. Set(DENOISE(rx)=on)                             [extensions_fanum.conf:4]
                    4. Set(AGC(rx)=5000)                               [extensions_fanum.conf:5]
                    5. Hangup()                                        [extensions_fanum.conf:6]
-= 2 extensions (6 priorities) in 1 context. =-
"""

        self.assertEqual(transform.verify_loaded_context(report, SELECTOR_DID), None)

    def test_loaded_context_rejects_changed_wildcard_or_foreign_source(self):
        report = """[ Context 'from-fanum-provider' created by 'pbx_config' ]
  '994125550100' => 1. Gosub(fanum-inbound-browser,s,1(fanum-inbound-browser)) [extensions_fanum.conf:8]
  '_X.' =>          1. NoOp(Fanum provider catch-all)                   [extensions_fanum.conf:2]
                    2. Set(CHANNEL(language)=az)                       [extensions_fanum.conf:3]
                    3. Set(DENOISE(rx)=on)                             [extensions_fanum.conf:4]
                    4. Set(AGC(rx)=5000)                               [extensions_fanum.conf:5]
                    5. Hangup()                                        [extensions_fanum.conf:6]
-= 2 extensions (6 priorities) in 1 context. =-
"""

        for changed in (
            report.replace("Set(AGC(rx)=5000)", "Playback(silence/1)"),
            report.replace("[extensions_fanum.conf:4]", "[other.conf:4]"),
            report.replace(
                "-= 2 extensions (6 priorities)",
                "-= 3 extensions (7 priorities)",
            ),
        ):
            with self.subTest(changed=changed):
                with self.assertRaises(transform.DialplanRefused):
                    transform.verify_loaded_context(changed, SELECTOR_DID)


if __name__ == "__main__":
    unittest.main()
