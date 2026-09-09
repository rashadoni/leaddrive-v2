import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

// E3.1 — inbox composer snippet library. Tenant-scoped via withRls (same shape as
// ticket-macros). The "/shortcut" must be a single token (no spaces, no leading "/")
// because it's matched against what the agent types after the "/" trigger.
const createSnippetSchema = z.object({
  shortcut: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[^\s/]+$/, "shortcut must be a single token without spaces or '/'"),
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(8000),
  channelTypes: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const channel = searchParams.get("channel")
  // Composer picker wants ACTIVE snippets only; an editor UI can pass includeInactive=1
  // to also see deactivated ones (so the isActive toggle actually does something).
  const includeInactive = searchParams.get("includeInactive") === "1"

  const snippets = await prisma.messageSnippet.findMany({
    where: {
      organizationId: orgId,
      ...(includeInactive ? {} : { isActive: true }),
      // channel filter: empty channelTypes = applies to all channels
      ...(channel
        ? { OR: [{ channelTypes: { isEmpty: true } }, { channelTypes: { has: channel } }] }
        : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  })

  return NextResponse.json({ success: true, data: snippets })
})

export const POST = withRls(async (req, { orgId, session }) => {
  const body = await req.json()
  const parsed = createSnippetSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const snippet = await prisma.messageSnippet.create({
      data: {
        organizationId: orgId,
        createdBy: session?.userId ?? null,
        ...parsed.data,
      },
    })
    return NextResponse.json({ success: true, data: snippet }, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "A snippet with this shortcut already exists" },
        { status: 409 },
      )
    }
    throw e
  }
})
