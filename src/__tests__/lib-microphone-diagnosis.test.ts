/**
 * The five different reasons a microphone does not open, and the one message
 * that used to describe all of them.
 *
 * "Grant it from the address bar" is right for exactly one of these. For a
 * laptop with no microphone it sends someone hunting an icon that never
 * appears; for a page served over http:// it names a permission the browser
 * never offered, because there the API does not exist at all. That last case is
 * live on this deployment: two tenant custom domains are configured and neither
 * has a certificate, so voice cannot work on them however hard anyone clicks.
 */
import { describe, expect, it } from "vitest"
import {
  diagnoseMicrophoneFailure,
  microphoneMessageKey,
  microphonePrecheck,
  type MicrophoneEnvironment,
} from "@/lib/ai/voice/microphone-diagnosis"

const secure: MicrophoneEnvironment = {
  secureContext: true, mediaDevicesPresent: true, embedded: false, permission: "prompt",
}
const insecure: MicrophoneEnvironment = {
  secureContext: false, mediaDevicesPresent: false, embedded: false, permission: "unknown",
}
const framed: MicrophoneEnvironment = { ...secure, embedded: true }
const alreadyGranted: MicrophoneEnvironment = { ...secure, permission: "granted" }

function err(name: string) {
  const e = new Error(name)
  e.name = name
  return e
}

describe("microphone diagnosis", () => {
  it("names an http:// address before anything is even asked", () => {
    // The whole point: in an insecure context getUserMedia is not merely
    // denied, it is absent — the call throws a TypeError that no error-name
    // check would ever recognise as a microphone problem.
    expect(microphonePrecheck(insecure)).toBe("insecure_context")
    expect(microphonePrecheck(secure)).toBeNull()
    expect(diagnoseMicrophoneFailure(new TypeError("undefined is not an object"), insecure))
      .toBe("insecure_context")
  })

  it("tells a missing microphone apart from a refused one", () => {
    expect(diagnoseMicrophoneFailure(err("NotFoundError"), secure)).toBe("no_device")
    expect(diagnoseMicrophoneFailure(err("OverconstrainedError"), secure)).toBe("no_device")
    expect(diagnoseMicrophoneFailure(err("NotAllowedError"), secure)).toBe("blocked")
  })

  it("tells a busy microphone apart from a refused one", () => {
    // Another calling app, or the operating system's own privacy switch.
    // Nothing in the address bar helps here either.
    expect(diagnoseMicrophoneFailure(err("NotReadableError"), secure)).toBe("device_busy")
    expect(diagnoseMicrophoneFailure(err("AbortError"), secure)).toBe("device_busy")
  })

  it("calls a held microphone busy when the site already has permission", () => {
    // macOS reports a device held by another application as NotAllowedError —
    // the same name a person clicking "block" produces. The permission the site
    // already holds is what separates them: it cannot be the thing that just
    // refused. Observed on 2026-08-28 with the owner mid-presentation, told to
    // grant a permission that was already granted while a video call held the
    // microphone.
    expect(diagnoseMicrophoneFailure(err("NotAllowedError"), alreadyGranted)).toBe("device_busy")
    expect(diagnoseMicrophoneFailure(err("SecurityError"), alreadyGranted)).toBe("device_busy")
  })

  it("keeps the denial message for every state that is not a held permission", () => {
    // "denied" is a real refusal, "prompt" means it was never granted, and a
    // browser that cannot answer must not have an answer invented for it.
    for (const permission of ["denied", "prompt", "unknown"] as const) {
      expect(diagnoseMicrophoneFailure(err("NotAllowedError"), { ...secure, permission }))
        .toBe("blocked")
    }
  })

  it("still blames the embed even when the permission was granted", () => {
    // A frame that does not carry allow="microphone" is the administrator's
    // problem whatever the top-level permission says, so the frame check has to
    // stay ahead of the permission one.
    expect(diagnoseMicrophoneFailure(err("NotAllowedError"), { ...alreadyGranted, embedded: true }))
      .toBe("embedded")
  })

  it("blames the embed, not the person, when the page is in a frame", () => {
    // A frame without allow="microphone" and a person clicking "block" both
    // arrive as NotAllowedError, and the fixes are in different hands.
    expect(diagnoseMicrophoneFailure(err("NotAllowedError"), framed)).toBe("embedded")
    expect(diagnoseMicrophoneFailure(err("SecurityError"), framed)).toBe("embedded")
  })

  it("admits it does not know rather than guessing", () => {
    expect(diagnoseMicrophoneFailure(err("SomethingNew"), secure)).toBe("unknown")
    expect(diagnoseMicrophoneFailure(null, secure)).toBe("unknown")
  })

  it("gives every cause its own sentence", () => {
    const keys = (["insecure_context", "embedded", "no_device", "device_busy", "blocked", "unknown"] as const)
      .map((problem) => microphoneMessageKey(problem))
    expect(new Set(keys).size).toBe(keys.length)
  })
})
