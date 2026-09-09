import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const updateSnippetSchema = z.object({
  shortcut: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[^\s/]+$/, "shortcut must be a single token without spaces or '/'")
    .optional(),
  title: z.string().min(1).max(255).optional(),
  body: z.string().min(1).max(8000).optional(),
  channelTypes: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export const GET = withRls(
  async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const snippet = await prisma.messageSnippet.findFirst({ where: { id, organizationId: orgId } })
    if (!snippet) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: snippet })
  },
)

export const PUT = withRls(
  async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params

    const body = await req.json()
    const parsed = updateSnippetSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    try {
      // updateMany keeps the tenant guard (id + organizationId) so a cross-tenant id can't write.
      const result = await prisma.messageSnippet.updateMany({
        where: { id, organizationId: orgId },
        data: parsed.data,
      })
      if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return NextResponse.json(
          { error: "A snippet with this shortcut already exists" },
          { status: 409 },
        )
      }
      throw e
    }

    const updated = await prisma.messageSnippet.findFirst({ where: { id, organizationId: orgId } })
    return NextResponse.json({ success: true, data: updated })
  },
)

export const DELETE = withRls(
  async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const result = await prisma.messageSnippet.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { deleted: id } })
  },
)
