from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
DISCOVER_PATH = ROOT / "scripts" / "pbx" / "fanum-inbound-selector-discover.py"
SPEC = importlib.util.spec_from_file_location(
    "fanum_inbound_selector_discover",
    DISCOVER_PATH,
)
assert SPEC and SPEC.loader
discover = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = discover
SPEC.loader.exec_module(discover)


SELECTOR_DID = "994125550100"
ENDPOINT_REPORT = f"""
 Endpoint:  fanum-provider  Not in use
    context                       : from-fanum-provider
    from_user                     : {SELECTOR_DID}
"""
REGISTRATIONS_REPORT = """
 <Registration/ServerURI..............................>  <Auth....................>  <Status.......>
==========================================================================================
 fanum-provider/sip:provider.invalid:4959                 fanum-provider-auth          Registered
Objects found: 1
"""
REGISTRATION_REPORT = f"""
 ParameterName            : ParameterValue
 =========================================================
 client_uri               : sip:{SELECTOR_DID}@provider.invalid:4959
 contact_user             : {SELECTOR_DID}
 outbound_auth            : fanum-provider-auth
"""


class FakeAsterisk:
    def __init__(
        self,
        *,
        endpoint: str = ENDPOINT_REPORT,
        registrations: str = REGISTRATIONS_REPORT,
        registration: str = REGISTRATION_REPORT,
    ) -> None:
        self.endpoint = endpoint
        self.registrations = registrations
        self.registration = registration
        self.commands: list[str] = []

    def __call__(self, command: str) -> str:
        self.commands.append(command)
        if command == "pjsip show endpoint fanum-provider":
            return self.endpoint
        if command == "pjsip show registrations":
            return self.registrations
        if command == "pjsip show registration fanum-provider":
            return self.registration
        raise AssertionError(f"unexpected command shape: {command}")


class InboundSelectorDiscoverTest(unittest.TestCase):
    def test_accepts_one_registered_trunk_when_all_three_fields_agree(self):
        asterisk = FakeAsterisk()

        self.assertEqual(discover.discover_selector(asterisk), SELECTOR_DID)
        self.assertEqual(
            asterisk.commands,
            [
                "pjsip show endpoint fanum-provider",
                "pjsip show registrations",
                "pjsip show registration fanum-provider",
            ],
        )

    def test_accepts_the_official_cli_status_line_with_trailing_spacing(self):
        asterisk = FakeAsterisk(
            registrations=REGISTRATIONS_REPORT.replace(
                "Registered\n",
                "Registered   \n",
            ),
        )

        self.assertEqual(discover.discover_selector(asterisk), SELECTOR_DID)

    def test_refuses_each_disagreement_without_including_values_in_the_error(self):
        cases = (
            FakeAsterisk(endpoint=ENDPOINT_REPORT.replace(SELECTOR_DID, "994125550101")),
            FakeAsterisk(
                registration=REGISTRATION_REPORT.replace(
                    f"contact_user             : {SELECTOR_DID}",
                    "contact_user             : 994125550101",
                ),
            ),
            FakeAsterisk(
                registration=REGISTRATION_REPORT.replace(
                    f"sip:{SELECTOR_DID}@",
                    "sip:994125550101@",
                ),
            ),
        )

        for asterisk in cases:
            with self.subTest(commands=asterisk.commands):
                with self.assertRaises(discover.SelectorDiscoveryRefused) as raised:
                    discover.discover_selector(asterisk)
                self.assertNotIn(SELECTOR_DID, str(raised.exception))
                self.assertNotIn("994125550101", str(raised.exception))

    def test_refuses_unregistered_ambiguous_or_non_numeric_candidates(self):
        cases = (
            FakeAsterisk(
                registrations=REGISTRATIONS_REPORT.replace("Registered", "Rejected"),
            ),
            FakeAsterisk(
                registrations=REGISTRATIONS_REPORT.replace(
                    "Objects found: 1",
                    "fanum-copy/sip:provider.invalid:4959 fanum-provider-auth Registered\nObjects found: 2",
                ),
            ),
            FakeAsterisk(endpoint=ENDPOINT_REPORT.replace(SELECTOR_DID, "+994125550100")),
            FakeAsterisk(endpoint=ENDPOINT_REPORT.replace(SELECTOR_DID, "1234")),
        )

        for asterisk in cases:
            with self.subTest(registrations=asterisk.registrations):
                with self.assertRaises(discover.SelectorDiscoveryRefused):
                    discover.discover_selector(asterisk)

    def test_refuses_duplicate_or_conflicting_endpoint_fields(self):
        for extra in (
            f"    from_user                     : {SELECTOR_DID}\n",
            "    from_user                     : 994125550101\n",
        ):
            with self.subTest(extra=extra):
                with self.assertRaises(discover.SelectorDiscoveryRefused):
                    discover.discover_selector(
                        FakeAsterisk(endpoint=ENDPOINT_REPORT + extra),
                    )

    def test_atomic_writer_creates_one_lf_line_with_private_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "selector"

            discover.write_selector_atomic(target, SELECTOR_DID)

            self.assertEqual(target.read_bytes(), f"{SELECTOR_DID}\n".encode("ascii"))
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(target.stat().st_uid, os.geteuid())
            self.assertEqual(target.stat().st_gid, os.getegid())

    def test_atomic_writer_never_overwrites_a_file_or_follows_a_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            existing = root / "existing"
            existing.write_text("keep\n", encoding="ascii")
            with self.assertRaises(discover.SelectorDiscoveryRefused):
                discover.write_selector_atomic(existing, SELECTOR_DID)
            self.assertEqual(existing.read_text(encoding="ascii"), "keep\n")

            target = root / "selector"
            target.symlink_to(existing)
            with self.assertRaises(discover.SelectorDiscoveryRefused):
                discover.write_selector_atomic(target, SELECTOR_DID)
            self.assertTrue(target.is_symlink())
            self.assertEqual(existing.read_text(encoding="ascii"), "keep\n")


if __name__ == "__main__":
    unittest.main()
