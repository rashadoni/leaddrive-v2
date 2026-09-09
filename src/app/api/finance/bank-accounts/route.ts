import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { DEFAULT_CURRENCY } from "@/lib/constants"

const createSchema = z.object({
  accountName: z.string().min(1).max(200),
  accountNumber: z.string().max(50).optional(),
  bankName: z.string().min(1).max(200),
  bankCode: z.string().max(50).optional(),
  swiftCode: z.string().max(20).optional(),
  currency: z.string().max(10).optional(),
  isDefault: z.boolean().optional(),
}).strict()

// GET — list bank accounts
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
    const accounts = await prisma.bankAccount.findMany({
      where: { organizationId: orgId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    })

    return NextResponse.json({ data: accounts })
  })
}

// POST — create bank account
export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
    let body
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    let data
    try { data = createSchema.parse(body) } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    // If this is set as default, unset other defaults
    if (data.isDefault) {
      await prisma.bankAccount.updateMany({
        where: { organizationId: orgId, isDefault: true },
        data: { isDefault: false },
      })
    }

    const account = await prisma.bankAccount.create({
      data: {
        organizationId: orgId,
        accountName: data.accountName,
        accountNumber: data.accountNumber || null,
        bankName: data.bankName,
        bankCode: data.bankCode || null,
        swiftCode: data.swiftCode || null,
        currency: data.currency || DEFAULT_CURRENCY,
        isDefault: data.isDefault || false,
      },
    })

    return NextResponse.json({ data: account }, { status: 201 })
  })
}
