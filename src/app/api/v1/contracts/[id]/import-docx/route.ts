/**
 * Contract Editor — .docx import (Slice 1, Step 6).
 *
 * POST /api/v1/contracts/:id/import-docx  (multipart/form-data, field "file")
 *
 * Converts an uploaded Word document to HTML via mammoth, sanitizes it through
 * the contract allowlist, and mints a new ContractVersion through the SAME
 * shared `mintBodyVersion` helper the editor's PUT /body uses — so an imported
 * body hashes identically to the same body typed in the editor.
 *
 * Replaces the whole contract body (the old version stays frozen in
 * contract_versions; signed versions are never mutated). The editor must
 * confirm "this replaces the current body" before calling this.
 *
 * Auth: requireAuth(contracts, write) + module gate + org-scope + status guard
 * (mirror of PUT /body).
 */
import { NextRequest, NextResponse } from "next/server"
import mammoth from "mammoth"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { sanitizeContractBody } from "@/lib/sanitize"
import { checkRateLimit } from "@/lib/rate-limit"
import { declaredUncompressedSize, MAX_DOCX_UNCOMPRESSED } from "@/lib/clm/docx-guard"
import {
  mintBodyVersion,
  BodyVersionConflict,
  EDITABLE_STATUSES,
} from "@/lib/clm/mint-body-version"
import { countInFlightEnvelopes } from "@/lib/clm/envelope-guards"

// mammoth needs Node APIs (jszip, Buffer) — never run on the edge runtime.
export const runtime = "nodejs"

// 10 MB compressed — a Word contract far past any realistic size; a tighter cap
// also bounds the worst-case inflation of a decompression bomb (Codex HIGH).
const MAX_DOCX_BYTES = 10 * 1024 * 1024
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
// mammoth is CPU-heavy; cap imports per user so a bomb/abuse can't be spammed.
const IMPORT_RATE = { maxRequests: 5, windowMs: 60_000 }
// Drop images during conversion: they're forbidden by the sanitizer anyway, and
// not materializing base64 media avoids a large inflation vector.
const NO_IMAGES = mammoth.images.imgElement(async () => ({ src: "" }))

export const POST = withRlsAuth("contracts", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, userId } = auth
  const { id: contractId } = await params

  if (auth.role !== "superadmin" && !(await orgHasModule(orgId, "contracts"))) {
    return moduleDisabledResponse("contracts")
  }

  // Rate-limit the expensive mammoth parse path per user (Codex MED) — a bomb or
  // abuse can't be spammed to sustain a memory/CPU DoS.
  if (!checkRateLimit(`docx-import:${orgId}:${userId ?? "anon"}`, IMPORT_RATE)) {
    return NextResponse.json(
      { error: "Too many imports — please wait a minute and try again", code: "RATE_LIMITED" },
      { status: 429 },
    )
  }

  // ── Parse the multipart upload ───────────────────────────────────────────
  const contentType = req.headers.get("content-type") || ""
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field" }, { status: 400 })
  }

  let file: File
  try {
    const form = await req.formData()
    const f = form.get("file")
    if (!(f instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 })
    }
    file = f
  } catch {
    return NextResponse.json({ error: "Malformed multipart body" }, { status: 400 })
  }

  const nameOk = /\.docx$/i.test(file.name)
  const mimeOk = !file.type || file.type === DOCX_MIME
  if (!nameOk || !mimeOk) {
    return NextResponse.json(
      { error: "Only .docx (Word) files are supported", code: "UNSUPPORTED_FILE" },
      { status: 400 },
    )
  }
  if (file.size > MAX_DOCX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${Math.round(MAX_DOCX_BYTES / 1024 / 1024)} MB)`, code: "FILE_TOO_LARGE" },
      { status: 413 },
    )
  }

  // ── Status guard (mirror PUT /body) ──────────────────────────────────────
  let contract: { id: string; status: string } | null
  try {
    contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId: orgId },
      select: { id: true, status: true },
    })
  } catch (e) {
    console.error("[contracts/:id/import-docx POST] load", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (!(EDITABLE_STATUSES as readonly string[]).includes(contract.status)) {
    return NextResponse.json(
      {
        error: `Cannot import into a contract in status "${contract.status}". Terminal statuses (expired, renewed, terminated, rejected, cancelled) are read-only.`,
        code: "NOT_EDITABLE",
      },
      { status: 409 },
    )
  }

  // In-flight envelope guard (mirrors /amend and PUT /body — [P2] asymmetry).
  // Import REPLACES the working body; doing that mid-signing is confusing even
  // though the live envelope is pinned to a frozen version.
  try {
    if ((await countInFlightEnvelopes(orgId, contractId)) > 0) {
      return NextResponse.json(
        {
          error: "Cannot import while a signature is in progress. Void or complete the open envelope first.",
          code: "ENVELOPE_IN_FLIGHT",
        },
        { status: 409 },
      )
    }
  } catch (e) {
    console.error("[contracts/:id/import-docx POST] envelope in-flight check", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  // ── Convert .docx → HTML via mammoth ─────────────────────────────────────
  let html: string
  let warnings: string[] = []
  try {
    const buffer = Buffer.from(await file.arrayBuffer())

    // Zip-bomb preflight (Codex HIGH): a .docx is a ZIP and mammoth/jszip has no
    // uncompressed-size policy — sum the sizes the central directory DECLARES
    // (no decompression) and reject bombs before mammoth allocates anything.
    const declared = declaredUncompressedSize(buffer)
    if (declared !== null && declared > MAX_DOCX_UNCOMPRESSED) {
      return NextResponse.json(
        {
          error: "The document expands far beyond a legitimate contract size and was rejected",
          code: "DOCX_BOMB_SUSPECTED",
        },
        { status: 413 },
      )
    }

    // convertImage override drops embedded media instead of materializing base64
    // data-URIs (the sanitizer forbids <img> anyway) — closes the inflation vector.
    const result = await mammoth.convertToHtml({ buffer }, { convertImage: NO_IMAGES })
    html = result.value || ""
    warnings = (result.messages || []).map((m) => m.message).slice(0, 50)
  } catch (e) {
    console.error("[contracts/:id/import-docx POST] mammoth", e)
    return NextResponse.json(
      { error: "Could not read the .docx file — it may be corrupt or password-protected", code: "PARSE_FAILED" },
      { status: 400 },
    )
  }

  // ── Sanitize → mint a version through the shared helper ──────────────────
  const cleanHtml = sanitizeContractBody(html)
  // An empty conversion (blank doc, or all-stripped by the allowlist) is a
  // no-op import, not a body wipe — reject rather than mint an empty version.
  if (cleanHtml.replace(/<[^>]*>/g, "").trim().length === 0) {
    return NextResponse.json(
      { error: "The document produced no importable text", code: "EMPTY_DOCUMENT" },
      { status: 400 },
    )
  }
  // Mirror PUT /body's 1 MB body cap — a 10 MB .docx can expand to a huge HTML
  // string; the import path must not bypass the editor's size guard.
  if (cleanHtml.length > 1_000_000) {
    return NextResponse.json(
      { error: "Imported document is too large after conversion (max ~1 MB of formatted text)", code: "BODY_TOO_LARGE" },
      { status: 413 },
    )
  }

  try {
    const { versionNo, contentHash } = await mintBodyVersion({
      orgId,
      contractId,
      cleanHtml,
      source: "import",
      createdBy: userId ?? "unknown",
      editableStatuses: EDITABLE_STATUSES,
    })
    return NextResponse.json({
      success: true,
      data: { versionMinted: true, versionNo, contentHash, warnings },
    })
  } catch (e) {
    if (e instanceof BodyVersionConflict) {
      const payload =
        e.code === "NOT_EDITABLE" ? { error: e.message, code: "NOT_EDITABLE" } : { error: e.message }
      return NextResponse.json(payload, { status: 409 })
    }
    console.error("[contracts/:id/import-docx POST] mint", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
