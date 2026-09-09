import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { withRls } from "@/lib/with-rls"
import { LINE_TYPES } from "@/lib/cpq/line-types"
import { isSupportedProductCurrency, MAX_PRODUCT_PRICE } from "@/lib/products/pricing"

const productCurrencySchema = z.string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(isSupportedProductCurrency, { message: "Unsupported currency" })

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.string().optional(),
  price: z.number().finite().nonnegative().max(MAX_PRODUCT_PRICE).optional(),
  currency: productCurrencySchema.optional(),
  isActive: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  sku: z.string().max(64).nullable().optional(),
  productType: z.enum(LINE_TYPES).optional(),
})

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const product = await prisma.product.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 })

  return NextResponse.json({ success: true, data: product })
})

export const PUT = withRls(async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const product = await prisma.product.updateMany({
    where: { id, organizationId: orgId },
    data: parsed.data,
  })

  if (product.count === 0) return NextResponse.json({ error: "Product not found" }, { status: 404 })

  const updated = await prisma.product.findFirst({ where: { id } })
  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const result = await prisma.product.deleteMany({
      where: { id, organizationId: orgId },
    })

    if (result.count === 0) return NextResponse.json({ error: "Product not found" }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    // InventoryItem.productId -> Product is onDelete: Restrict (prisma/schema.prisma),
    // so deleting a product that still has inventory_items rows throws a P2003 FK
    // violation. Surface it as a clean 409 instead of an unhandled 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json(
        { error: "Cannot delete a product that still has inventory stock. Remove or reassign its inventory first." },
        { status: 409 },
      )
    }
    console.error("DELETE /api/v1/products/[id] failed:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
