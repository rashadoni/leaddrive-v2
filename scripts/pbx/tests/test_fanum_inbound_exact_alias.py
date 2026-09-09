from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[3]
TRANSFORM_PATH = ROOT / "scripts" / "pbx" / "fanum-inbound-dialplan-transform.py"
SPEC = importlib.util.spec_from_file_location(
    "fanum_inbound_exact_alias",
    TRANSFORM_PATH,
)
assert SPEC and SPEC.loader
transform = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = transform
SPEC.loader.exec_module(transform)


SELECTOR_DID = "994125550100"
SOURCE = """[from-fanum-provider]
exten => _X.,1,NoOp(Fanum provider catch-all)
 same => n,Set(CHANNEL(language)=az)
 same => n,Set(DENOISE(rx)=on)
 same => n,Set(AGC(rx)=5000)
 same => n,Hangup()
exten => 994125550100,1,Gosub(fanum-inbound-browser,s,1(FANUM-INBOUND-BROWSER))
"""
LOADED_REPORT = """[ Context 'from-fanum-provider' created by 'pbx_config' ]
  '994125550100' => 1. Gosub(fanum-inbound-browser,s,1(FANUM-INBOUND-BROWSER)) [extensions_fanum.conf:8]
  '_X.' =>          1. NoOp(Fanum provider catch-all)                   [extensions_fanum.conf:2]
                    2. Set(CHANNEL(language)=az)                       [extensions_fanum.conf:3]
                    3. Set(DENOISE(rx)=on)                             [extensions_fanum.conf:4]
                    4. Set(AGC(rx)=5000)                               [extensions_fanum.conf:5]
                    5. Hangup()                                        [extensions_fanum.conf:6]
-= 2 extensions (6 priorities) in 1 context. =-
"""


class InboundExactAliasTest(unittest.TestCase):
    def test_source_rejects_case_mutation_of_the_fixed_alias(self):
        with self.assertRaises(transform.DialplanRefused):
            transform.verify_installed_route(SOURCE, SELECTOR_DID)

    def test_loaded_context_rejects_case_mutation_of_the_fixed_alias(self):
        with self.assertRaises(transform.DialplanRefused):
            transform.verify_loaded_context(LOADED_REPORT, SELECTOR_DID)


if __name__ == "__main__":
    unittest.main()
