/**
 * Contract Editor — Slice 1, Step 3. API tests for:
 *   PUT /api/v1/contracts/:id/body
 *
 * Coverage:
 *   - real content change → mints ContractVersion(source="editor", versionNo=max+1,
 *     bodyHtml + renderedBody + contentHash), updates the working contract
 *   - [P2](b) LOAD-BEARING guard: a whitespace/indent-only delta (e.g. a legacy
 *     nested-list seed that flattened) → NO version minted, renderedBody NOT
 *     overwritten, only bodyHtml persisted
 *   - sanitize strips script/img/a; <ol start=N> survives
 *   - terminal status → 409 NOT_EDITABLE
 *   - not found / cross-org → 404
 *   - unauthenticated → 401; module disabled → 403
 *   - CAS concurrent terminal transition → 409
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mockContractFindFirst = vi.fn()
const mockContractUpdateMany = vi.fn()
const mockTransaction = vi.fn()
const mockOrgHasModule = vi.fn()
const mockEsignCount = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contract: {
      findFirst: (...a: unknown[]) => mockContractFindFirst(...a),
      updateMany: (...a: unknown[]) => mockContractUpdateMany(...a),
    },
    esignEnvelope: {
      count: (...a: unknown[]) => mockEsignCount(...a), // in-flight guard
    },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (r: unknown) => r instanceof NextResponse,
  orgHasModule: (...a: unknown[]) => mockOrgHasModule(...a),
  moduleDisabledResponse: vi.fn(
    (m: string) =>
      new NextResponse(JSON.stringify({ error: `Module ${m} is not enabled` }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}))

import { PUT } from "@/app/api/v1/contracts/[id]/body/route"
import { requireAuth } from "@/lib/api-auth"
import { sanitizeContractBody, sanitizeRichHtml } from "@/lib/sanitize"

const ORG_ID = "org-1"
const CONTRACT_ID = "ctr-1"
const USER_ID = "user-1"

function makeReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/contracts/${CONTRACT_ID}/body`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
const routeParams = { params: Promise.resolve({ id: CONTRACT_ID }) }

function authOk(role = "admin") {
  return { orgId: ORG_ID, userId: USER_ID, role, email: "u@e.com", name: "U" } as never
}

let txVersionCreate: ReturnType<typeof vi.fn>
let txContractUpdateMany: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(authOk())
  mockOrgHasModule.mockResolvedValue(true)
  mockContractUpdateMany.mockResolvedValue({ count: 1 })
  mockEsignCount.mockResolvedValue(0) // no in-flight envelope by default

  txVersionCreate = vi.fn((args: unknown) => ({
    id: "ver-new",
    versionNo: 3,
    contentHash: (args as { data?: { contentHash?: string } })?.data?.contentHash ?? "hash",
  }))
  txContractUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      $queryRaw: vi.fn().mockResolvedValue([{ max: 2 }]),
      contractVersion: { create: txVersionCreate },
      contract: { updateMany: txContractUpdateMany },
    }),
  )
})

describe("PUT /contracts/:id/body — (b) whitespace-delta guard", () => {
  it("a whitespace/indent-only delta mints NO version and leaves renderedBody intact", async () => {
    // existing has a nested-list indent; the incoming flattened seed serializes
    // to the same content modulo whitespace → guard must NOT mint a version.
    mockContractFindFirst.mockResolvedValue({
      id: CONTRACT_ID,
      status: "approved",
      renderedBody: "1. Term\n  1. Sub\n2. Fees",
    })
    const res = await PUT(makeReq({ bodyHtml: "<p>1. Term</p><p>1. Sub</p><p>2. Fees</p>" }), routeParams)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.versionMinted).toBe(false)
    expect(json.data.reason).toBe("no-content-change")
    expect(mockTransaction).not.toHaveBeenCalled() // no version minted
    // only bodyHtml persisted, renderedBody NOT in the update payload
    const updateArg = mockContractUpdateMany.mock.calls[0][0]
    expect(updateArg.data).toHaveProperty("bodyHtml")
    expect(updateArg.data).not.toHaveProperty("renderedBody")
    expect(updateArg.where).toMatchObject({ id: CONTRACT_ID, organizationId: ORG_ID })
  })
})

describe("PUT /contracts/:id/body — real content change", () => {
  beforeEach(() => {
    mockContractFindFirst.mockResolvedValue({
      id: CONTRACT_ID,
      status: "active",
      renderedBody: "Old body text.",
    })
  })

  it("mints a new ContractVersion(source=editor) with bodyHtml + contentHash", async () => {
    const res = await PUT(makeReq({ bodyHtml: "<p>Brand new body content.</p>" }), routeParams)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.versionMinted).toBe(true)
    expect(json.data.versionNo).toBe(3)
    expect(mockTransaction).toHaveBeenCalledOnce()
    const createArg = txVersionCreate.mock.calls[0][0].data
    expect(createArg.source).toBe("editor")
    expect(createArg.renderedBody).toBe("Brand new body content.")
    expect(createArg.bodyHtml).toContain("Brand new body content")
    expect(createArg.contentHash).toMatch(/^[a-f0-9]{64}$/) // sha256 hex
    // working contract updated with BOTH bodyHtml and renderedBody
    expect(txContractUpdateMany.mock.calls[0][0].data).toMatchObject({
      bodyHtml: expect.any(String),
      renderedBody: "Brand new body content.",
    })
  })

  it("returns 409 when the contract concurrently leaves an editable state (CAS count=0)", async () => {
    txContractUpdateMany.mockResolvedValue({ count: 0 })
    const res = await PUT(makeReq({ bodyHtml: "<p>Another change.</p>" }), routeParams)
    expect(res.status).toBe(409)
  })
})

describe("PUT /contracts/:id/body — guards", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) as never,
    )
    const res = await PUT(makeReq({ bodyHtml: "<p>x</p>" }), routeParams)
    expect(res.status).toBe(401)
  })

  it("403 when contracts module disabled (non-superadmin)", async () => {
    mockOrgHasModule.mockResolvedValue(false)
    const res = await PUT(makeReq({ bodyHtml: "<p>x</p>" }), routeParams)
    expect(res.status).toBe(403)
  })

  it("404 when the contract is not in the caller's org", async () => {
    mockContractFindFirst.mockResolvedValue(null)
    const res = await PUT(makeReq({ bodyHtml: "<p>x</p>" }), routeParams)
    expect(res.status).toBe(404)
  })

  it("409 NOT_EDITABLE for a terminal status", async () => {
    mockContractFindFirst.mockResolvedValue({
      id: CONTRACT_ID,
      status: "terminated",
      renderedBody: "x",
    })
    const res = await PUT(makeReq({ bodyHtml: "<p>y</p>" }), routeParams)
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.code).toBe("NOT_EDITABLE")
  })

  it("409 ENVELOPE_IN_FLIGHT while a signature is in progress (mirrors /amend, closes the [P2] asymmetry)", async () => {
    mockContractFindFirst.mockResolvedValue({
      id: CONTRACT_ID,
      status: "active",
      renderedBody: "old",
      bodyHtml: "<p>old</p>",
    })
    mockEsignCount.mockResolvedValue(1) // an envelope is created|sent|in_progress
    const res = await PUT(makeReq({ bodyHtml: "<p>new body</p>" }), routeParams)
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.code).toBe("ENVELOPE_IN_FLIGHT")
    // gate sits BEFORE every write path — nothing minted, nothing updated
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockContractUpdateMany).not.toHaveBeenCalled()
  })

  it("400 on invalid JSON", async () => {
    const bad = new NextRequest(`http://localhost/api/v1/contracts/${CONTRACT_ID}/body`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    })
    const res = await PUT(bad, routeParams)
    expect(res.status).toBe(400)
  })
})

describe("sanitizeContractBody", () => {
  it("strips <script>, <img> and dangerous hrefs but keeps text + allowed tags", () => {
    const dirty = `<p>Hello <strong>world</strong></p><script>alert(1)</script><img src="http://evil/x"><a href="javascript:void(0)">link</a>`
    const clean = sanitizeContractBody(dirty)
    expect(clean).toContain("<p>Hello <strong>world</strong></p>")
    expect(clean).not.toContain("<script")
    expect(clean).not.toContain("<img")
    // Phase 2 contract: the <a> TAG is allowed, but a javascript: href is
    // dropped by the protocol hook — the anchor degrades to inert text.
    expect(clean).not.toContain("href")
    expect(clean).not.toContain("javascript")
    expect(clean).not.toContain("evil")
    expect(clean).toContain("link") // anchor text kept
  })

  it("keeps <ol start=N> so numbering survives the serializer round-trip", () => {
    const clean = sanitizeContractBody('<ol start="3"><li>x</li></ol>')
    expect(clean).toContain("start=\"3\"")
    expect(clean).toContain("<li>x</li>")
  })

  it("P0 regression: a TipTap TableKit table (colgroup + p-in-cell) survives sanitize and serializes its cells", async () => {
    // Exact shape TipTap v3 TableKit emits on save: colgroup/col (NOT in the
    // allowlist — must drop without taking the table down) + <p> inside cells.
    const tiptapTable =
      "<table><colgroup><col><col></colgroup><tbody>" +
      "<tr><th><p>Milestone</p></th><th><p>Amount</p></th></tr>" +
      "<tr><td><p>Phase 1</p></td><td><p>10 000 USD</p></td></tr>" +
      "</tbody></table>"
    const clean = sanitizeContractBody(tiptapTable)
    expect(clean).toContain("<table>")
    expect(clean).toContain("<th>")
    expect(clean).toContain("Phase 1")
    expect(clean).not.toContain("<colgroup") // dropped quietly, table intact
    // and the hashed mirror keeps every cell's text
    const { serializeContractBody } = await import("@/lib/clm/serialize-body")
    const rendered = serializeContractBody(clean)
    expect(rendered).toContain("Milestone")
    expect(rendered).toContain("Phase 1")
    expect(rendered).toContain("10 000 USD")
  })

  it("drops inline style + event handlers", () => {
    const clean = sanitizeContractBody('<p style="color:red" onclick="x()">t</p>')
    expect(clean).not.toContain("style")
    expect(clean).not.toContain("onclick")
    expect(clean).toContain("t")
  })

  it("strips the whole non-allowlisted attribute surface (data-*, aria-*, role, tabindex, on*)", () => {
    // Loop the surface rather than two named keys — would have caught the aria-* gap.
    const attrs = [
      'data-evil="exfil"',
      'aria-label="ax"',
      'role="button"',
      "tabindex=\"0\"",
      'onmouseover="x()"',
      'id="leak"',
    ]
    for (const a of attrs) {
      const clean = sanitizeContractBody(`<span ${a}>t</span>`)
      const key = a.split("=")[0]
      expect(clean).not.toContain(key)
      expect(clean).toContain("t") // text always survives
    }
    // only `start` (on <ol>) is allowed through
    expect(sanitizeContractBody('<ol start="2"><li>x</li></ol>')).toContain('start="2"')
  })
})

// ─── Toolbar Phase 1 pairs (editor capability ⇄ sanitizer allowlist) ─────────
// Each feature ships as a PAIR with BOTH invariants (plan 2026-06-10):
// (a) sanitize round-trip — the editor's markup survives unchanged;
// (b) serialize stability — renderedBody (the hashed/PDF/signer plaintext)
//     is byte-identical with and without the new markup.
describe("sanitizeContractBody — toolbar Phase 1 pairs", () => {
  it("keeps the four ta-* alignment classes (class-based TextAlign)", () => {
    for (const dir of ["left", "right", "center", "justify"]) {
      const clean = sanitizeContractBody(`<p class="ta-${dir}">x</p>`)
      expect(clean).toContain(`class="ta-${dir}"`)
    }
    expect(sanitizeContractBody('<h2 class="ta-center">T</h2>')).toContain('class="ta-center"')
  })

  it("narrows class to the ta-* subset and drops the attribute when nothing survives", () => {
    // foreign tokens are filtered out of a mixed list…
    const mixed = sanitizeContractBody('<p class="evil ta-center also-evil">x</p>')
    expect(mixed).toContain('class="ta-center"')
    expect(mixed).not.toContain("evil")
    // …and a pure-foreign class attribute disappears entirely
    const foreign = sanitizeContractBody('<p class="btn btn-danger">x</p>')
    expect(foreign).not.toContain("class")
    // ta-lookalikes don't sneak through
    expect(sanitizeContractBody('<p class="ta-evil">x</p>')).not.toContain("class")
  })

  it("the ta-* hook is scoped: sanitizeRichHtml's classes are untouched after a contract pass", () => {
    sanitizeContractBody('<p class="ta-center">x</p>') // installs + removes its hook
    // KB/email sanitizer has no class allowlist of its own — config simply
    // drops class (not in its ALLOWED_ATTR); the leftover hook would instead
    // have narrowed href/src handling subtly. Assert the instance is clean:
    const rich = sanitizeRichHtml('<a href="https://x.example/y">link</a>')
    expect(rich).toContain('href="https://x.example/y"')
  })

  it("keeps sub/sup marks", () => {
    const clean = sanitizeContractBody("<p>H<sub>2</sub>O and m<sup>2</sup></p>")
    expect(clean).toContain("<sub>2</sub>")
    expect(clean).toContain("<sup>2</sup>")
  })

  it("invariant (b): alignment classes + sub/sup leave renderedBody byte-identical", async () => {
    const { serializeContractBody } = await import("@/lib/clm/serialize-body")
    const plain = "<h2>Area</h2><p>Square: m2 of H2O</p>"
    const dressed = '<h2 class="ta-center">Area</h2><p class="ta-justify">Square: m<sup>2</sup> of H<sub>2</sub>O</p>'
    expect(serializeContractBody(sanitizeContractBody(dressed)))
      .toBe(serializeContractBody(sanitizeContractBody(plain)))
  })

  it("style stays banned even now that class is allowed (the precedence rule)", () => {
    const clean = sanitizeContractBody('<p class="ta-center" style="text-align:left">x</p>')
    expect(clean).toContain('class="ta-center"')
    expect(clean).not.toContain("style")
  })
})

// ─── Toolbar Phase 2 pairs: link + highlight ─────────────────────────────────
describe("sanitizeContractBody — toolbar Phase 2 pairs (link + highlight)", () => {
  it("keeps a[href] for http / https / mailto and FORCES rel", () => {
    for (const url of ["https://leaddrivecrm.org/x", "http://example.com/", "mailto:legal@firm.example"]) {
      const clean = sanitizeContractBody(`<p><a href="${url}">t</a></p>`)
      expect(clean).toContain(`href="${url}"`)
      expect(clean).toContain('rel="noopener noreferrer"')
    }
  })

  it("attacker-supplied rel/target cannot stick", () => {
    const clean = sanitizeContractBody('<p><a href="https://x.example/" rel="opener" target="_blank">t</a></p>')
    expect(clean).toContain('rel="noopener noreferrer"') // rewritten, not echoed
    expect(clean).not.toContain("opener\"") // the literal rel="opener" is gone
    expect(clean).not.toContain("target")
  })

  it("drops href for every non-allowlisted or unparseable URL (anchor degrades to text)", () => {
    const bad = [
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "tel:+994501234567",
      "ftp://files.example/x",
      "/relative/path",
      "//evil.example/x", // protocol-relative — URL() throws, must degrade
      "  java\tscript:alert(1)",
      "vbscript:msgbox",
    ]
    for (const url of bad) {
      const clean = sanitizeContractBody(`<p><a href="${url.replace(/"/g, "&quot;")}">t</a></p>`)
      expect(clean, url).not.toContain("href")
      expect(clean, url).toContain("t") // text survives
    }
  })

  it("canonicalizes accepted hrefs (parser serialization, not raw input)", () => {
    const clean = sanitizeContractBody('<p><a href="  https://x.example  ">t</a></p>')
    expect(clean).toContain('href="https://x.example/"') // trimmed + trailing slash from URL serialization
  })

  it("an href-less anchor carries no rel either", () => {
    const clean = sanitizeContractBody('<p><a rel="noopener">t</a></p>')
    expect(clean).not.toContain("rel")
  })

  it("keeps <mark> (plain highlight)", () => {
    const clean = sanitizeContractBody("<p>normal <mark>flagged</mark></p>")
    expect(clean).toContain("<mark>flagged</mark>")
  })

  it("invariant (b): link + mark leave renderedBody byte-identical", async () => {
    const { serializeContractBody } = await import("@/lib/clm/serialize-body")
    const plain = "<p>See the master agreement at portal for terms.</p>"
    const dressed = '<p>See the <mark>master agreement</mark> at <a href="https://portal.example/msa">portal</a> for terms.</p>'
    expect(serializeContractBody(sanitizeContractBody(dressed)))
      .toBe(serializeContractBody(sanitizeContractBody(plain)))
  })

  it("hook scoping: sanitizeRichHtml anchors keep their own rel semantics after a contract pass", () => {
    sanitizeContractBody('<p><a href="https://x.example/">t</a></p>') // installs + removes both hooks
    const rich = sanitizeRichHtml('<a href="https://x.example/y">link</a>')
    expect(rich).toContain('href="https://x.example/y"')
    expect(rich).not.toContain("noopener") // the contract-only forced rel must not leak here
  })
})

// ─── Toolbar Phase 3 pairs: org-scoped images ────────────────────────────────
describe("sanitizeContractBody — toolbar Phase 3 pairs (images)", () => {
  const OWN = "/uploads/contract-images/org-1/img-abc12345.png"

  it("keeps <img> ONLY when imageOrgId is passed and src is this org's contract-images", () => {
    const clean = sanitizeContractBody(`<p>x</p><img src="${OWN}" alt="logo">`, { imageOrgId: "org-1" })
    expect(clean).toContain(`src="${OWN}"`)
    expect(clean).toContain('alt="logo"')
  })

  it("without opts (legacy callers: import-docx, mint) <img> stays fully banned", () => {
    const clean = sanitizeContractBody(`<p>x</p><img src="${OWN}" alt="logo">`)
    expect(clean).not.toContain("<img")
    expect(clean).not.toContain("src")
  })

  it("drops src for every non-own shape (and removes the src-less img outright)", () => {
    const bad = [
      "/uploads/contract-images/org-2/img-abc12345.png", // another org
      "/uploads/email-images/org-1/img-abc12345.png",    // another subdir
      "https://evil.example/x.png",                      // external
      "data:image/png;base64,iVBORw0KGgo=",              // data URI
      "/uploads/contract-images/org-1/../org-2/x.png",   // traversal
      "/uploads/contract-images/org-1/.hidden",          // dot-leading, no ext
      "/uploads/contract-images/org-1/x.png/extra",      // trailing path
    ]
    for (const src of bad) {
      const clean = sanitizeContractBody(`<p>t</p><img src="${src}" alt="a">`, { imageOrgId: "org-1" })
      expect(clean, src).not.toContain("<img") // src dropped → node removed in after-hook
      expect(clean, src).toContain("t")
    }
  })

  it("serializer: the DECLARED exception — img contributes \"[alt]\" to renderedBody, nothing without alt", async () => {
    const { serializeContractBody } = await import("@/lib/clm/serialize-body")
    const withAlt = sanitizeContractBody(`<p>Before</p><img src="${OWN}" alt="Company stamp"><p>After</p>`, { imageOrgId: "org-1" })
    const rendered = serializeContractBody(withAlt)
    expect(rendered).toContain("[Company stamp]")
    const noAlt = sanitizeContractBody(`<p>Before</p><img src="${OWN}"><p>After</p>`, { imageOrgId: "org-1" })
    expect(serializeContractBody(noAlt)).toBe(serializeContractBody(sanitizeContractBody("<p>Before</p><p>After</p>")))
  })

  it("src is tag-bound: a valid own-org value on a NON-img tag is dropped", () => {
    const clean = sanitizeContractBody('<p><span src="/uploads/contract-images/org-1/img-abc12345.png">t</span></p>', { imageOrgId: "org-1" })
    expect(clean).not.toContain("src")
    expect(clean).toContain("t")
  })

  it("event handlers / style can't ride in on an allowed img", () => {
    const clean = sanitizeContractBody(`<img src="${OWN}" alt="a" onerror="x()" style="position:fixed">`, { imageOrgId: "org-1" })
    expect(clean).toContain("<img")
    expect(clean).not.toContain("onerror")
    expect(clean).not.toContain("style")
  })
})
