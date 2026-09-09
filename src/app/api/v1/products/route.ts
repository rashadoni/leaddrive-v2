import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { LINE_TYPES } from "@/lib/cpq/line-types"
import { isSupportedProductCurrency, MAX_PRODUCT_PRICE } from "@/lib/products/pricing"
import { withRls } from "@/lib/with-rls"

const productCurrencySchema = z.string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(isSupportedProductCurrency, { message: "Unsupported currency" })

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().default("service"),
  sku: z.string().max(64).nullable().optional(),
  productType: z.enum(LINE_TYPES).default("other"),
  price: z.number().finite().nonnegative().max(MAX_PRODUCT_PRICE).default(0),
  currency: productCurrencySchema.default(DEFAULT_CURRENCY),
  isActive: z.boolean().default(true),
  features: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
})

export const GET = withRls(async (req, { orgId }) => {
  const searchParams = new URL(req.url).searchParams
  const activeOnly = searchParams.get("active") === "1"
  const search = searchParams.get("search") || ""
  const products = await prisma.product.findMany({
    where: {
      organizationId: orgId,
      ...(activeOnly ? { isActive: true } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    },
    orderBy: { name: "asc" },
  })

  return NextResponse.json({ success: true, data: products })
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const product = await prisma.product.create({
    data: { ...parsed.data, organizationId: orgId },
  })

  return NextResponse.json({ success: true, data: product }, { status: 201 })
})
