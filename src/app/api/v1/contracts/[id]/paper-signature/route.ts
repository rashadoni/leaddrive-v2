/**
 * «Подписан на бумаге» — POST /api/v1/contracts/:id/paper-signature
 * (owner 2026-11-26; the rules are in src/lib/clm/paper-signature.ts).
 *
 * multipart/form-data: `signedAt` ("YYYY-MM-DD") and `file` (the scan: PDF,
 * JPG or PNG, ≤ 10 MB). One transaction does what e-sign completion does to
 * the contract and nothing more:
 *   - status → "active", `signedAt` = the day on paper, `signedBy` =
 *     "paper:<userId>" — compare-and-set on the status and signedAt read, so a
 *     concurrent e-sign completion or a second click cannot both win;
 *   - the scan, sealed with the organization's key like every client file, is
 *     a contract file with purpose "signed_copy";
 *   - a contract-level e-sign envelope still out for signing is voided (reason
 *     "signed_on_paper"), its unsigned links die, the e-sign audit trail says so;
 *   - one audit-log row: who, from which status, the day, the file.
 * After commit the renewal reminders are scheduled from the end date — the
 * wizard, templates and intake never scheduled them, and the reminder job
 * reads only contracts in force.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { writeFile, mkdir, unlink } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { validateUploadBytes } from "@/lib/upload-security"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { sealTenantFile } from "@/lib/crypto/tenant-file-encryption"
import { EnvelopeVoidConflict, voidOpenEnvelopes } from "@/lib/clm/void-open-envelopes"
import { completeRenewalSource } from "@/lib/clm/contract-renewal"
import { upsertRenewalAlerts } from "@/lib/contract-lifecycle/upsert-renewal-alerts"
import {
  PAPER_SIGNED_BY_PREFIX,
  SIGNED_COPY_PURPOSE,
  paperSignatureRefusal,
  parseSignedAt,
  signedCopyExtension,
} from "@/lib/clm/paper-signature"

class Conflict extends Error {}

const refuse = (code: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: code, code, ...extra }, { status })

export const POST = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { userId, role } = auth
  const { id } = await params
  // A person records a paper signature; an API key has nobody to name.
  if (!userId || auth.principalType === "api_key") return refuse("USER_REQUIRED", 403)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return refuse("FILE_REQUIRED", 400)
  }
  const signedAt = parseSignedAt(form.get("signedAt"))
  if (!signedAt.ok) return refuse(signedAt.code, 400)
  const upload = form.get("file")
  const file = upload instanceof File ? upload : null
  const kind = signedCopyExtension(file)
  if (!kind.ok) return refuse(kind.code, 400)

  const contract = await prisma.contract.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, status: true, signedAt: true, endDate: true },
  })
  if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const refusal = paperSignatureRefusal(contract.status, role)
  if (refusal) return refuse(refusal, refusal === "ADMIN_REQUIRED_FOR_DRAFT" ? 403 : 409, { status: contract.status })

  const bytes = Buffer.from(await file!.arrayBuffer())
  if (validateUploadBytes(kind.mimeType, bytes)) return refuse("FILE_TYPE_NOT_ALLOWED", 400)

  const uploadDir = runtimePublicUploadDirectory("contracts")
  await mkdir(uploadDir, { recursive: true })
  const fileName = `${crypto.randomBytes(16).toString("hex")}${kind.ext}`
  const filePath = path.join(uploadDir, fileName)
  await writeFile(filePath, sealTenantFile(orgId, bytes))

  const now = new Date()
  try {
    const saved = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${id} AND "organizationId" = ${orgId} FOR UPDATE`
      const moved = await tx.contract.updateMany({
        where: { id, organizationId: orgId, status: contract.status, signedAt: contract.signedAt },
        data: { status: "active", signedAt: signedAt.date, signedBy: `${PAPER_SIGNED_BY_PREFIX}${userId}` },
      })
      if (moved.count !== 1) throw new Conflict("The contract changed concurrently")

      const scan = await tx.contractFile.create({
        data: {
          organizationId: orgId,
          contractId: id,
          fileName,
          originalName: file!.name,
          fileSize: bytes.byteLength,
          mimeType: kind.mimeType,
          uploadedBy: userId,
          purpose: SIGNED_COPY_PURPOSE,
        },
        select: { id: true, fileName: true, originalName: true, mimeType: true },
      })

      // An invitation to e-sign the contract itself is moot once it is signed on paper.
      const voidedEnvelopes = await voidOpenEnvelopes(tx, {
        orgId,
        contractId: id,
        scope: "contract",
        reason: "signed_on_paper",
        actorUserId: userId,
        at: now,
        ipAddress: req.headers.get("x-forwarded-for"),
        userAgent: req.headers.get("user-agent"),
      })

      // A renewal that takes effect: the contract it renews is «Продлён» now (contract-renewal.ts).
      const renewedSourceId = await completeRenewalSource(tx, { orgId, contractId: id })

      await logAudit(orgId, "update", "contract", id, contract.title, {
        oldValue: { status: { old: contract.status, new: "active" } },
        newValue: { status: "active", reason: "signed_on_paper", signedAt: signedAt.day, fileId: scan.id, voidedEnvelopes, renewedSourceId },
        userId,
      }, tx)
      return scan
    })

    if (contract.endDate) {
      await upsertRenewalAlerts(orgId, id, contract.endDate, now).catch((e) => {
        console.error("[contracts/:id/paper-signature] renewal alerts not scheduled:", e)
      })
    }

    return NextResponse.json({
      success: true,
      data: { status: "active", signedAt: signedAt.day, file: saved },
    })
  } catch (e) {
    await unlink(filePath).catch(() => {})
    if (e instanceof Conflict || e instanceof EnvelopeVoidConflict) return refuse("CONFLICT", 409)
    console.error("[contracts/:id/paper-signature POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
