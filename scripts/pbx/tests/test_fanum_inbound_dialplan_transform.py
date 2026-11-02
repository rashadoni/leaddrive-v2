from __future__ import annotations

import importlib.util
from pathlib import Path
import re
import sys
import unittest


ROOT = Path(__file__).resolve().parents[3]
TRANSFORM_PATH = ROOT / "scripts" / "pbx" / "fanum-inbound-dialplan-transform.py"
SPEC = importlib.util.spec_from_file_location("fanum_inbound_dialplan_transform", TRANSFORM_PATH)
assert SPEC and SPEC.loader
transform = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = transform
SPEC.loader.exec_module(transform)



CONF_PATH = ROOT / "scripts" / "pbx" / "fanum-inbound-browser.conf"


def loaded_report(context: str) -> str:
    """What `dialplan show <context>` prints for the reviewed file's context."""
    rows, current = [], None
    for number, line in enumerate(CONF_PATH.read_text(encoding="utf-8").splitlines(), start=1):
        header = re.fullmatch(r"\[(.+)\]", line)
        if header:
            current = header.group(1)
            continue
        if current != context:
            continue
        first = re.fullmatch(r"exten => s,1,(.*)", line)
        step = re.fullmatch(r" same => n(?:\(([\w-]+)\))?,(.*)", line)
        if first:
            rows.append((None, first.group(1), number))
        elif step:
            rows.append((step.group(1), step.group(2), number))
    lines = [f"[ Context '{context}' created by 'pbx_config' ]"]
    for priority, (label, application, number) in enumerate(rows, start=1):
        lead = "  's' =>   " if priority == 1 else f"  [{label}]" if label else "           "
        lines.append(f"{lead}  {priority}. {application:<50} [fanum-inbound-browser.conf:{number}]")
    lines.append(f"-= 1 extension ({len(rows)} priorities) in 1 context. =-")
    return "\n".join(lines) + "\n"


BROWSER_LOADED_REPORT = loaded_report("fanum-inbound-browser")
AI_LEG_LOADED_REPORT = loaded_report("fanum-inbound-ai-leg")
TERMINAL_LOADED_REPORT = loaded_report("fanum-inbound-browser-terminal")
BROWSER_PRIORITY_COUNT = BROWSER_LOADED_REPORT.count("[fanum-inbound-browser.conf:")

LOADED_BROWSER_CONTEXTS = BROWSER_LOADED_REPORT + AI_LEG_LOADED_REPORT + TERMINAL_LOADED_REPORT


class InboundDialplanTransformTest(unittest.TestCase):

    def test_loaded_browser_contexts_prove_every_priority_and_source_line(self):
        self.assertEqual(
            transform.verify_loaded_browser_contexts(LOADED_BROWSER_CONTEXTS),
            None,
        )

    def test_loaded_browser_contexts_reject_answer_before_readiness(self):
        gate = "15. GotoIf($[\"${FANUM_BROWSER_READY}\" = \"1\"]?answer)"
        reordered = LOADED_BROWSER_CONTEXTS.replace(gate, "15. Answer()", 1).replace(
            "17. Answer()",
            "17. GotoIf($[\"${FANUM_BROWSER_READY}\" = \"1\"]?answer)",
            1,
        )
        ai_gate = "16. GotoIf($[\"${FANUM_INBOUND_ROUTE}\" = \"ai\"]?ai-answer:missed)"
        ai_first = LOADED_BROWSER_CONTEXTS.replace(ai_gate, "16. Answer()", 1)

        for report in (reordered, ai_first):
            self.assertNotEqual(report, LOADED_BROWSER_CONTEXTS)
            with self.subTest(report=report):
                with self.assertRaisesRegex(transform.DialplanRefused, "loaded browser context"):
                    transform.verify_loaded_browser_contexts(report)

    def test_loaded_browser_contexts_reject_extra_priority_or_foreign_source(self):
        extra = LOADED_BROWSER_CONTEXTS.replace(
            f"-= 1 extension ({BROWSER_PRIORITY_COUNT} priorities) in 1 context. =-",
            f"                  {BROWSER_PRIORITY_COUNT + 1}. Playback(silence/1)                         [other.conf:9]\n"
            f"-= 1 extension ({BROWSER_PRIORITY_COUNT + 1} priorities) in 1 context. =-",
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

    def test_the_ai_talks_on_its_own_leg_and_the_caller_waits_for_a_manager_after_it(self):
        # Owner, 2026-10-27: the AI hands the call to a manager's browser. The
        # caller's channel must outlive the AI's AudioSocket, so 9092 is only
        # reached through the Local leg, and the handoff question follows it.
        self.assertNotIn("127.0.0.1:9092", BROWSER_LOADED_REPORT)
        self.assertIn("AudioSocket(${FANUM_SAFE_CALL_ID},127.0.0.1:9092)", AI_LEG_LOADED_REPORT)
        order = [line.split(". ", 1)[1] for line in BROWSER_LOADED_REPORT.splitlines() if ". " in line and "conf:" in line]
        dial = order.index(next(item for item in order if item.startswith("Dial(Local/s@fanum-inbound-ai-leg/n,,g)")))
        self.assertTrue(order[dial + 2].startswith("AGI(/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py,handoff,"))
        without_leg = LOADED_BROWSER_CONTEXTS.replace(AI_LEG_LOADED_REPORT, "")
        with self.assertRaisesRegex(transform.DialplanRefused, "loaded browser context"):
            transform.verify_loaded_browser_contexts(without_leg)


if __name__ == "__main__":
    unittest.main()
