import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmExcelAccess } from "@/lib/mtm/excel-permissions"
import {
  isMtmExcelImportType,
  MTM_EXCEL_MAX_BYTES,
  mtmExcelChecksum,
  parseMtmExcelWorkbook,
} from "@/lib/mtm/excel-contract"
import { validateMtmExcelImport } from "@/lib/mtm/excel-import"

function forbidden() {
  return NextResponse.json({ error: "Excel import is restricted to authorized administrators and managers", code: "MTM_EXCEL_IMPORT_DENIED" }, { status: 403 })
}

export const GET = withRouteFieldWebRlsAuth("read", async (_req, auth) => {
  const access = await resolveMtmExcelAccess(prisma, auth)
  if (!access.actor) return forbidden()
  const jobs = await prisma.mtmImportJob.findMany({
    where: { organizationId: auth.orgId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, type: true, status: true, templateVersion: true, originalFileName: true,
      fileChecksum: true, fileSize: true, requestedBy: true, applyMode: true,
      totalRows: true, createRows: true, updateRows: true, unchangedRows: true,
      skippedRows: true, errorRows: true, validatedAt: true, appliedAt: true,
      failedAt: true, errorMessage: true, createdAt: true, updatedAt: true,
    },
  })
  return NextResponse.json({ success: true, data: { jobs, capabilities: { canImport: access.canImport } } })
})

export const POST = withRouteFieldWebRlsAuth("write", async (req, auth) => {
  const access = await resolveMtmExcelAccess(prisma, auth)
  if (!access.actor || !access.canImport) return forbidden()
  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  const rawType = String(form?.get("type") ?? "").toUpperCase()
  if (!(file instanceof File)) return NextResponse.json({ error: "An .xlsx file is required" }, { status: 400 })
  if (!isMtmExcelImportType(rawType)) return NextResponse.json({ error: "Unsupported import type" }, { status: 400 })
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Only .xlsx files are supported" }, { status: 415 })
  if (file.size <= 0 || file.size > MTM_EXCEL_MAX_BYTES) return NextResponse.json({ error: `File must be between 1 byte and ${MTM_EXCEL_MAX_BYTES} bytes` }, { status: 413 })

  const bytes = Buffer.from(await file.arrayBuffer())
  const checksum = mtmExcelChecksum(bytes)
  const existing = await prisma.mtmImportJob.findUnique({
    where: { organizationId_type_fileChecksum: { organizationId: auth.orgId, type: rawType, fileChecksum: checksum } },
  })
  if (existing) return NextResponse.json({ success: true, data: { job: existing, reused: true } })

  let job
  try {
    job = await prisma.mtmImportJob.create({
      data: {
        organizationId: auth.orgId,
        type: rawType,
        status: "UPLOADED",
        templateVersion: "unknown",
        originalFileName: file.name.slice(0, 255),
        fileChecksum: checksum,
        fileSize: file.size,
        requestedBy: auth.userId,
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.mtmImportJob.findUnique({ where: { organizationId_type_fileChecksum: { organizationId: auth.orgId, type: rawType, fileChecksum: checksum } } })
      return NextResponse.json({ success: true, data: { job: raced, reused: true } })
    }
    throw error
  }

  await prisma.mtmImportJob.update({ where: { id: job.id }, data: { status: "VALIDATING" } })
  try {
    const parsed = await parseMtmExcelWorkbook(bytes, rawType)
    const result = await validateMtmExcelImport({ db: prisma, organizationId: auth.orgId, parsed, checksum, actor: access.actor })
    const summary = result.snapshot.summary
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (result.errors.length > 0) {
        await tx.mtmImportRowError.createMany({
          data: result.errors.map((error) => ({
            organizationId: auth.orgId,
            jobId: job.id,
            sheetName: error.sheetName,
            rowNumber: error.rowNumber,
            columnName: error.columnName,
            errorCode: error.errorCode,
            message: error.message,
            rawValue: error.rawValue === undefined ? Prisma.JsonNull : error.rawValue as Prisma.InputJsonValue,
          })),
        })
      }
      return tx.mtmImportJob.update({
        where: { id: job.id },
        data: {
          status: "READY",
          templateVersion: parsed.templateVersion,
          detectedSheet: parsed.sheetName,
          headerMap: parsed.headers as Prisma.InputJsonValue,
          previewData: result.preview as Prisma.InputJsonValue,
          validatedSnapshot: result.snapshot as unknown as Prisma.InputJsonValue,
          validationSummary: summary as unknown as Prisma.InputJsonValue,
          totalRows: summary.totalRows,
          createRows: summary.createRows,
          updateRows: summary.updateRows,
          unchangedRows: summary.unchangedRows,
          skippedRows: summary.skippedRows,
          errorRows: summary.errorRows,
          validatedAt: new Date(),
        },
      })
    })
    return NextResponse.json({ success: true, data: { job: updated, preview: result.preview, summary, errors: result.errors.slice(0, 100) } }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workbook validation failed"
    await prisma.mtmImportJob.update({ where: { id: job.id }, data: { status: "FAILED", failedAt: new Date(), errorMessage: message } })
    return NextResponse.json({ error: message, jobId: job.id }, { status: 400 })
  }
})
