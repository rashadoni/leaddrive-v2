/**
 * F-41 regression net: /api/v1/uploads/[...path] proxy.
 *
 * The route's job is to read runtime-uploaded files from disk + stream
 * them back through Next.js (since `output: "standalone"` won't serve
 * them directly). Canonical-public naming, session/RBAC/tenant checks,
 * subdir policy, and path validation form the serving boundary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}))
vi.mock("fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fs")>()),
  createReadStream: vi.fn(),
}))
vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimit: vi.fn(),
  acquirePublicConcurrencySlot: vi.fn(),
  releasePublicConcurrencySlot: vi.fn(),
}))

// Architect-tightened: use the real `instanceof NextResponse` predicate so
// the test mock matches the production path exactly. A loose structural
// stand-in (status + typeof object) would silently flag any 4xx Response
// passing through the route, masking a refactor that started returning
// non-auth NextResponses from requireAuth.
vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(),
  isAuthError: (v: any) => v instanceof NextResponse,
  orgHasModule: vi.fn(async () => true),
}))

// Prisma mock for the cross-tenant guard's DB lookups
// (`mtm-photos` → MtmPhoto, `contracts` → ContractFile).
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mtmPhoto: { findFirst: vi.fn() },
    contractFile: { findFirst: vi.fn() },
  },
}))

import { GET } from "@/app/api/v1/uploads/[...path]/route"
import { stat, readFile } from "fs/promises"
import { createReadStream } from "fs"
import { Readable } from "stream"
import { orgHasModule, requireSessionAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import {
  acquirePublicConcurrencySlot,
  consumePublicRateLimit,
  releasePublicConcurrencySlot,
} from "@/lib/public-abuse-guard"

const AUTH_OK = { orgId: "org-1", userId: "u1", role: "admin" } as any

function pp(parts: string[]) {
  return { params: Promise.resolve({ path: parts }) }
}
function req(): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/v1/uploads/x"))
}

beforeEach(() => {
  vi.clearAllMocks()
  // Public-path tests intentionally assert that auth is never called after
  // queuing a denial. Clear that unused once-queue between tests; otherwise a
  // stale 401 can leak into a later authenticated-path assertion.
  vi.mocked(requireSessionAuth).mockReset()
  vi.mocked(requireSessionAuth).mockResolvedValue(AUTH_OK)
  // A previous success must not leave stat() resolving in a test that only
  // intends to inspect authentication. Default to a missing file; serving
  // scenarios opt in to their own concrete stat result below.
  vi.mocked(stat).mockReset()
  vi.mocked(stat).mockRejectedValue(new Error("ENOENT"))
  vi.mocked(readFile).mockReset()
  vi.mocked(consumePublicRateLimit).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
  })
  vi.mocked(acquirePublicConcurrencySlot).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
    backend: "memory",
    key: "test-slot",
    token: "test-token",
  })
  vi.mocked(releasePublicConcurrencySlot).mockResolvedValue(undefined)
  vi.mocked(createReadStream).mockReturnValue(Readable.from([Buffer.from([0])]) as any)
  // Default: cross-tenant DB lookups succeed for the caller's org so
  // existing tests that don't care about the guard keep working. Tests
  // that exercise the guard explicitly override with mockResolvedValueOnce.
  vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValue({ id: "p1" } as any)
  vi.mocked(prisma.contractFile.findFirst).mockResolvedValue({ id: "cf1" } as any)
})

describe("GET /api/v1/uploads/[...path]", () => {
  it("returns 401 when there is no browser session", async () => {
    // Real NextResponse so the production `isAuthError = v instanceof
    // NextResponse` predicate fires correctly. A bare `new Response(...)`
    // would slip past it.
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    vi.mocked(requireSessionAuth).mockResolvedValue(denied as any)
    const res = await GET(req(), pp(["mtm-photos", "x.jpg"]))
    expect(res.status).toBe(401)
  })

  it.each([
    ["email template image", ["email-images", "org-1", `img-${"a".repeat(32)}.png`]],
    ["tenant logo", ["logos", `logo-${"b".repeat(32)}.webp`]],
  ] as Array<[string, string[]]>)("serves a canonical public-safe %s without a browser session", async (_label, parts) => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any,
    )
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 4 } as any)

    const res = await GET(req(), pp(parts))

    expect(res.status).toBe(200)
    expect(requireSessionAuth).not.toHaveBeenCalled()
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin")
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename=/)
    expect(res.headers.get("referrer-policy")).toBe("no-referrer")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("content-security-policy")).toContain("sandbox")
    await res.arrayBuffer()
    // The Web-stream read can settle one tick before the adapted Node stream's
    // close handler releases its slot. Wait here so that callback cannot leak
    // into the next test after clearAllMocks() has reset call history.
    await vi.waitFor(() => expect(releasePublicConcurrencySlot).toHaveBeenCalledOnce())
  })

  it.each([
    ["contracts", ["contracts", "private.pdf"]],
    ["inbox", ["inbox", "org-1", "private.pdf"]],
    ["MTM photos", ["mtm-photos", "private.jpg"]],
    ["MTM invoices", ["mtm-invoices", "org-1", "private.pdf"]],
    ["WhatsApp", ["whatsapp", "org-1", "private.jpg"]],
    ["Telegram", ["telegram", "org-1", "private.jpg"]],
  ] as Array<[string, string[]]>)("keeps anonymous %s reads private", async (_label, parts) => {
    const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    vi.mocked(requireSessionAuth).mockResolvedValueOnce(denied as any)

    const res = await GET(req(), pp(parts))

    expect(res.status).toBe(401)
    expect(stat).not.toHaveBeenCalled()
  })

  it("does not treat malformed public-looking paths as anonymous-safe", async () => {
    const malformed = [
      ["email-images", "org-1", "img-abc.png"],
      ["email-images", "../org-1", `img-${"a".repeat(32)}.png`],
      ["email-images", "org-1", `img-${"a".repeat(32)}.svg`],
      ["logos", `logo-${"b".repeat(16)}.png`],
      ["logos", `logo-${"b".repeat(32)}.png`, "extra"],
    ]

    for (const parts of malformed) {
      const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      vi.mocked(requireSessionAuth).mockResolvedValueOnce(denied as any)
      const res = await GET(req(), pp(parts))
      expect(res.status).toBe(401)
    }
    expect(stat).not.toHaveBeenCalled()
  })

  it("uses session-only auth so an API key cannot impersonate its creator", async () => {
    await GET(req(), pp(["mtm-photos", "x.jpg"]))
    expect(requireSessionAuth).toHaveBeenCalledOnce()
  })

  it("returns 404 when subdir is not whitelisted", async () => {
    const res = await GET(req(), pp(["secret-vault", "leak.txt"]))
    expect(res.status).toBe(404)
    expect(stat).not.toHaveBeenCalled()
  })

  it("requires the caller's role and tenant to have the subdir module", async () => {
    vi.mocked(requireSessionAuth).mockResolvedValueOnce({
      ...AUTH_OK,
      role: "ticketing",
    })
    const deniedByRole = await GET(req(), pp(["contracts", "known.pdf"]))
    expect(deniedByRole.status).toBe(404)
    expect(prisma.contractFile.findFirst).not.toHaveBeenCalled()

    vi.mocked(orgHasModule).mockResolvedValueOnce(false)
    const deniedByTenant = await GET(req(), pp(["contracts", "known.pdf"]))
    expect(deniedByTenant.status).toBe(404)
    expect(prisma.contractFile.findFirst).not.toHaveBeenCalled()
  })

  it("returns 404 when path tries to traverse outside uploads root", async () => {
    // `path.resolve(uploadsRoot, "mtm-photos", "..", "..", "etc", "passwd")`
    // = `/etc/passwd` (or similar) → startsWith(uploadsRoot + sep) fails.
    const res = await GET(req(), pp(["mtm-photos", "..", "..", "etc", "passwd"]))
    expect(res.status).toBe(404)
    expect(stat).not.toHaveBeenCalled()
  })

  it("rejects cross-subdir traversal before the cheaper guard can be reused", async () => {
    const res = await GET(req(), pp([
      "email-images",
      "org-1",
      "..",
      "..",
      "contracts",
      "other-tenant.pdf",
    ]))
    expect(res.status).toBe(404)
    expect(prisma.contractFile.findFirst).not.toHaveBeenCalled()
    expect(stat).not.toHaveBeenCalled()
  })

  it("returns 404 when file is missing on disk (stat throws)", async () => {
    vi.mocked(stat).mockRejectedValue(new Error("ENOENT"))
    const res = await GET(req(), pp(["mtm-photos", "missing.jpg"]))
    expect(res.status).toBe(404)
  })

  it("returns 404 when path resolves to a directory", async () => {
    vi.mocked(stat).mockResolvedValue({ isFile: () => false, size: 0 } as any)
    const res = await GET(req(), pp(["mtm-photos", "subdir"]))
    expect(res.status).toBe(404)
  })

  it("returns 200 + image/jpeg for a JPG photo", async () => {
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 12345 } as any)
    vi.mocked(readFile).mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    const res = await GET(req(), pp(["mtm-photos", "real.jpg"]))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/jpeg")
    expect(res.headers.get("content-length")).toBe("12345")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(res.headers.get("cache-control")).not.toContain("public")
    expect(res.headers.get("vary")).toContain("Authorization")
    await res.arrayBuffer()
    await vi.waitFor(() => expect(releasePublicConcurrencySlot).toHaveBeenCalledOnce())
  })

  it("fails closed when the shared download limiter is unavailable", async () => {
    vi.mocked(consumePublicRateLimit).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 1,
      unavailable: true,
    })
    const res = await GET(req(), pp(["mtm-photos", "x.jpg"]))
    expect(res.status).toBe(503)
    expect(stat).not.toHaveBeenCalled()
  })

  it("caps concurrent streaming downloads", async () => {
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 1024 } as any)
    vi.mocked(acquirePublicConcurrencySlot).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 20,
      unavailable: false,
    })
    const res = await GET(req(), pp(["mtm-photos", "owned.jpg"]))
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("20")
    expect(createReadStream).not.toHaveBeenCalled()
  })

  it("refuses disk files above the hard serving cap", async () => {
    vi.mocked(stat).mockResolvedValue({
      isFile: () => true,
      size: 50 * 1024 * 1024 + 1,
    } as any)
    const res = await GET(req(), pp(["mtm-photos", "owned.jpg"]))
    expect(res.status).toBe(413)
    expect(acquirePublicConcurrencySlot).not.toHaveBeenCalled()
    expect(createReadStream).not.toHaveBeenCalled()
  })

  it("returns 200 + application/pdf for a contract PDF", async () => {
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 99999 } as any)
    vi.mocked(readFile).mockResolvedValue(Buffer.from([0x25, 0x50, 0x44, 0x46]))
    const res = await GET(req(), pp(["contracts", "deal-2026-q1.pdf"]))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/pdf")
  })

  it("returns 200 + word docx MIME for .docx (architect-flagged extension)", async () => {
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 50000 } as any)
    vi.mocked(readFile).mockResolvedValue(Buffer.alloc(50000))
    const res = await GET(req(), pp(["contracts", "draft.docx"]))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
  })

  it("supports per-org subdirs (web-chat/<orgId>/<file>)", async () => {
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 8 } as any)
    vi.mocked(readFile).mockResolvedValue(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))
    // Path-encoded orgId must match the caller's org for the guard to pass.
    const res = await GET(req(), pp(["web-chat", "org-1", "attachment.png"]))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
  })

  // ── Cross-tenant guard (Task #65 follow-up) ────────────────────
  describe("Cross-tenant guard", () => {
    beforeEach(() => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 4 } as any)
      vi.mocked(readFile).mockResolvedValue(Buffer.from([1, 2, 3, 4]))
    })

    // Path-encoded subdirs: orgId comes from parts[1].
    it("path-encoded: 404 when mtm-invoices orgId in path ≠ caller's org", async () => {
      const res = await GET(req(), pp(["mtm-invoices", "OTHER-ORG", "invoice.pdf"]))
      expect(res.status).toBe(404)
      expect(stat).not.toHaveBeenCalled()
    })

    it("path-encoded: 200 when mtm-invoices orgId matches", async () => {
      const res = await GET(req(), pp(["mtm-invoices", "org-1", "invoice.pdf"]))
      expect(res.status).toBe(200)
    })

    it("path-encoded: 404 when email-images orgId ≠ caller's org", async () => {
      const res = await GET(req(), pp(["email-images", "OTHER-ORG", "img-abc.png"]))
      expect(res.status).toBe(404)
      expect(stat).not.toHaveBeenCalled()
    })

    it("path-encoded: 200 when email-images orgId matches", async () => {
      const res = await GET(req(), pp(["email-images", "org-1", "img-abc.png"]))
      expect(res.status).toBe(200)
    })

    it("path-encoded: 404 when web-chat orgId ≠ caller's org", async () => {
      const res = await GET(req(), pp(["web-chat", "OTHER-ORG", "doc.pdf"]))
      expect(res.status).toBe(404)
      expect(stat).not.toHaveBeenCalled()
    })

    it("path-encoded: 404 when a monitoring logo orgId ≠ caller's org", async () => {
      const res = await GET(req(), pp(["social-logos", "OTHER-ORG", "brand.webp"]))
      expect(res.status).toBe(404)
      expect(stat).not.toHaveBeenCalled()
    })

    it("path-encoded: 200 when a monitoring logo orgId matches caller's org", async () => {
      const res = await GET(req(), pp(["social-logos", "org-1", "brand.webp"]))
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe("image/webp")
    })

    it("path-encoded: serves only avatars from the caller's organization", async () => {
      const filename = `av-${"a".repeat(32)}.webp`
      const denied = await GET(req(), pp(["avatars", "OTHER-ORG", filename]))
      expect(denied.status).toBe(404)
      expect(stat).not.toHaveBeenCalled()

      const allowed = await GET(req(), pp(["avatars", "org-1", filename]))
      expect(allowed.status).toBe(200)
      expect(allowed.headers.get("content-type")).toBe("image/webp")
      expect(allowed.headers.get("x-content-type-options")).toBe("nosniff")
    })

    it("quarantines legacy avatar names that were stored before re-encoding", async () => {
      const legacyNames = [
        "av-33afb9a4dbe1d01c.png",
        `av-${"a".repeat(16)}.webp`,
        `av-${"a".repeat(32)}.png`,
      ]
      for (const filename of legacyNames) {
        const res = await GET(req(), pp(["avatars", "org-1", filename]))
        expect(res.status).toBe(404)
      }
      expect(stat).not.toHaveBeenCalled()
    })

    // Inbound WhatsApp media (Slice 1): /uploads/whatsapp/<orgId>/<file> — same path-encoded
    // org scoping as web-chat, so one tenant can't fetch another's downloaded media by guessing.
    it("path-encoded: 404 when whatsapp orgId ≠ caller's org (inbound-media cross-tenant block)", async () => {
      const res = await GET(req(), pp(["whatsapp", "OTHER-ORG", "abc123.jpg"]))
      expect(res.status).toBe(404)
      expect(stat).not.toHaveBeenCalled()
    })

    it("path-encoded: 200 when whatsapp orgId matches caller's org", async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 4 } as any)
      vi.mocked(readFile).mockResolvedValue(Buffer.from([1, 2, 3, 4]))
      const res = await GET(req(), pp(["whatsapp", "org-1", "abc123.jpg"]))
      expect(res.status).toBe(200)
    })

    // Inbound Telegram media (Slice 2): /uploads/telegram/<orgId>/<file> — same org scoping.
    it("path-encoded: 404 when telegram orgId ≠ caller's org (inbound-media cross-tenant block)", async () => {
      const res = await GET(req(), pp(["telegram", "OTHER-ORG", "def456.jpg"]))
      expect(res.status).toBe(404)
      expect(stat).not.toHaveBeenCalled()
    })

    it("path-encoded: 200 when telegram orgId matches caller's org", async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 4 } as any)
      vi.mocked(readFile).mockResolvedValue(Buffer.from([1, 2, 3, 4]))
      const res = await GET(req(), pp(["telegram", "org-1", "def456.jpg"]))
      expect(res.status).toBe(200)
    })

    // Outbound inbox attachments (Slice 3): /uploads/inbox/<orgId>/<file> — same org scoping.
    it("path-encoded: 404 when inbox orgId ≠ caller's org (outbound-attachment cross-tenant block)", async () => {
      const res = await GET(req(), pp(["inbox", "OTHER-ORG", "att789.pdf"]))
      expect(res.status).toBe(404)
      expect(stat).not.toHaveBeenCalled()
    })

    it("path-encoded: 200 when inbox orgId matches caller's org", async () => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 4 } as any)
      vi.mocked(readFile).mockResolvedValue(Buffer.from([1, 2, 3, 4]))
      const res = await GET(req(), pp(["inbox", "org-1", "att789.pdf"]))
      expect(res.status).toBe(200)
    })

    it("path-encoded: 404 for a retired subdir even with matching org", async () => {
      const res = await GET(req(), pp(["mtm-retired", "org-1", "retired-abc.jpg"]))
      expect(res.status).toBe(404)
      expect(stat).not.toHaveBeenCalled()
    })

    // DB-resolved subdirs: ownership lives in a table row.
    it("mtm-photos: 404 when DB lookup returns no row for caller's org", async () => {
      vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValueOnce(null)
      const res = await GET(req(), pp(["mtm-photos", "1234-othertenant.jpg"]))
      expect(res.status).toBe(404)
      expect(stat).not.toHaveBeenCalled()
      // Query must filter on the bare URL + organizationId.
      const call = vi.mocked(prisma.mtmPhoto.findFirst).mock.calls[0][0] as any
      expect(call.where.organizationId).toBe("org-1")
      expect(call.where.url).toBe("/uploads/mtm-photos/1234-othertenant.jpg")
    })

    it("mtm-photos: 200 when DB has matching row for caller's org", async () => {
      vi.mocked(prisma.mtmPhoto.findFirst).mockResolvedValueOnce({ id: "p1" } as any)
      const res = await GET(req(), pp(["mtm-photos", "owned.jpg"]))
      expect(res.status).toBe(200)
    })

    it("contracts: 404 when DB lookup returns no row for caller's org", async () => {
      vi.mocked(prisma.contractFile.findFirst).mockResolvedValueOnce(null)
      const res = await GET(req(), pp(["contracts", "stranger.pdf"]))
      expect(res.status).toBe(404)
      expect(stat).not.toHaveBeenCalled()
      const call = vi.mocked(prisma.contractFile.findFirst).mock.calls[0][0] as any
      expect(call.where.organizationId).toBe("org-1")
      expect(call.where.fileName).toBe("stranger.pdf")
    })

    it("contracts: 200 when DB has matching row for caller's org", async () => {
      vi.mocked(prisma.contractFile.findFirst).mockResolvedValueOnce({ id: "cf1" } as any)
      const res = await GET(req(), pp(["contracts", "owned.pdf"]))
      expect(res.status).toBe(200)
    })

    // A legacy/noncanonical logo name reaches the authenticated branch, but
    // logos intentionally have no tenant-row lookup: only superadmins create
    // them and branding references may be assigned after upload.
    it("legacy logos: session-gated, then skips a cross-tenant lookup", async () => {
      const res = await GET(req(), pp(["logos", "logo-abc.png"]))
      expect(res.status).toBe(200)
      // Neither DB lookup is called for logos.
      expect(prisma.mtmPhoto.findFirst).not.toHaveBeenCalled()
      expect(prisma.contractFile.findFirst).not.toHaveBeenCalled()
    })
  })

  it("falls back to application/octet-stream for unknown extension", async () => {
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 1 } as any)
    vi.mocked(readFile).mockResolvedValue(Buffer.from([0]))
    const res = await GET(req(), pp(["mtm-photos", "weird.bin"]))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/octet-stream")
  })

  // Architect-suggested: Content-Disposition controls whether the browser
  // tries to preview or forces a download. Previewable types should be
  // inline; archives (zip/rar) must be attachment so a malformed file
  // can't trigger weird browser unpack UI.
  describe("Content-Disposition", () => {
    beforeEach(() => {
      vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 1 } as any)
      vi.mocked(readFile).mockResolvedValue(Buffer.from([0]))
    })

    it("inline for image", async () => {
      const res = await GET(req(), pp(["mtm-photos", "visit-proof.jpg"]))
      expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="visit-proof\.jpg"$/)
    })

    it("inline for PDF (Office Online / browser preview)", async () => {
      const res = await GET(req(), pp(["contracts", "deal.pdf"]))
      expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="deal\.pdf"$/)
    })

    it("attachment for zip (force download)", async () => {
      const res = await GET(req(), pp(["contracts", "bundle.zip"]))
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="bundle\.zip"$/)
    })

    it("attachment for rar (force download)", async () => {
      const res = await GET(req(), pp(["contracts", "old.rar"]))
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="old\.rar"$/)
    })

    it("forces legacy SVG to download under a no-script sandbox", async () => {
      const res = await GET(req(), pp(["email-images", "org-1", "legacy.svg"]))
      expect(res.headers.get("content-disposition")).toMatch(/^attachment;/)
      expect(res.headers.get("content-security-policy")).toContain("sandbox")
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'")
      expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    })

    it("attachment for unknown extension (defense-in-depth)", async () => {
      // Architect Q5: unknown bytes fall through to octet-stream — never
      // render inline. An attacker who slipped an `.html` past the upload
      // whitelist shouldn't get a browser-executed page out of it.
      const res = await GET(req(), pp(["mtm-photos", "weird.bin"]))
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="weird\.bin"$/)
    })
  })
})
