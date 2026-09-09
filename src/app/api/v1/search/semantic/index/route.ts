/**
 * POST /api/v1/search/semantic/index
 *
 * Re-embed one record's content. Body:
 *   { recordType: RecordType, recordId: string, content?: string }
 *
 * If `content` is omitted the route fetches the record by id, extracts
 * the searchable text via `content-extractor`, and embeds. If supplied,
 * the caller's text overrides — useful for ad-hoc re-indexing without
 * round-tripping through the entity tables.
 *
 * Skips re-embedding if the new content's SHA-256 matches the stored
 * `contentHash` — keeps embedding cost low when records change in
 * ways the searchable surface doesn't care about.
 *
 * Part of H13 Einstein Semantic Search (Phase 3 slice 1).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  contactContent,
  companyContent,
  dealContent,
  kbArticleContent,
  ticketContent,
  type DealRecord,
  type ContactRecord,
  type CompanyRecord,
  type TicketRecord,
  type KbArticleRecord,
} from "@/lib/semantic-search/content-extractor"
import { DeterministicEmbedder } from "@/lib/semantic-search/deterministic-embedder"
import { embedAndHashContent } from "@/lib/semantic-search/engine"
import type { RecordType } from "@/lib/semantic-search/types"

const bodySchema = z.object({
  recordType: z.enum(["deal", "contact", "company", "ticket", "kb_article"]),
  recordId: z.string().min(1).max(120),
  content: z.string().max(50_000).optional(),
})

/**
 * Pull a record's searchable surface from the org's tables. Returns
 * null when the record doesn't exist or doesn't belong to this org —
 * caller surfaces as 404. Each branch picks a tight field projection
 * so we don't drag heavy columns into the route.
 */
async function fetchContentFromRecord(
  organizationId: string,
  recordType: RecordType,
  recordId: string
): Promise<string | null> {
  switch (recordType) {
    case "deal": {
      const row = await prisma.deal.findFirst({
        where: { id: recordId, organizationId },
        select: {
          name: true,
          notes: true,
          customerNeed: true,
          lostReason: true,
          stage: true,
          salesChannel: true,
          tags: true,
        },
      })
      if (!row) return null
      return dealContent(row as DealRecord)
    }
    case "contact": {
      const row = await prisma.contact.findFirst({
        where: { id: recordId, organizationId },
        select: {
          fullName: true,
          email: true,
          phone: true,
          position: true,
          department: true,
        },
      })
      if (!row) return null
      return contactContent(row as ContactRecord)
    }
    case "company": {
      const row = await prisma.company.findFirst({
        where: { id: recordId, organizationId },
        select: {
          name: true,
          industry: true,
          description: true,
          website: true,
        },
      })
      if (!row) return null
      return companyContent(row as CompanyRecord)
    }
    case "ticket": {
      const row = await prisma.ticket.findFirst({
        where: { id: recordId, organizationId },
        select: {
          subject: true,
          description: true,
          category: true,
          tags: true,
        },
      })
      if (!row) return null
      return ticketContent(row as TicketRecord)
    }
    case "kb_article": {
      const row = await prisma.kbArticle.findFirst({
        where: { id: recordId, organizationId },
        select: {
          title: true,
          content: true,
          category: { select: { name: true } },
        },
      })
      if (!row) return null
      return kbArticleContent({
        title: row.title,
        content: row.content ?? "",
        category: row.category?.name ?? null,
      })
    }
  }
}

export const POST = withRlsAuth("ai", "write", async (req, auth) => {
  // `ai:write` — index path writes to record_embeddings (an AI artifact),
  // not to the source CRM tables. Same scope as A7 / H3 / H6 sibling routes.
  let body: unknown = {}
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 })
  }
  if (raw.trim().length > 0) {
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
    }
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  let content: string
  if (parsed.data.content && parsed.data.content.trim().length > 0) {
    content = parsed.data.content
  } else {
    const fetched = await fetchContentFromRecord(
      auth.orgId,
      parsed.data.recordType,
      parsed.data.recordId
    )
    if (fetched == null) return NextResponse.json({ error: "Record not found" }, { status: 404 })
    if (!fetched.trim()) {
      return NextResponse.json(
        { error: "Record has no embeddable content (all searchable fields are empty)" },
        { status: 422 }
      )
    }
    content = fetched
  }

  const existing = await prisma.recordEmbedding.findUnique({
    where: {
      organizationId_recordType_recordId: {
        organizationId: auth.orgId,
        recordType: parsed.data.recordType,
        recordId: parsed.data.recordId,
      },
    },
    select: { id: true, contentHash: true, embeddingModel: true },
  })

  let result
  try {
    result = await embedAndHashContent(DeterministicEmbedder, content)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Embedding failed" },
      { status: 422 }
    )
  }

  // Skip the write if content hasn't changed AND the embedder model is
  // identical to the stored one — avoids burning cost on no-op updates.
  if (
    existing &&
    existing.contentHash === result.contentHash &&
    existing.embeddingModel === result.model
  ) {
    return NextResponse.json({ success: true, skipped: true, reason: "unchanged" })
  }

  await prisma.recordEmbedding.upsert({
    where: {
      organizationId_recordType_recordId: {
        organizationId: auth.orgId,
        recordType: parsed.data.recordType,
        recordId: parsed.data.recordId,
      },
    },
    create: {
      organizationId: auth.orgId,
      recordType: parsed.data.recordType,
      recordId: parsed.data.recordId,
      content,
      contentHash: result.contentHash,
      embedding: result.embedding as number[],
      embeddingModel: result.model,
      embeddingVersion: 1,
    },
    update: {
      content,
      contentHash: result.contentHash,
      embedding: result.embedding as number[],
      embeddingModel: result.model,
      embeddedAt: new Date(),
    },
  })

  return NextResponse.json({
    success: true,
    skipped: false,
    embeddingModel: result.model,
    contentLength: content.length,
  })
})
