/**
 * The two switches that stand between a broken call and an automatic dial.
 *
 * Both are tested for the closed direction first: this is the only voice
 * feature that originates a call with nobody watching, so "refuses when it
 * should" matters more than "allows when it should".
 */
import { describe, expect, it } from "vitest"

import { callbackGate } from "@/lib/voice-agent/callback-enabled"

const enabled = { automaticCallbackEnabled: true }

describe("callbackGate", () => {
  it("allows dialling only when the organisation switched it on", () => {
    expect(callbackGate({ settings: enabled, env: {} })).toEqual({ allowed: true })
  })

  it("stays off when the organisation never configured it", () => {
    // Arriving switched on with a deploy is exactly what must not happen.
    expect(callbackGate({ settings: {}, env: {} })).toEqual({
      allowed: false,
      reason: "not_enabled",
    })
  })

  it("stays off for settings that are merely truthy", () => {
    // A string "true" from a form post is not a decision anybody made about
    // automatic dialling.
    for (const value of ["true", 1, "yes", {}]) {
      expect(callbackGate({ settings: { automaticCallbackEnabled: value }, env: {} })).toEqual({
        allowed: false,
        reason: "not_enabled",
      })
    }
  })

  it("stays off when settings are missing entirely", () => {
    expect(callbackGate({ settings: null, env: {} })).toEqual({
      allowed: false,
      reason: "not_enabled",
    })
  })

  it("brakes on the env kill switch even with the setting on", () => {
    expect(callbackGate({
      settings: enabled,
      env: { VOICE_AUTOMATIC_CALLBACK_DISABLED: "1" },
    })).toEqual({ allowed: false, reason: "kill_switch" })
  })

  it("brakes on an unrecognised kill-switch value rather than ignoring it", () => {
    // Someone setting this is trying to make calls stop. A typo must not be
    // read as permission to keep dialling.
    for (const value of ["yes", "stop", "please", "TRUE"]) {
      expect(callbackGate({
        settings: enabled,
        env: { VOICE_AUTOMATIC_CALLBACK_DISABLED: value },
      })).toEqual({ allowed: false, reason: "kill_switch" })
    }
  })

  it("treats an explicit negation as not braking", () => {
    for (const value of ["0", "false", "no", "off", ""]) {
      expect(callbackGate({
        settings: enabled,
        env: { VOICE_AUTOMATIC_CALLBACK_DISABLED: value },
      })).toEqual({ allowed: true })
    }
  })

  it("reports the kill switch ahead of an unconfigured organisation", () => {
    // The brake is the more urgent fact when someone is reading logs during an
    // incident.
    expect(callbackGate({
      settings: {},
      env: { VOICE_AUTOMATIC_CALLBACK_DISABLED: "1" },
    })).toEqual({ allowed: false, reason: "kill_switch" })
  })
})
