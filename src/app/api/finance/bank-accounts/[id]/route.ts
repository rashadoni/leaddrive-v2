import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

const updateSchema = z.object({
  accountName: z.string().min(1).max(200).optional(),
  accountNumber: z.string().max(50).optional().nullable(),
  bankName: z.string().min(1).max(200).optional(),
  bankCode: z.string().max(50).optional().nullable(),
  swiftCode: z.string().max(20).optional().nullable(),
  currency: z.string().max(10).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict()

// PUT — update bank account
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return runWithTenant(orgId, async () => {
    const { id } = await params

    const existing = await prisma.bankAccount.findFirst({ where: { id, organizationId: orgId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let body
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    let data
    try { data = updateSchema.parse(body) } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    if (data.isDefault) {
      await prisma.bankAccount.updateMany({
        where: { organizationId: orgId, isDefault: true },
        data: { isDefault: false },
      })
    }

    const account = await prisma.bankAccount.update({ where: { id }, data })
    return NextResponse.json({ data: account })
  })
}

// DELETE — delete bank account
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return runWithTenant(orgId, async () => {
    const { id } = await params

    const existing = await prisma.bankAccount.findFirst({ where: { id, organizationId: orgId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await prisma.bankAccount.delete({ where: { id } })
    return NextResponse.json({ success: true })
  })
}
