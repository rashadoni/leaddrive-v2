import { describe, expect, it } from "vitest"
import {
  microphoneProcessingTrace,
  readMicrophoneProcessingSnapshot,
} from "@/lib/ai/voice/microphone-processing"

function track(
  settings: MediaTrackSettings,
  capabilities: MediaTrackCapabilities,
): MediaStreamTrack {
  return {
    getSettings: () => settings,
    getCapabilities: () => capabilities,
  } as MediaStreamTrack
}

describe("microphone processing telemetry", () => {
  it("captures applied processing without device identifiers", () => {
    const snapshot = readMicrophoneProcessingSnapshot(track(
      {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
        sampleRate: 48_000,
        channelCount: 1,
        deviceId: "private-device-id",
      },
      {
        echoCancellation: [true, false],
        noiseSuppression: [true, false],
        autoGainControl: [true, false],
        deviceId: "private-capability-id",
      },
    ))

    expect(snapshot).toEqual({
      echoCancellation: { applied: "on", available: "yes" },
      noiseSuppression: { applied: "off", available: "yes" },
      autoGainControl: { applied: "on", available: "yes" },
      sampleRate: 48_000,
      channelCount: 1,
    })
    expect(microphoneProcessingTrace(snapshot)).toBe(
      "req_on.ec_1_y.ns_0_y.ag_1_y.sr_48000.ch_1",
    )
    expect(JSON.stringify(snapshot)).not.toContain("private")
  })

  it("fails safely when optional browser APIs are unavailable", () => {
    const snapshot = readMicrophoneProcessingSnapshot({} as MediaStreamTrack)
    expect(microphoneProcessingTrace(snapshot)).toBe(
      "req_on.ec_u_u.ns_u_u.ag_u_u.sr_u.ch_u",
    )
  })
})
