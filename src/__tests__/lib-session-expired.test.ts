import { describe, it, expect } from "vitest"
import { isSessionExpiredResponse, SESSION_EXPIRED_CODE } from "@/lib/session-expired"

/** A Response as fetch() hands it back after following redirects. */
function followed(url: string, init: ResponseInit & { redirected?: boolean } = {}) {
  const response = new Response("<!DOCTYPE html><html></html>", {
    status: init.status ?? 200,
    headers: { "content-type": "text/html" },
  })
  Object.defineProperty(response, "url", { value: url })
  Object.defineProperty(response, "redirected", { value: init.redirected ?? false })
  return response
}

describe("isSessionExpiredResponse", () => {
  it("recognises the proxy's answer to a session-less API call", () => {
    const response = Response.json({ error: "Unauthorized", code: SESSION_EXPIRED_CODE }, { status: 401 })
    expect(isSessionExpiredResponse(response)).toBe(true)
  })

  it("recognises a route's own 401", () => {
    expect(isSessionExpiredResponse(Response.json({ error: "Unauthorized" }, { status: 401 }))).toBe(true)
  })

  // What the dialog received on 2026-10-02: 200, text/html, the login page.
  it("recognises a call that already followed the redirect to the login page", () => {
    const response = followed(
      "https://zeytun.leaddrivecrm.org/login?callbackUrl=%2Fapi%2Fv1%2Fusers%2Fu1%2Freset-password",
      { redirected: true },
    )
    expect(isSessionExpiredResponse(response)).toBe(true)
  })

  it("recognises a redirect into the second-factor step", () => {
    expect(isSessionExpiredResponse(followed("https://app.leaddrivecrm.org/login/verify-2fa", { redirected: true }))).toBe(true)
  })

  it("leaves ordinary answers alone", () => {
    expect(isSessionExpiredResponse(Response.json({ success: true }))).toBe(false)
    expect(isSessionExpiredResponse(Response.json({ error: "Forbidden" }, { status: 403 }))).toBe(false)
    expect(isSessionExpiredResponse(Response.json({ error: "Password is too short" }, { status: 400 }))).toBe(false)
  })

  it("does not mistake a redirect elsewhere for a lost session", () => {
    expect(isSessionExpiredResponse(followed("https://app.leaddrivecrm.org/api/v1/users/", { redirected: true }))).toBe(false)
    expect(isSessionExpiredResponse(followed("https://app.leaddrivecrm.org/login-history", { redirected: true }))).toBe(false)
  })
})
