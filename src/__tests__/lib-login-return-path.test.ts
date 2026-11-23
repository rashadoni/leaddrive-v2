// @vitest-environment jsdom
/**
 * Signing in leads back to the link that sent the person to the login — and to
 * nothing outside this site (src/lib/login-return-path.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { enterSignedInApp } from "@/lib/enter-signed-in-app"
import { loginReturnPath, rememberLoginReturn, signInDestination } from "@/lib/login-return-path"

beforeEach(() => window.sessionStorage.clear())

describe("loginReturnPath", () => {
  it("keeps a page of this site with its query", () => {
    expect(loginReturnPath("/boards/b1?task=t1")).toBe("/boards/b1?task=t1")
    expect(loginReturnPath("/tasks/t1")).toBe("/tasks/t1")
  })

  it.each([
    null, "", "boards/b1", "https://evil.example/x", "//evil.example", "/\\evil.example", "/\tevil", "/.//evil.example", "/x/..//evil.example",
    "/api/v1/users", "/api", "/login", "/login/verify-2fa", "/LOGIN", "/./login", "/forgot-password", "/reset-password?token=x", `/${"a".repeat(2001)}`,
  ])("sends %j to the home page", (raw) => {
    expect(loginReturnPath(raw)).toBe("/")
  })
})

describe("entering after the password", () => {
  it("goes to the link, also through the 2FA page that calls it again", () => {
    rememberLoginReturn("/boards/b1?task=t1")
    const assign = vi.fn()
    enterSignedInApp({ assign })
    enterSignedInApp({ assign })
    expect(assign.mock.calls).toEqual([["/boards/b1?task=t1"], ["/boards/b1?task=t1"]])
  })

  it("a sign-in without a link forgets the earlier one", () => {
    rememberLoginReturn("/boards/b1?task=t1")
    rememberLoginReturn(null)
    expect(signInDestination()).toBe("/")
  })

  it("a link kept for longer than a sign-in takes is not followed", () => {
    rememberLoginReturn("/boards/b1?task=t1", 1_000)
    expect(signInDestination(1_000 + 14 * 60_000)).toBe("/boards/b1?task=t1")
    expect(signInDestination(1_000 + 16 * 60_000)).toBe("/")
  })

  it("what stands in the tab is checked again", () => {
    window.sessionStorage.setItem("ld-after-sign-in", JSON.stringify({ path: "//evil.example", at: Date.now() }))
    expect(signInDestination()).toBe("/")
    window.sessionStorage.setItem("ld-after-sign-in", "not json")
    expect(signInDestination()).toBe("/")
  })
})
