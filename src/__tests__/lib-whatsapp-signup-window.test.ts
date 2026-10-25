import { describe, expect, it } from "vitest"
import {
  WHATSAPP_SIGNUP_RELAY_TYPE,
  isSignupReturnOrigin,
  readRelayedSignup,
  signupWindowUrl,
} from "@/lib/whatsapp-signup-window"

// Meta starts its JS SDK only on app.leaddrivecrm.org; tenant hosts run Embedded Signup through a
// window there (zeytun.leaddrivecrm.org: «Неизвестный домен размещения JSSDK», 2026-10-26).
const APP = "https://app.leaddrivecrm.org"

describe("isSignupReturnOrigin", () => {
  it.each([
    "https://zeytun.leaddrivecrm.org",
    "https://app.leaddrivecrm.org",
  ])("accepts %s", (origin) => {
    expect(isSignupReturnOrigin(origin, APP)).toBe(true)
  })

  it.each([
    null,
    "",
    "https://evil.example",
    "https://leaddrivecrm.org.evil.example",
    "https://zeytun.leaddrivecrm.org.evil.example",
    "http://zeytun.leaddrivecrm.org", // not https
    "https://admin.leaddrivecrm.org", // reserved subdomain
    "https://a.b.leaddrivecrm.org", // not a single tenant label
    "https://zeytun.leaddrivecrm.org/settings", // a URL, not an origin
    "https://user@zeytun.leaddrivecrm.org",
    "javascript:alert(1)",
  ])("refuses %s", (origin) => {
    expect(isSignupReturnOrigin(origin, APP)).toBe(false)
  })
})

describe("signupWindowUrl", () => {
  it("points at the app host with the tenant origin and a known language", () => {
    const url = new URL(signupWindowUrl("https://zeytun.leaddrivecrm.org", "az", APP))
    expect(url.origin).toBe(APP)
    expect(url.pathname).toBe("/connect/whatsapp")
    expect(url.searchParams.get("origin")).toBe("https://zeytun.leaddrivecrm.org")
    expect(url.searchParams.get("lang")).toBe("az")
    expect(new URL(signupWindowUrl("https://zeytun.leaddrivecrm.org", "xx", APP)).searchParams.has("lang")).toBe(false)
  })
})

describe("readRelayedSignup", () => {
  const connected = {
    type: WHATSAPP_SIGNUP_RELAY_TYPE,
    result: "connected",
    code: "ONE_TIME_CODE",
    wabaId: "111222333",
    phoneNumberId: "444555666",
    businessId: "777",
  }

  it("reads the window's result from the app origin", () => {
    expect(readRelayedSignup(APP, connected, APP)).toEqual({
      kind: "connected", code: "ONE_TIME_CODE", wabaId: "111222333", phoneNumberId: "444555666", businessId: "777",
    })
    expect(readRelayedSignup(APP, { type: WHATSAPP_SIGNUP_RELAY_TYPE, result: "cancel" }, APP)).toEqual({ kind: "cancel" })
    expect(readRelayedSignup(APP, { type: WHATSAPP_SIGNUP_RELAY_TYPE, result: "failed" }, APP)).toEqual({ kind: "failed" })
  })

  it("ignores the same message from any other origin, and malformed ones", () => {
    expect(readRelayedSignup("https://evil.example", connected, APP)).toBeNull()
    expect(readRelayedSignup("https://zeytun.leaddrivecrm.org", connected, APP)).toBeNull()
    expect(readRelayedSignup(APP, { ...connected, type: "WA_EMBEDDED_SIGNUP" }, APP)).toBeNull()
    expect(readRelayedSignup(APP, { ...connected, wabaId: "abc" }, APP)).toBeNull()
    expect(readRelayedSignup(APP, { ...connected, code: "" }, APP)).toBeNull()
    expect(readRelayedSignup(APP, JSON.stringify(connected), APP)).toBeNull()
  })
})
