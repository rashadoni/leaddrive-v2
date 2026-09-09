/**
 * POST /api/v1/search/semantic
 *
 * Cross-record semantic search. Body:
 *   { query: string, types?: RecordType[], limit?: number, threshold?: number }
 *
 * Returns a unified ranked list of hits across the org's
 * `RecordEmbedding` corpus. Slice 1 uses the `DeterministicEmbedder`
 * (token-hash baseline) — slice 2 wires Voyage via
 * `src/lib/ai/embeddings.ts` behind the same DI.
 *
 * Part of H13 Einstein Semantic Search (Phase 3 slice 1).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { DeterministicEmbedder } from "@/lib/semantic-search/deterministic-embedder"
import { rankCandidates } from "@/lib/semantic-search/engine"
import { ALL_RECORD_TYPES } from "@/lib/semantic-search/types"
import type { CandidateRow, RecordType } from "@/lib/semantic-search/types"

const recordTypeSchema = z.enum(["deal", "contact", "company", "ticket", "kb_article"])

const bodySchema = z.object({
  query: z.string().min(1).max(2000),
  types: z.array(recordTypeSchema).min(1).max(5).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  threshold: z.number().min(-1).max(1).optional(),
})

export const POST = withRlsAuth("ai", "read", async (req, auth) => {
  // `ai:read` scope — same module other AI features use (A7 / H3 / H6).
  // No `core` module exists in the permissions matrix; semantic search
  // is a derivative AI feature, not raw CRM read.

  // Transport-agnostic body parsing — same pattern as the H6 email
  // analyze route (avoid Content-Length fragility).
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

  const requestedTypes: readonly RecordType[] = parsed.data.types ?? ALL_RECORD_TYPES

  // Embed the query under the slice-1 embedder. Model-mismatched rows
  // (e.g. slice 2 voyage embeddings written before this is upgraded)
  // would compare meaningless across-model — filter to current model.
  const queryEmbedding = await DeterministicEmbedder.embed(parsed.data.query)

  const CANDIDATE_CAP = 5000
  const rows = await prisma.recordEmbedding.findMany({
    where: {
      organizationId: auth.orgId,
      recordType: { in: [...requestedTypes] },
      embeddingModel: DeterministicEmbedder.model,
    },
    select: {
      recordType: true,
      recordId: true,
      content: true,
      embedding: true,
      embeddingVersion: true,
    },
    take: CANDIDATE_CAP + 1, // +1 so we can detect truncation
    orderBy: { embeddedAt: "desc" }, // bias toward recently embedded rows when truncated
  })
  // If we hit the cap, the candidate set was truncated — surface it
  // honestly in the response so callers know to scope `types` more
  // tightly. Slice 2 (pgvector) removes the in-memory cap entirely.
  const truncated = rows.length > CANDIDATE_CAP
  const trimmedRows = truncated ? rows.slice(0, CANDIDATE_CAP) : rows

  type EmbeddingRow = {
    recordType: string
    recordId: string
    content: string
    embedding: number[]
    embeddingVersion: number
  }
  const candidates: CandidateRow[] = (trimmedRows as EmbeddingRow[]).map(r => ({
    recordType: r.recordType as RecordType,
    recordId: r.recordId,
    content: r.content,
    embedding: r.embedding,
    embeddingVersion: r.embeddingVersion,
  }))

  const result = rankCandidates({
    queryEmbedding,
    candidates,
    limit: parsed.data.limit ?? 20,
    threshold: parsed.data.threshold ?? 0,
  })

  return NextResponse.json({
    success: true,
    query: parsed.data.query,
    embeddingModel: DeterministicEmbedder.model,
    truncated,
    ...result,
  })
})
