from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
TRANSFORM_PATH = ROOT / "scripts" / "pbx" / "fanum-inbound-dialplan-transform.py"
SPEC = importlib.util.spec_from_file_location(
    "fanum_inbound_selector_fail_closed",
    TRANSFORM_PATH,
)
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

LOADED_REPORT = """[ Context 'from-fanum-provider' created by 'pbx_config' ]
  '994125550100' => 1. Gosub(fanum-inbound-browser,s,1(fanum-inbound-browser)) [extensions_fanum.conf:8]
  '_X.' =>          1. NoOp(Fanum provider catch-all)                   [extensions_fanum.conf:2]
                    2. Set(CHANNEL(language)=az)                       [extensions_fanum.conf:3]
                    3. Set(DENOISE(rx)=on)                             [extensions_fanum.conf:4]
                    4. Set(AGC(rx)=5000)                               [extensions_fanum.conf:5]
                    5. Hangup()                                        [extensions_fanum.conf:6]
-= 2 extensions (6 priorities) in 1 context. =-
"""


class InboundSelectorFailClosedTest(unittest.TestCase):
    def test_source_rejects_each_mutation_of_the_reviewed_wildcard(self):
        mutations = (
            WILDCARD_ROUTE.replace("_X.", "_!"),
            WILDCARD_ROUTE.replace(
                "NoOp(Fanum provider catch-all)",
                "NoOp(Fanum provider changed)",
            ),
            WILDCARD_ROUTE.replace("CHANNEL(language)", "CHANNEL(accountcode)"),
            WILDCARD_ROUTE.replace("=az", "=en"),
            WILDCARD_ROUTE.replace("DENOISE(rx)", "DENOISE(tx)"),
            WILDCARD_ROUTE.replace("DENOISE(rx)=on", "DENOISE(rx)=off"),
            WILDCARD_ROUTE.replace("AGC(rx)", "AGC(tx)"),
            WILDCARD_ROUTE.replace("AGC(rx)=5000", "AGC(rx)=999999999"),
        )

        for route in mutations:
            with self.subTest(route=route):
                with self.assertRaises(transform.DialplanRefused):
                    transform.install_route(PREFIX + route + SUFFIX, SELECTOR_DID)

    def test_loaded_context_rejects_each_mutation_of_the_reviewed_wildcard(self):
        mutations = (
            LOADED_REPORT.replace("'_X.'", "'_!'"),
            LOADED_REPORT.replace(
                "NoOp(Fanum provider catch-all)",
                "NoOp(Fanum provider changed)",
            ),
            LOADED_REPORT.replace("CHANNEL(language)", "CHANNEL(accountcode)"),
            LOADED_REPORT.replace("=az", "=en"),
            LOADED_REPORT.replace("DENOISE(rx)", "DENOISE(tx)"),
            LOADED_REPORT.replace("DENOISE(rx)=on", "DENOISE(rx)=off"),
            LOADED_REPORT.replace("AGC(rx)", "AGC(tx)"),
            LOADED_REPORT.replace("AGC(rx)=5000", "AGC(rx)=999999999"),
        )

        for report in mutations:
            with self.subTest(report=report):
                with self.assertRaises(transform.DialplanRefused):
                    transform.verify_loaded_context(report, SELECTOR_DID)

    def test_cli_preserves_crlf_in_every_existing_source_byte(self):
        source = (PREFIX + WILDCARD_ROUTE + SUFFIX).replace("\n", "\r\n")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            input_path = root / "extensions_fanum.conf"
            selector_path = root / "selector"
            output_path = root / "candidate"
            input_path.write_bytes(source.encode("ascii"))
            selector_path.write_bytes(f"{SELECTOR_DID}\n".encode("ascii"))

            self.assertEqual(
                transform.main(
                    [
                        "--install",
                        str(input_path),
                        str(selector_path),
                        str(output_path),
                    ],
                ),
                0,
            )

            exact_route = (
                f"exten => {SELECTOR_DID},1,"
                f"Gosub(fanum-inbound-browser,s,1({SAFE_DESTINATION_ALIAS}))\r\n"
            ).encode("ascii")
            changed = output_path.read_bytes()
            self.assertEqual(changed.replace(exact_route, b"", 1), source.encode("ascii"))


if __name__ == "__main__":
    unittest.main()
