/**
 * Contract Editor — Slice 1, Step 3.
 *
 * PUT /api/v1/contracts/:id/body — save the rich editor body.
 *
 * Flow (the SHA-binding-critical save path):
 *   1. auth: requireAuth(contracts, write) + module gate + org-scope + status guard
 *   2. sanitize the incoming HTML (allowlist) → store as `bodyHtml` (source of truth)
 *   3. derive `renderedBody = serializeContractBody(bodyHtml)` FIRST
 *   4. **[P2](b) LOAD-BEARING guard** — if the only delta between the re-derived
 *      and the existing `renderedBody` is whitespace/indent (e.g. a legacy
 *      nested-list seed that flattened), DO NOT overwrite `renderedBody` and DO
 *      NOT mint a version: the existing `contentHash` that binds e-sign
 *      envelopes to frozen ContractVersions stays intact. Only `bodyHtml` updates.
 *   5. otherwise (real content change): update `bodyHtml` + `renderedBody` and
 *      mint a NEW ContractVersion (CAS versionNo, mirrors amend/route.ts).
 *      `contentHash = sha256(renderedBody)` — unchanged from amend/esign, which
 *      we deliberately do NOT touch. Signed versions are frozen (never mutated).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRlsAuth } from "@/lib/with-rls"
import { sanitizeContractBody } from "@/lib/sanitize"
import { serializeContractBody } from "@/lib/clm/serialize-body"
import { mintBodyVersion, BodyVersionConflict, EDITABLE_STATUSES } from "@/lib/clm/mint-body-version"
import { countInFlightEnvelopes } from "@/lib/clm/envelope-guards"

const bodySchema = z.object({
  // 1 MB cap — a contract body far past any realistic length.
  bodyHtml: z.string().max(1_000_000),
})

// EDITABLE_STATUSES is imported from the shared mint helper (single source of
// truth — terminal states expired/renewed/terminated/rejected/cancelled cannot be edited).

/** Whitespace-normalized form for the (b) guard: trim each line and drop empty
 *  ones, but KEEP line boundaries. Two bodies equal under this differ only in
 *  indent/leading-whitespace (the legacy-seed flatten case) — NOT in line
 *  structure, so a real reflow ("a\nb" → "a b") still mints a version. */
function normalizeWs(s: string): string {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n")
}

export const PUT = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, userId } = auth
  const { id: contractId } = await params

  if (auth.role !== "superadmin" && !(await orgHasModule(orgId, "contracts"))) {
    return moduleDisabledResponse("contracts")
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  let contract: { id: string; status: string; renderedBody: string | null; bodyHtml: string | null } | null
  try {
    contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId: orgId },
      select: { id: true, status: true, renderedBody: true, bodyHtml: true },
    })
  } catch (e) {
    console.error("[contracts/:id/body PUT] load", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (!(EDITABLE_STATUSES as readonly string[]).includes(contract.status)) {
    return NextResponse.json(
      {
        error: `Cannot edit the body of a contract in status "${contract.status}". Terminal statuses (expired, renewed, terminated, rejected, cancelled) are read-only.`,
        code: "NOT_EDITABLE",
      },
      { status: 409 },
    )
  }

  // In-flight envelope guard (mirrors /amend — closes the [P2] asymmetry).
  // Bound envelopes pin a frozen version, so this is a UX/consistency gate,
  // not a signature-integrity one; it must sit before ANY write path below
  // (including the bodyHtml-only whitespace branch).
  try {
    if ((await countInFlightEnvelopes(orgId, contractId)) > 0) {
      return NextResponse.json(
        {
          error: "Cannot edit the body while a signature is in progress. Void or complete the open envelope first.",
          code: "ENVELOPE_IN_FLIGHT",
        },
        { status: 409 },
      )
    }
  } catch (e) {
    console.error("[contracts/:id/body PUT] envelope in-flight check", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  // 2 + 3: sanitize, then DERIVE renderedBody before any version/hash work.
  // Phase 3: images enabled for the editor save path only — the sanitizer
  // accepts <img> solely under /uploads/contract-images/<this-org>/.
  const cleanHtml = sanitizeContractBody(parsed.data.bodyHtml, { imageOrgId: auth.orgId })

  // Cheap exit: byte-identical sanitized bodyHtml ⇒ nothing changed at all.
  if (cleanHtml === (contract.bodyHtml ?? "")) {
    return NextResponse.json({ success: true, data: { versionMinted: false, reason: "unchanged" } })
  }

  const newRendered = serializeContractBody(cleanHtml)
  const existingRendered = contract.renderedBody ?? ""

  // 4: (b) LOAD-BEARING guard — whitespace-only delta ⇒ no content change.
  // Persist only bodyHtml, leave renderedBody + the contentHash binding intact,
  // mint NO version. (Covers the legacy nested-list seed flatten + any no-op save.)
  if (normalizeWs(newRendered) === normalizeWs(existingRendered)) {
    try {
      await prisma.contract.updateMany({
        where: { id: contractId, organizationId: orgId },
        data: { bodyHtml: cleanHtml },
      })
    } catch (e) {
      console.error("[contracts/:id/body PUT] bodyHtml-only update", e)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
    return NextResponse.json({
      success: true,
      data: { versionMinted: false, reason: "no-content-change" },
    })
  }

  // 5: real content change → mint a new version under CAS via the shared helper.
  // Same code path as the .docx import route — one source of truth for the
  // contentHash = sha256(renderedBody) binding (mirrors amend's mint).
  try {
    const { versionNo, contentHash } = await mintBodyVersion({
      orgId,
      contractId,
      cleanHtml,
      source: "editor",
      createdBy: userId ?? "unknown",
      editableStatuses: EDITABLE_STATUSES,
    })
    return NextResponse.json({
      success: true,
      data: { versionMinted: true, versionNo, contentHash },
    })
  } catch (e) {
    if (e instanceof BodyVersionConflict) {
      // Preserve the two distinct 409 shapes: NOT_EDITABLE carries a code, the
      // retry-exhausted VERSION_CONFLICT does not (matches the original route).
      const payload =
        e.code === "NOT_EDITABLE"
          ? { error: e.message, code: "NOT_EDITABLE" }
          : { error: e.message }
      return NextResponse.json(payload, { status: 409 })
    }
    console.error("[contracts/:id/body PUT] mint", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
