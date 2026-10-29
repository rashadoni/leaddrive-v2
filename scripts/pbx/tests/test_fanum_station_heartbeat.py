import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("heartbeat", ROOT / "fanum-station-heartbeat.py")
heartbeat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(heartbeat)


class StationHeartbeatTests(unittest.TestCase):
    def config(self, text):
        handle = tempfile.NamedTemporaryFile("w", delete=False, suffix=".env")
        handle.write(text)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return handle.name

    def test_posts_to_the_heartbeat_route_beside_the_call_events(self):
        path = self.config('VOICE_CRM_HUMAN_LIFECYCLE_URL="https://app.leaddrivecrm.org/api/internal/asterisk/call-lifecycle"\n'
                           "VOICE_CRM_RUNTIME_TOKEN=tok\nOTHER=x\n")
        self.assertEqual(heartbeat.read_config(path),
                         ("https://app.leaddrivecrm.org/api/internal/asterisk/station-heartbeat", "tok"))

    def test_refuses_a_plain_http_or_tokenless_config(self):
        for text in ["VOICE_CRM_HUMAN_LIFECYCLE_URL=http://app.leaddrivecrm.org/x\nVOICE_CRM_RUNTIME_TOKEN=t\n",
                     "VOICE_CRM_HUMAN_LIFECYCLE_URL=https://app.leaddrivecrm.org/x\n"]:
            with self.assertRaises(ValueError):
                heartbeat.read_config(self.config(text))

    def test_reads_the_trunk_as_asterisk_20_prints_it(self):
        def run(out):
            return lambda *a, **k: SimpleNamespace(stdout=out, returncode=0)
        registered = (" <Registration/ServerURI..............................>  <Auth..........>  <Status.......>\n"
                      "==========================================================================================\n"
                      " fanum-provider-registration/sip:109.235.199.60:4959      fanum-provider   Registered        (exp. 107s)\n")
        self.assertTrue(heartbeat.trunk_registered(run(registered)))
        self.assertFalse(heartbeat.trunk_registered(run(registered.replace("Registered  ", "Rejected    "))))
        self.assertFalse(heartbeat.trunk_registered(run(registered.replace("Registered  ", "Unregistered"))))
        self.assertFalse(heartbeat.trunk_registered(run("")))
        def broken(*a, **k):
            raise subprocess.TimeoutExpired("asterisk", 10)
        self.assertFalse(heartbeat.trunk_registered(broken))

    def test_sends_only_the_two_facts_with_the_station_token(self):
        sent = []
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return None
        class O:
            def open(self, request, timeout):
                sent.append((request.full_url, request.get_header("Authorization"), json.loads(request.data), timeout))
                return Response()
        self.assertEqual(heartbeat.report("https://x.test/h", "tok", {"trunkRegistered": True, "voiceActive": False}, O()), 200)
        self.assertEqual(sent, [("https://x.test/h", "Bearer tok", {"trunkRegistered": True, "voiceActive": False}, 10)])


if __name__ == "__main__":
    unittest.main()
