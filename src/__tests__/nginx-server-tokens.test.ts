import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const configs = [
  "nginx/wildcard.leaddrivecrm.org.conf",
  "nginx/leaddrive.conf",
  "clients/nginx/template.conf",
]

describe("Nginx public server identity", () => {
  it.each(configs)("disables version tokens in every server block: %s", (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), "utf8")
    const serverBlocks = source.match(/^server \{/gm) ?? []
    const tokenDirectives = source.match(/^\s+server_tokens off;$/gm) ?? []

    expect(serverBlocks.length).toBeGreaterThan(0)
    expect(tokenDirectives).toHaveLength(serverBlocks.length)
  })

  // `server_tokens off` removes the version from the banner and from the error
  // page footer, but leaves the stock page itself — the 2026-08 re-test read
  // `<hr><center>nginx</center>` out of a live 414 body, straight through
  // Cloudflare. Asserting only on server_tokens was green while that was true,
  // which is the failure mode worth pinning: the check has to cover the page,
  // not just the version.
  it.each(configs)("replaces the stock error pages in every server block: %s", (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), "utf8")
    const serverBlocks = source.match(/^server \{/gm) ?? []
    const includes = source.match(/^\s+include snippets\/leaddrive-error-pages\.conf;$/gm) ?? []

    expect(includes).toHaveLength(serverBlocks.length)
  })

  it("ships an error page whose filename matches the URI nginx serves it under", () => {
    const snippet = readFileSync(resolve(process.cwd(), "ops/nginx/leaddrive-error-pages.conf"), "utf8")

    const uri = snippet.match(/^location = (\/\S+)/m)?.[1]
    const root = snippet.match(/^\s+root (\S+);$/m)?.[1]
    expect(uri).toBeDefined()
    expect(root).toBe("/etc/nginx/errors")

    // root + URI is where nginx looks. A mismatch here is silent: the internal
    // redirect misses, nginx detects error_page recursion, and serves the stock
    // page again — config valid, reload clean, nothing fixed.
    const page = readFileSync(
      resolve(process.cwd(), `ops/nginx/errors${uri}`),
      "utf8",
    )
    expect(page).not.toMatch(/nginx/i)
    expect(snippet).toMatch(/^error_page .*\s\/__leaddrive_error\.html;$/m)
  })

  it("also disables the Next.js framework banner", () => {
    const source = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8")
    expect(source).toMatch(/poweredByHeader:\s*false/)
  })
})
