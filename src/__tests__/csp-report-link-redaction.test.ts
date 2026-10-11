/**
 * A link in an address must not reach the server log.
 *
 * Several pages are opened by a secret in the path and nothing else — a
 * «ссылка на местоположение» (/share/location/<token>), a demo link, a
 * document to sign. Every such page reports its Content-Security-Policy
 * violations to POST /api/v1/public/csp-report, and the browser names the
 * page by its full address. Until 2026-10-11 the sink dropped the query and
 * printed the rest: the PM2 log held a working link to a named employee's
 * position for every link anybody had opened.
 *
 * The real route and the real helper; only console.warn is watched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { redactOpaquePathSegments } from "@/lib/opaque-path-redaction"

const TOKEN = "3f9a".repeat(16)
const OTHER_TOKEN = "c07e".repeat(16)

let warned: ReturnType<typeof vi.spyOn>
let POST: typeof import("@/app/api/v1/public/csp-report/route").POST

beforeEach(async () => {
  // The sink remembers what it has already printed, per process: a fresh one for each case.
  vi.resetModules()
  POST = (await import("@/app/api/v1/public/csp-report/route")).POST
  warned = vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const report = (body: unknown) =>
  POST(new NextRequest("http://localhost:3000/api/v1/public/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report" },
    body: JSON.stringify(body),
  }))
const logged = () => warned.mock.calls.map((call: unknown[]) => call.join(" "))

describe("the CSP report sink", () => {
  it("prints the page of a location link without the link: which page it was, and nothing that opens it", async () => {
    const response = await report({
      "csp-report": {
        "document-uri": `https://app.example.test/share/location/${TOKEN}?lang=ru`,
        "effective-directive": "script-src",
        "blocked-uri": "eval",
      },
    })
    expect(response.status).toBe(204)
    expect(logged()).toEqual(["[csp-report] directive=script-src blocked=eval doc=https://app.example.test/share/location/[redacted]"])
    for (const argument of warned.mock.calls.flat()) expect(String(argument)).not.toContain(TOKEN)
  })

  it("keeps ONE entry for the page however many links are opened — not one per token", async () => {
    for (const token of [TOKEN, OTHER_TOKEN, TOKEN, "0b1d".repeat(16)]) {
      await report({ "csp-report": { "document-uri": `https://app.example.test/share/location/${token}`, "effective-directive": "script-src", "blocked-uri": "eval" } })
    }
    // Printed once: the second and third tokens are the same line, already seen.
    expect(logged()).toHaveLength(1)
    // A different violation on the same page is still a line of its own.
    await report({ "csp-report": { "document-uri": `https://app.example.test/share/location/${OTHER_TOKEN}`, "effective-directive": "img-src", "blocked-uri": "https://tiles.example.test" } })
    expect(logged()).toHaveLength(2)
    expect(logged().join("\n")).not.toMatch(/[0-9a-f]{32}/)
  })

  it("takes the link out of the blocked address as well: a page refused a frame is reported under its own address", async () => {
    await report({
      "csp-report": {
        "document-uri": `https://app.example.test/share/location/${TOKEN}`,
        "effective-directive": "frame-ancestors",
        "blocked-uri": `https://app.example.test/share/location/${TOKEN}?lang=az`,
      },
    })
    expect(logged()).toHaveLength(1)
    expect(logged()[0]).toContain("blocked=https://app.example.test/share/location/[redacted]?lang=az")
    expect(logged()[0]).not.toContain(TOKEN)
  })

  it("reads the Reporting API's shape the same way, and every report of a batch", async () => {
    await report([
      { type: "csp-violation", body: { documentURL: `https://app.example.test/demo-access/${TOKEN}`, effectiveDirective: "script-src-elem", blockedURL: "inline" } },
      { type: "csp-violation", body: { documentURL: `https://app.example.test/sign/${OTHER_TOKEN}/done`, effectiveDirective: "style-src", blockedURL: "inline" } },
    ])
    expect(logged()).toEqual([
      "[csp-report] directive=script-src-elem blocked=inline doc=https://app.example.test/demo-access/[redacted]",
      "[csp-report] directive=style-src blocked=inline doc=https://app.example.test/sign/[redacted]/done",
    ])
  })

  it("still says which ordinary page a report is about", async () => {
    await report({ "csp-report": { "document-uri": "https://app.example.test/mtm/map?agent=cmuqufzve60afkp19wzxmizn7", "effective-directive": "connect-src", "blocked-uri": "https://cdn.example.test/lib.js" } })
    expect(logged()).toEqual(["[csp-report] directive=connect-src blocked=https://cdn.example.test/lib.js doc=https://app.example.test/mtm/map"])
  })
})

describe("taking a link out of an address", () => {
  it("replaces a long opaque piece of the path, wherever in the path it stands, and keeps the rest", () => {
    expect(redactOpaquePathSegments(`/share/location/${TOKEN}`)).toBe("/share/location/[redacted]")
    expect(redactOpaquePathSegments(`/api/v1/public/location-share/${TOKEN}`)).toBe("/api/v1/public/location-share/[redacted]")
    expect(redactOpaquePathSegments(`https://app.example.test/sign/${TOKEN}/done?step=2`)).toBe("https://app.example.test/sign/[redacted]/done?step=2")
    expect(redactOpaquePathSegments(`/a/${TOKEN}/b/${OTHER_TOKEN}#top`)).toBe("/a/[redacted]/b/[redacted]#top")
    // A token of any alphabet a link is made of: hex, base64url, a UUID.
    expect(redactOpaquePathSegments("/demo-access/Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFy_-")).toBe("/demo-access/[redacted]")
    expect(redactOpaquePathSegments("/x/9f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8")).toBe("/x/[redacted]")
    // Spelled with percent signs it is the same link.
    expect(redactOpaquePathSegments(`/share/location/%33f9a${TOKEN.slice(4)}`)).toBe("/share/location/[redacted]")
  })

  it("leaves ordinary addresses as they were: words, record ids, build files, a long host name", () => {
    for (const plain of [
      "/login",
      "/mtm/map",
      "/api/v1/mtm/agents/cmuqufzve60afkp19wzxmizn7",
      "/_next/static/chunks/4bd1b696-1f0f7a3ef1a2b3c4.js",
      "https://a-tenant-with-a-very-long-company-name.leaddrivecrm.org/dashboard",
      "eval",
      "inline",
      "?",
      "",
    ]) {
      expect(redactOpaquePathSegments(plain), plain).toBe(plain)
    }
    // Thirty-one characters is not yet a token of ours; thirty-two is.
    expect(redactOpaquePathSegments(`/p/${"a".repeat(31)}`)).toBe(`/p/${"a".repeat(31)}`)
    expect(redactOpaquePathSegments(`/p/${"a".repeat(32)}`)).toBe("/p/[redacted]")
  })
})
