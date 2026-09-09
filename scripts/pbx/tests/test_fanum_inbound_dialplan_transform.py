from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[3]
TRANSFORM_PATH = ROOT / "scripts" / "pbx" / "fanum-inbound-dialplan-transform.py"
SPEC = importlib.util.spec_from_file_location("fanum_inbound_dialplan_transform", TRANSFORM_PATH)
assert SPEC and SPEC.loader
transform = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = transform
SPEC.loader.exec_module(transform)



BROWSER_LOADED_REPORT = """[ Context 'fanum-inbound-browser' created by 'pbx_config' ]
  's' =>           1. NoOp(Fanum inbound browser gate)                 [fanum-inbound-browser.conf:9]
                   2. Set(__FANUM_SAFE_CALL_ID=)                        [fanum-inbound-browser.conf:10]
                   3. AGI(/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py,identify) [fanum-inbound-browser.conf:11]
                   4. GotoIf($["${AGISTATUS}" = "SUCCESS"]?agi-succeeded:invalid-id) [fanum-inbound-browser.conf:12]
  [agi-succeeded]  5. GotoIf($[${LEN(${FANUM_SAFE_CALL_ID})} = 36]?identified:invalid-id) [fanum-inbound-browser.conf:13]
     [identified]  6. Set(__FANUM_INBOUND_TERMINAL_STATE=no_answer)    [fanum-inbound-browser.conf:14]
                   7. Set(CHANNEL(hangup_handler_push)=fanum-inbound-browser-terminal,s,1) [fanum-inbound-browser.conf:15]
                   8. Ringing()                                        [fanum-inbound-browser.conf:16]
                   9. Set(FANUM_INBOUND_EVENT_OK=0)                    [fanum-inbound-browser.conf:17]
                  10. AGI(/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py,ringing,${FANUM_SAFE_CALL_ID},${ARG1}) [fanum-inbound-browser.conf:18]
                  11. GotoIf($["${FANUM_INBOUND_EVENT_OK}" = "1"]?await-browser:registration-failed) [fanum-inbound-browser.conf:19]
  [await-browser] 12. Set(FANUM_BROWSER_READY=0)                       [fanum-inbound-browser.conf:20]
                  13. AGI(/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py,ready,${FANUM_SAFE_CALL_ID}) [fanum-inbound-browser.conf:21]
                  14. GotoIf($["${FANUM_BROWSER_READY}" = "1"]?answer:missed) [fanum-inbound-browser.conf:22]
         [answer] 15. Answer()                                         [fanum-inbound-browser.conf:23]
                  16. Set(__FANUM_INBOUND_TERMINAL_STATE=connected)    [fanum-inbound-browser.conf:24]
                  17. AGI(/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py,answered,${FANUM_SAFE_CALL_ID}) [fanum-inbound-browser.conf:27]
                  18. Set(CHANNEL(language)=az)                        [fanum-inbound-browser.conf:28]
                  19. Set(DENOISE(rx)=on)                              [fanum-inbound-browser.conf:29]
                  20. Set(AGC(rx)=5000)                                [fanum-inbound-browser.conf:30]
                  21. AudioSocket(${FANUM_SAFE_CALL_ID},127.0.0.1:9093) [fanum-inbound-browser.conf:31]
                  22. Hangup()                                         [fanum-inbound-browser.conf:32]
         [missed] 23. Hangup()                                         [fanum-inbound-browser.conf:33]
  [registration-failed] 24. Set(__FANUM_INBOUND_TERMINAL_STATE=failed) [fanum-inbound-browser.conf:34]
                  25. Hangup()                                         [fanum-inbound-browser.conf:35]
     [invalid-id] 26. Hangup()                                         [fanum-inbound-browser.conf:36]
-= 1 extension (26 priorities) in 1 context. =-
"""

TERMINAL_LOADED_REPORT = """[ Context 'fanum-inbound-browser-terminal' created by 'pbx_config' ]
  's' =>           1. NoOp(Fanum inbound browser terminal event)        [fanum-inbound-browser.conf:39]
                   2. ExecIf($["${CDR(answer)}" != ""]?Set(FANUM_INBOUND_TERMINAL_STATE=connected)) [fanum-inbound-browser.conf:42]
                   3. Set(FANUM_INBOUND_DURATION=0)                      [fanum-inbound-browser.conf:43]
                   4. ExecIf($["${FANUM_INBOUND_TERMINAL_STATE}" = "connected"]?Set(FANUM_INBOUND_DURATION=${CDR(billsec)})) [fanum-inbound-browser.conf:44]
                   5. ExecIf($["${FANUM_INBOUND_DURATION}" = ""]?Set(FANUM_INBOUND_DURATION=0)) [fanum-inbound-browser.conf:45]
                   6. AGI(/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py,terminal,${FANUM_SAFE_CALL_ID},${FANUM_INBOUND_TERMINAL_STATE},${FANUM_INBOUND_DURATION}) [fanum-inbound-browser.conf:46]
                   7. Return()                                           [fanum-inbound-browser.conf:47]
-= 1 extension (7 priorities) in 1 context. =-
"""

LOADED_BROWSER_CONTEXTS = BROWSER_LOADED_REPORT + TERMINAL_LOADED_REPORT


class InboundDialplanTransformTest(unittest.TestCase):

    def test_loaded_browser_contexts_prove_every_priority_and_source_line(self):
        self.assertEqual(
            transform.verify_loaded_browser_contexts(LOADED_BROWSER_CONTEXTS),
            None,
        )

    def test_loaded_browser_contexts_reject_answer_before_readiness(self):
        reordered = LOADED_BROWSER_CONTEXTS.replace(
            "14. GotoIf($[\"${FANUM_BROWSER_READY}\" = \"1\"]?answer:missed)",
            "14. Answer()",
        ).replace(
            "15. Answer()",
            "15. GotoIf($[\"${FANUM_BROWSER_READY}\" = \"1\"]?answer:missed)",
        )

        with self.assertRaisesRegex(transform.DialplanRefused, "loaded browser context"):
            transform.verify_loaded_browser_contexts(reordered)

    def test_loaded_browser_contexts_reject_extra_priority_or_foreign_source(self):
        extra = LOADED_BROWSER_CONTEXTS.replace(
            "-= 1 extension (26 priorities) in 1 context. =-",
            "                  27. Playback(silence/1)                         [other.conf:9]\n"
            "-= 1 extension (27 priorities) in 1 context. =-",
            1,
        )
        foreign_source = LOADED_BROWSER_CONTEXTS.replace(
            "[fanum-inbound-browser.conf:23]",
            "[other.conf:23]",
            1,
        )

        for report in (extra, foreign_source):
            with self.subTest(report=report):
                with self.assertRaisesRegex(transform.DialplanRefused, "loaded browser context"):
                    transform.verify_loaded_browser_contexts(report)

    def test_loaded_browser_contexts_reject_a_missing_or_renamed_priority_label(self):
        missing = LOADED_BROWSER_CONTEXTS.replace("[answer]", "        ", 1)
        renamed = LOADED_BROWSER_CONTEXTS.replace("[missed]", "[wrong]", 1)

        for report in (missing, renamed):
            with self.subTest(report=report):
                with self.assertRaisesRegex(transform.DialplanRefused, "loaded browser context"):
                    transform.verify_loaded_browser_contexts(report)

    def test_loaded_browser_contexts_reject_missing_terminal_context(self):
        with self.assertRaisesRegex(transform.DialplanRefused, "loaded browser context"):
            transform.verify_loaded_browser_contexts(BROWSER_LOADED_REPORT)


if __name__ == "__main__":
    unittest.main()
