import importlib.util
import io
import os
import struct
import tempfile
import unittest
import urllib.error
import warnings
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    spec = importlib.util.spec_from_file_location("recordings", ROOT / "fanum-call-recordings.py")
    recordings = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(recordings)

CALL = "17492d7a-9aff-416e-b329-dc405eda13a4"


def pcm_wave(seconds=1.0, rate=8000, channels=1):
    out = io.BytesIO()
    with wave.open(out, "wb") as target:
        target.setnchannels(channels)
        target.setsampwidth(2)
        target.setframerate(rate)
        frames = int(seconds * rate)
        target.writeframes(b"".join(struct.pack("<h", (i * 97) % 2000 - 1000) * channels for i in range(frames)))
    return out.getvalue()


class CallRecordingsTests(unittest.TestCase):
    """Owner, 2026-10-31: «нужно чтоб и диалог записывался»."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = self.tmp.name
        self.now = 1_000_000.0
        self.posts, self.logs = [], []
        self.answer = lambda: 200

    def keep(self, name=CALL + ".wav", data=None, age=60):
        path = os.path.join(self.dir, name)
        with open(path, "wb") as handle:
            handle.write(pcm_wave() if data is None else data)
        os.utime(path, (self.now - age, self.now - age))
        return path

    def post(self, url, token, call_id, body):
        self.posts.append((url, token, call_id, body))
        status = self.answer()
        if isinstance(status, Exception):
            raise status
        return status

    def run_once(self):
        return recordings.run_once("https://crm.test/api/internal/asterisk/call-recording", "tok", self.dir,
                                   now=self.now, post=self.post, log=self.logs.append)

    def test_posts_to_the_recording_route_beside_the_call_events(self):
        handle = tempfile.NamedTemporaryFile("w", delete=False, suffix=".env")
        handle.write('VOICE_CRM_HUMAN_LIFECYCLE_URL="https://app.leaddrivecrm.org/api/internal/asterisk/call-lifecycle"\n'
                     "VOICE_CRM_RUNTIME_TOKEN=tok\n")
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        self.assertEqual(recordings.read_config(handle.name),
                         ("https://app.leaddrivecrm.org/api/internal/asterisk/call-recording", "tok"))

    def test_sends_a_finished_call_as_mulaw_and_deletes_it(self):
        path = self.keep()
        self.assertEqual(self.run_once()["sent"], 1)
        self.assertFalse(os.path.exists(path))
        _url, token, call_id, body = self.posts[0]
        self.assertEqual((token, call_id), ("tok", CALL))
        # WAVE_FORMAT_MULAW, 8 kHz mono, one byte a sample: one second is 8000 bytes.
        self.assertEqual(body[:4] + body[8:16], b"RIFFWAVEfmt ")
        self.assertEqual(struct.unpack("<HHI", body[20:28]), (7, 1, 8000))
        self.assertEqual(struct.unpack("<I", body[4:8])[0], len(body) - 8)
        self.assertEqual(len(body), 58 + 8000)

    def test_a_call_still_being_recorded_waits(self):
        path = self.keep(age=5)
        self.assertEqual(self.run_once()["waiting"], 1)
        self.assertEqual(self.posts, [])
        self.assertTrue(os.path.exists(path))

    def test_a_crm_that_does_not_answer_keeps_the_file_for_the_next_run(self):
        path = self.keep()
        for answer in [urllib.error.URLError("timed out"),
                       urllib.error.HTTPError("u", 503, "x", {}, None), urllib.error.HTTPError("u", 409, "x", {}, None),
                       urllib.error.HTTPError("u", 401, "x", {}, None)]:
            self.answer = lambda answer=answer: answer
            self.assertEqual(self.run_once()["retry"], 1)
            self.assertTrue(os.path.exists(path))

    def test_a_refused_or_day_old_recording_is_deleted(self):
        path = self.keep()
        self.answer = lambda: urllib.error.HTTPError("u", 404, "x", {}, None)
        self.assertEqual(self.run_once()["dropped"], 1)
        self.assertFalse(os.path.exists(path))
        old = self.keep(age=recordings.KEEP_SECONDS + 1)
        self.assertEqual(self.run_once()["dropped"], 1)
        self.assertFalse(os.path.exists(old))
        broken = self.keep(data=b"not a wave")
        self.assertEqual(self.run_once()["dropped"], 1)
        self.assertFalse(os.path.exists(broken))
        self.assertEqual(len(self.posts), 1)

    def test_only_call_named_files_are_touched(self):
        other = self.keep(name="notes.wav")
        self.assertEqual(self.run_once(), {"sent": 0, "waiting": 0, "dropped": 0, "retry": 0})
        self.assertTrue(os.path.exists(other))

    def test_wideband_or_stereo_audio_becomes_8_khz_mono_and_a_long_one_is_cut(self):
        body = recordings.mulaw_wave(pcm_wave(seconds=1.0, rate=16000, channels=2))
        self.assertAlmostEqual(len(body) - 58, 8000, delta=10)
        long = recordings.mulaw_wave(pcm_wave(seconds=1300, rate=8000))
        self.assertEqual(len(long), recordings.MAX_BYTES)
        self.assertEqual(struct.unpack("<I", long[54:58])[0], recordings.MAX_BYTES - 58)


if __name__ == "__main__":
    unittest.main()
