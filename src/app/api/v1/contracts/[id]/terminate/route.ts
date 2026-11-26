/**
 * Termination — POST / DELETE /api/v1/contracts/:id/terminate
 * (owner 2026-11-26, mock «Расторжение»; rules in src/lib/clm/contract-closing.ts).
 *
 * POST multipart/form-data: `terminationDate` ("YYYY-MM-DD", the first day the
 * contract no longer applies), `reason` (a code), `note`, and optionally
 * `file` — the signed termination agreement (PDF, JPG or PNG, ≤ 10 MB, sealed
 * with the organization's key like every client file). One transaction:
 *   - today or earlier: status → "terminated", the e-sign invitations still
 *     out (the contract's and its documents') are voided;
 *   - a later day: the contract stays in force, the day is recorded, and the
 *     finance deadline job moves it then (contract-lifecycle/terminate-scheduled.ts);
 *   - either way the renewal reminders still pending are superseded, who and
 *     when are recorded, and one audit row is written.
 * DELETE withdraws a termination whose day has not come; the renewal reminders
 * are scheduled again from the end date, the agreement stays as an attachment.
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
import { upsertRenewalAlerts } from "@/lib/contract-lifecycle/upsert-renewal-alerts"
import { signedCopyExtension } from "@/lib/clm/paper-signature"
import { EnvelopeVoidConflict, voidOpenEnvelopes } from "@/lib/clm/void-open-envelopes"
import { TERMINATION_COPY_PURPOSE, canWithdrawTermination, planTermination } from "@/lib/clm/contract-closing"

class Conflict extends Error {}

const refuse = (code: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: code, code, ...extra }, { status })
const day = (d: Date) => d.toISOString().slice(0, 10)

export const POST = withRlsAuth("contracts", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { userId } = auth
  const { id } = await params
  if (!userId || auth.principalType === "api_key") return refuse("USER_REQUIRED", 403)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return refuse("TERMINATION_DATE_INVALID", 400)
  }
  const upload = form.get("file")
  const file = upload instanceof File && upload.size > 0 ? upload : null
  const kind = file ? signedCopyExtension(file) : null
  if (kind && !kind.ok) return refuse(kind.code, 400)

  const contract = await prisma.contract.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, status: true, endDate: true, terminationDate: true },
  })
  if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const now = new Date()
  const plan = planTermination(contract, {
    terminationDate: form.get("terminationDate"),
    reason: form.get("reason"),
    note: form.get("note"),
  }, now)
  if (!plan.ok) return refuse(plan.code, plan.code === "NOT_TERMINABLE" || plan.code === "ALREADY_SCHEDULED" ? 409 : 400, { status: contract.status })

  let stored: { fileName: string; filePath: string; bytes: Buffer; mimeType: string } | null = null
  if (file && kind?.ok) {
    const bytes = Buffer.from(await file.arrayBuffer())
    if (validateUploadBytes(kind.mimeType, bytes)) return refuse("FILE_TYPE_NOT_ALLOWED", 400)
    const uploadDir = runtimePublicUploadDirectory("contracts")
    await mkdir(uploadDir, { recursive: true })
    const fileName = `${crypto.randomBytes(16).toString("hex")}${kind.ext}`
    const filePath = path.join(uploadDir, fileName)
    await writeFile(filePath, sealTenantFile(orgId, bytes))
    stored = { fileName, filePath, bytes, mimeType: kind.mimeType }
  }

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${id} AND "organizationId" = ${orgId} FOR UPDATE`
      const moved = await tx.contract.updateMany({
        where: { id, organizationId: orgId, status: contract.status, terminationDate: null },
        data: {
          ...(plan.immediate ? { status: "terminated" } : {}),
          terminationDate: plan.date,
          terminationReason: plan.reason,
          closeNote: plan.note,
          closedBy: userId,
          closedAt: now,
        },
      })
      if (moved.count !== 1) throw new Conflict("The contract changed concurrently")

      const agreement = stored
        ? await tx.contractFile.create({
          data: {
            organizationId: orgId,
            contractId: id,
            fileName: stored.fileName,
            originalName: file!.name,
            fileSize: stored.bytes.byteLength,
            mimeType: stored.mimeType,
            uploadedBy: userId,
            purpose: TERMINATION_COPY_PURPOSE,
          },
          select: { id: true },
        })
        : null

      // An ending contract is renewed no more.
      const superseded = await tx.contractRenewalAlert.updateMany({
        where: { contractId: id, organizationId: orgId, status: "pending" },
        data: { status: "superseded" },
      })
      const voidedEnvelopes = plan.immediate
        ? await voidOpenEnvelopes(tx, {
          orgId,
          contractId: id,
          scope: "all",
          reason: "contract_terminated",
          actorUserId: userId,
          at: now,
          ipAddress: req.headers.get("x-forwarded-for"),
          userAgent: req.headers.get("user-agent"),
        })
        : 0

      await logAudit(orgId, "update", "contract", id, contract.title, {
        oldValue: plan.immediate ? { status: { old: contract.status, new: "terminated" } } : { terminationDate: null },
        newValue: {
          ...(plan.immediate ? { status: "terminated" } : {}),
          reason: plan.immediate ? "terminated" : "termination_scheduled",
          terminationDate: plan.day,
          terminationReason: plan.reason,
          note: plan.note,
          fileId: agreement?.id ?? null,
          supersededRenewalAlerts: superseded.count,
          voidedEnvelopes,
        },
        userId,
      }, tx)
      return { status: plan.immediate ? "terminated" : contract.status }
    })

    return NextResponse.json({
      success: true,
      data: { status: result.status, terminationDate: plan.day, scheduled: !plan.immediate },
    })
  } catch (e) {
    if (stored) await unlink(stored.filePath).catch(() => {})
    if (e instanceof Conflict || e instanceof EnvelopeVoidConflict) return refuse("CONFLICT", 409)
    console.error("[contracts/:id/terminate POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("contracts", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { userId } = auth
  const { id } = await params
  if (!userId || auth.principalType === "api_key") return refuse("USER_REQUIRED", 403)

  const contract = await prisma.contract.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, title: true, status: true, endDate: true, terminationDate: true, terminationReason: true },
  })
  if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const now = new Date()
  if (!canWithdrawTermination(contract, now)) return refuse("NOT_WITHDRAWABLE", 409, { status: contract.status })

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${id} AND "organizationId" = ${orgId} FOR UPDATE`
      const moved = await tx.contract.updateMany({
        where: { id, organizationId: orgId, status: contract.status, terminationDate: contract.terminationDate },
        data: { terminationDate: null, terminationReason: null, closeNote: null, closedBy: null, closedAt: null },
      })
      if (moved.count !== 1) throw new Conflict("The contract changed concurrently")
      // The agreement of a termination that did not happen stays among the files, as an ordinary one.
      await tx.contractFile.updateMany({
        where: { contractId: id, organizationId: orgId, purpose: TERMINATION_COPY_PURPOSE },
        data: { purpose: "attachment" },
      })
      await logAudit(orgId, "update", "contract", id, contract.title, {
        oldValue: { terminationDate: day(contract.terminationDate!), terminationReason: contract.terminationReason },
        newValue: { reason: "termination_withdrawn", terminationDate: null },
        userId,
      }, tx)
    })
    if (contract.endDate) {
      await upsertRenewalAlerts(orgId, id, contract.endDate, now).catch((e) => {
        console.error("[contracts/:id/terminate DELETE] renewal alerts not rescheduled:", e)
      })
    }
    return NextResponse.json({ success: true, data: { status: contract.status, terminationDate: null } })
  } catch (e) {
    if (e instanceof Conflict) return refuse("CONFLICT", 409)
    console.error("[contracts/:id/terminate DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
