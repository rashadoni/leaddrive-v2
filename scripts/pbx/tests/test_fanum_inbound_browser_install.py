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


if __name__ == "__main__":
    unittest.main()
