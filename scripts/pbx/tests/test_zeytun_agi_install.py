"""The password-free AGI installer, run against a sandbox copy of its fixed paths."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "zeytun-agi-install"
SELF_CHECK = 'python3 -I "$LIVE" --self-check'
OLD = b"#!/usr/bin/env python3\nprint('old helper')\n"
NEW = b"#!/usr/bin/env python3\nprint('new helper')\n"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@unittest.skipUnless(shutil.which("bash"), "bash is required")
class AgiInstallerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.live = self.tmp / "lib" / "fanum-inbound-browser-agi.py"
        self.live.parent.mkdir()
        self.live.write_bytes(OLD)
        self.live.chmod(0o750)
        self.package = self.tmp / "home" / "zeytun-agi-test"
        self.package.mkdir(parents=True)
        (self.tmp / "run").mkdir()

    def script(self, self_check=False) -> Path:
        text = INSTALLER.read_text()
        for old, new in (("readonly LIVE=/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py", f"readonly LIVE={self.live}"),
                         ("readonly PACKAGES=/home/fanum", f"readonly PACKAGES={self.tmp / 'home'}"),
                         ("readonly STAGE_PARENT=/run", f"readonly STAGE_PARENT={self.tmp / 'run'}"),
                         ("readonly BACKUPS=/var/backups/fanum-inbound-browser", f"readonly BACKUPS={self.tmp / 'backups'}"),
                         # Not root here: the backup directory keeps this user.
                         ('install -d -o root -g root -m 0700 "$BACKUPS"', 'install -d -m 0700 "$BACKUPS"')):
            self.assertEqual(text.count(old), 1, old)
            text = text.replace(old, new)
        if not self_check:
            # The helper's own check reads the station's config; here it passes.
            self.assertEqual(text.count(SELF_CHECK), 1)
            text = text.replace(SELF_CHECK, "true")
        path = self.tmp / "installer"
        path.write_text(text)
        return path

    def run_installer(self, candidate=NEW, expected=None, live=None, package="zeytun-agi-test", self_check=False):
        target = self.package / "fanum-inbound-browser-agi.py"
        if candidate is not None and not target.is_symlink():
            target.write_bytes(candidate)
        result = subprocess.run(["bash", str(self.script(self_check)), package, expected or sha(NEW), live or sha(OLD)],
                                capture_output=True, text=True, timeout=30)
        return result.returncode, result.stdout + result.stderr

    def test_installs_the_reviewed_helper_with_the_live_owner_and_mode_and_keeps_a_backup(self):
        code, output = self.run_installer()
        self.assertEqual(code, 0, output)
        self.assertEqual(self.live.read_bytes(), NEW)
        self.assertEqual(stat.S_IMODE(self.live.stat().st_mode), 0o750)
        self.assertIn("helper=installed sha256=" + sha(NEW), output)
        backups = list((self.tmp / "backups").glob("agi-*/fanum-inbound-browser-agi.py"))
        self.assertEqual([path.read_bytes() for path in backups], [OLD])
        self.assertEqual(list(self.live.parent.iterdir()), [self.live])  # no temporary file, no __pycache__
        self.assertEqual(list((self.tmp / "run").iterdir()), [])  # the stage is gone
        # Run again: already current, nothing changes.
        code, output = self.run_installer()
        self.assertEqual((code, output.strip()), (0, "helper=already_current sha256=" + sha(NEW)))

    def test_a_live_helper_other_than_the_expected_one_is_left_alone(self):
        code, output = self.run_installer(live="0" * 64)
        self.assertEqual(code, 4, output)
        self.assertIn("live helper is " + sha(OLD), output)
        self.assertEqual(self.live.read_bytes(), OLD)

    def test_a_helper_with_another_hash_a_link_or_a_bad_name_is_refused(self):
        self.assertEqual(self.run_installer(expected="1" * 64)[0], 3)
        self.assertEqual(self.run_installer(package="../etc")[0], 2)
        target = self.package / "fanum-inbound-browser-agi.py"
        target.unlink()
        secret = self.tmp / "secret"
        secret.write_bytes(NEW)
        target.symlink_to(secret)
        self.assertEqual(self.run_installer(candidate=None)[0], 2)
        self.assertEqual(self.live.read_bytes(), OLD)

    def test_a_helper_that_does_not_compile_or_fails_its_own_check_is_rolled_back(self):
        broken = b"def broken(:\n"
        code, output = self.run_installer(candidate=broken, expected=sha(broken))
        self.assertEqual(code, 5, output)
        self.assertIn("previous helper is back", output)
        self.assertEqual(self.live.read_bytes(), OLD)
        # The real self-check: this box has no station config, so it fails.
        failing = b"import sys\nsys.exit(1)\n"
        code, output = self.run_installer(candidate=failing, expected=sha(failing), self_check=True)
        self.assertEqual(code, 5, output)
        self.assertEqual(self.live.read_bytes(), OLD)
        self.assertEqual(stat.S_IMODE(self.live.stat().st_mode), 0o750)

    def test_the_sudoers_rule_names_only_the_fixed_installer(self):
        rule = (ROOT / "zeytun-agi-install.sudoers").read_text()
        lines = [line for line in rule.splitlines() if line and not line.startswith("#")]
        self.assertEqual(lines, ["fanum ALL=(root) NOPASSWD: /usr/local/sbin/zeytun-agi-install"])


if __name__ == "__main__":
    unittest.main()
