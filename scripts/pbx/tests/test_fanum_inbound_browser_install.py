from __future__ import annotations

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[3]
INSTALLER_PATH = ROOT / "scripts" / "pbx" / "fanum-inbound-browser-install"


class InboundBrowserInstallTest(unittest.TestCase):
    def test_audiosocket_preflight_uses_the_dialplan_signature_not_a_versioned_synopsis(self):
        source = INSTALLER_PATH.read_text(encoding="utf-8")
        preflight = source[
            source.index("systemctl is-active --quiet asterisk") : source.index(
                "ss -ltnH 2>/dev/null"
            )
        ]

        # Asterisk 20 reports the supported application as
        # ``AudioSocket(uuid,service)`` but no longer uses the old PCM wording.
        # The argument signature is the compatibility contract used by this
        # dialplan, whereas an English synopsis is not.
        self.assertRegex(preflight, r"grep -Fq ['\"]AudioSocket\(['\"]")
        self.assertNotIn("Transmit and receive PCM audio", preflight)

    def test_long_reports_are_read_whole_before_grep_q_matches_them(self):
        # 2026-10-27: `asterisk -rx "core show application Dial" | grep -Fq` under
        # pipefail failed on a station that has Dial: grep -q exits early, the
        # writer gets SIGPIPE. Long reports are captured first, then matched.
        source = INSTALLER_PATH.read_text(encoding="utf-8")
        self.assertNotRegex(source, r'core show application \$application"[^\n]*\n?\s*\|\s*grep')
        self.assertNotRegex(source, r'core show channeltypes"[^\n]*\n?\s*\|\s*grep')
        self.assertIn('grep -Fiq -- "$application(" <<<"$application_report"', source)
        # The station's help prints PlayTones( for the dialplan's Playtones().
        self.assertIn("for application in Dial PlayTones StopPlayTones; do", source)


if __name__ == "__main__":
    unittest.main()
