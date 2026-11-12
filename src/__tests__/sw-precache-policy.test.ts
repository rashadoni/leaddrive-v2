/**
 * The service worker no longer fetches the whole build ahead of time (2 437 files, ~30 MB re-fetched
 * by every browser after every deploy — 247 MB on the owner's Mac on 2026-11-12).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { precacheOfflineOnly } from "@/lib/sw-precache-policy"

describe("service worker precache", () => {
  it("drops every build file and keeps only the offline page", async () => {
    const { manifest, warnings } = await precacheOfflineOnly([
      { url: "/_next/static/chunks/71303.a071c85abe098a9a.js", revision: null, size: 1 },
      { url: "/_next/static/css/app.css", revision: null, size: 1 },
      { url: "/_next/static/media/font.woff2", revision: null, size: 1 },
      { url: "/offline", revision: null, size: 1 },
    ])
    expect(manifest).toEqual([{ url: "/offline", revision: null, size: 1 }])
    expect(warnings).toEqual([])
  })

  it("is wired into the build, and the worker still caches files as pages open", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8")
    expect(config).toMatch(/manifestTransforms:\s*\[precacheOfflineOnly\]/)
    expect(config).toMatch(/additionalPrecacheEntries:\s*\[\{ url: "\/offline"/)
    const worker = readFileSync(join(process.cwd(), "src/sw.ts"), "utf8")
    expect(worker).toMatch(/\.\.\.defaultCache/)
    expect(worker).toMatch(/url: "\/offline"/)
  })
})
