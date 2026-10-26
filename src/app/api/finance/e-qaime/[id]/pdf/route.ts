import { NextResponse } from "next/server"
import { mkdir, readFile, unlink, writeFile } from "fs/promises"
import path from "path"
import crypto from "crypto"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { validateUploadBytes } from "@/lib/upload-security"
import { runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { openTenantFileBytes, sealTenantFile } from "@/lib/crypto/tenant-file-encryption"
import { E_QAIME_PDF_MAX_BYTES } from "@/lib/finance/e-qaime"

const UPLOAD_SUBDIR = "e-qaime"

type Ctx = { params: Promise<{ id: string }> }

/** GET — the invoice's PDF as the tax portal printed it. */
export const GET = withRlsAuth("finance", "read", async (_req, { orgId }, { params }: Ctx) => {
  const { id } = await params
  const invoice = await prisma.eQaimeInvoice.findFirst({
    where: { id, organizationId: orgId },
    select: { serialNumber: true, pdfFile: true },
  })
  if (!invoice?.pdfFile) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let bytes: Buffer
  try {
    const stored = await readFile(path.join(runtimePublicUploadDirectory(UPLOAD_SUBDIR), path.basename(invoice.pdfFile)))
    bytes = await openTenantFileBytes(orgId, stored)
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.serialNumber.replace(/[^A-Z0-9]/gi, "")}.pdf"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
})

/**
 * PUT — the PDF the extension downloaded from the portal for this invoice, as
 * the raw request body. Stored sealed for the organization; a newer copy
 * replaces the older one (the portal stamps a cancelled invoice).
 */
export const PUT = withRlsAuth("finance", "write", async (req, { orgId }, { params }: Ctx) => {
  const { id } = await params
  const declared = Number(req.headers.get("content-length") ?? 0)
  if (declared > E_QAIME_PDF_MAX_BYTES) return NextResponse.json({ error: "File too large" }, { status: 413 })

  const invoice = await prisma.eQaimeInvoice.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, pdfFile: true },
  })
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const bytes = Buffer.from(await req.arrayBuffer())
  if (bytes.length > E_QAIME_PDF_MAX_BYTES) return NextResponse.json({ error: "File too large" }, { status: 413 })
  const contentError = validateUploadBytes("application/pdf", bytes)
  if (contentError) return NextResponse.json({ error: contentError }, { status: 400 })

  const directory = runtimePublicUploadDirectory(UPLOAD_SUBDIR)
  await mkdir(directory, { recursive: true })
  const fileName = `${crypto.randomBytes(16).toString("hex")}.pdf`
  await writeFile(path.join(directory, fileName), sealTenantFile(orgId, bytes))

  const updated = await prisma.eQaimeInvoice.updateMany({
    where: { id: invoice.id, organizationId: orgId },
    data: { pdfFile: fileName, pdfSize: bytes.length },
  })
  if (updated.count !== 1) {
    await unlink(path.join(directory, fileName)).catch(() => {})
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (invoice.pdfFile) await unlink(path.join(directory, path.basename(invoice.pdfFile))).catch(() => {})

  return NextResponse.json({ data: { id: invoice.id, hasPdf: true } })
})
