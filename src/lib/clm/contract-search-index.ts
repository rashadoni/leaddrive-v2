/**
 * «Ağıllı axtarış» on the contracts page — search by meaning (owner,
 * 2026-11-26: «Довести до работы»).
 *
 * What it was: the button was on the page for everyone, the switch
 * (`ai_semantic_search`) was nowhere, the nightly indexing was in no schedule,
 * and without a Voyage key the code made a «vector» out of character codes —
 * results that only looked like an answer. Now:
 *   - the switch is in Settings → AI automation (copilot group);
 *   - a contract's vector is made from what a person searches by: title,
 *     number, the counterparty's name and the text with personal data masked;
 *   - a contract is re-indexed when it changed after its vector was made, by
 *     the search itself (a small batch, so the first search already finds
 *     something) and by the hourly job for the rest;
 *   - no Voyage for this organization (no key, limit spent): the search goes by
 *     words over the same fields and says so — never a made-up vector.
 */
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { VOYAGE_MODEL, voyageEmbedding } from "@/lib/ai/voyage-embedding"

/** Voyage reads the first 8000 characters; what follows would be stored but never searched. */
export const SEARCH_TEXT_MAX_CHARS = 8000

export interface IndexableContract {
  id: string
  title: string
  contractNumber: string
  companyName: string | null
  renderedBody: string | null
  versionId: string | null
}

/** The text a contract is found by. Names of the parties stay: a company is what people search for. */
export function contractSearchText(contract: Pick<IndexableContract, "title" | "contractNumber" | "companyName" | "renderedBody">): string {
  const body = contract.renderedBody?.trim() ? new PiiMasker().mask(contract.renderedBody) : ""
  return [contract.title, contract.contractNumber, contract.companyName ?? "", body]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, SEARCH_TEXT_MAX_CHARS)
}

/**
 * This organization's contracts with no vector, one by another model, or one
 * older than the contract — the most recently changed first.
 */
export async function contractsToIndex(orgId: string, limit: number): Promise<IndexableContract[]> {
  return prisma.$queryRaw<IndexableContract[]>`
    SELECT c.id, c.title, c."contractNumber", co.name AS "companyName", c."renderedBody", cv.id AS "versionId"
    FROM contracts c
    LEFT JOIN contract_embeddings ce ON ce."contractId" = c.id
    LEFT JOIN companies co ON co.id = c."companyId" AND co."organizationId" = c."organizationId"
    LEFT JOIN LATERAL (
      SELECT id FROM contract_versions cv2
      WHERE cv2."contractId" = c.id AND cv2."isCanonicalSigned" = true
      ORDER BY cv2."createdAt" DESC
      LIMIT 1
    ) cv ON true
    WHERE c."organizationId" = ${orgId}
      AND (ce.id IS NULL OR ce.model <> ${VOYAGE_MODEL} OR c."updatedAt" > ce."updatedAt")
    ORDER BY c."updatedAt" DESC
    LIMIT ${limit}
  `
}

/** One contract, now, whatever its vector's age (the card's «AI Axtarışı üçün Yenidən İndekslə»). */
export async function indexOneContract(orgId: string, contractId: string): Promise<"indexed" | "not_found" | "unavailable"> {
  const rows = await prisma.$queryRaw<IndexableContract[]>`
    SELECT c.id, c.title, c."contractNumber", co.name AS "companyName", c."renderedBody", cv.id AS "versionId"
    FROM contracts c
    LEFT JOIN companies co ON co.id = c."companyId" AND co."organizationId" = c."organizationId"
    LEFT JOIN LATERAL (
      SELECT id FROM contract_versions cv2
      WHERE cv2."contractId" = c.id AND cv2."isCanonicalSigned" = true
      ORDER BY cv2."createdAt" DESC
      LIMIT 1
    ) cv ON true
    WHERE c."organizationId" = ${orgId} AND c.id = ${contractId}
  `
  const row = rows[0]
  if (!row) return "not_found"
  const text = contractSearchText(row)
  const vector = text ? await voyageEmbedding(orgId, text, "contracts") : null
  if (!vector) return "unavailable"
  await saveVector(orgId, row, text, vector)
  return "indexed"
}

export interface IndexRun {
  indexed: number
  /** Voyage is not this organization's now (no key it may use, limit spent, no answer): nothing more was tried. */
  unavailable: boolean
}

/** Make vectors for up to `limit` contracts that need one, stopping at `deadline` (epoch ms) or when Voyage refuses. */
export async function indexContracts(orgId: string, { limit, deadline }: { limit: number; deadline?: number }): Promise<IndexRun> {
  const rows = await contractsToIndex(orgId, limit)
  let indexed = 0
  for (const row of rows) {
    if (deadline && Date.now() > deadline) break
    const text = contractSearchText(row)
    if (!text) continue
    const vector = await voyageEmbedding(orgId, text, "contracts")
    if (!vector) return { indexed, unavailable: true }
    await saveVector(orgId, row, text, vector)
    indexed++
  }
  return { indexed, unavailable: false }
}

async function saveVector(orgId: string, row: IndexableContract, text: string, vector: number[]) {
  const id = `cemb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  await prisma.$executeRaw`
    INSERT INTO "contract_embeddings"
      ("id", "organizationId", "contractId", "contractVersionId", "content", "embedding", "model", "createdAt", "updatedAt")
    VALUES (${id}, ${orgId}, ${row.id}, ${row.versionId}, ${text}, ${`[${vector.join(",")}]`}::vector, ${VOYAGE_MODEL}, NOW(), NOW())
    ON CONFLICT ("contractId") DO UPDATE
      SET "content" = EXCLUDED."content",
          "embedding" = EXCLUDED."embedding",
          "model" = EXCLUDED."model",
          "contractVersionId" = EXCLUDED."contractVersionId",
          "updatedAt" = NOW()
  `
}

export interface SearchHit {
  contractId: string
  contractNumber: string
  title: string
  status: string
  valueAmount: number | null
  currency: string
  /** 0..1 — closeness by meaning; for a search by words, 1 for every hit. */
  similarity: number
}

type HitRow = Omit<SearchHit, "valueAmount" | "similarity"> & { valueAmount: string | null; similarity: unknown }
const toHit = (row: HitRow): SearchHit => ({
  contractId: row.contractId,
  contractNumber: row.contractNumber,
  title: row.title,
  status: row.status,
  valueAmount: row.valueAmount ? Number(row.valueAmount) : null,
  currency: row.currency,
  similarity: Number(row.similarity) || 0,
})

/** Contracts nearest in meaning to the query's vector — only this organization's, on both sides of the join. */
export async function searchByMeaning(orgId: string, vector: number[], limit: number, threshold: number): Promise<SearchHit[]> {
  const rows: HitRow[] = await prisma.$queryRaw<HitRow[]>`
    SELECT ce."contractId", c."contractNumber", c.title, c.status, c."valueAmount"::text AS "valueAmount", c.currency,
           1 - (ce."embedding" <=> ${`[${vector.join(",")}]`}::vector) AS similarity
    FROM contract_embeddings ce
    JOIN contracts c ON c.id = ce."contractId" AND c."organizationId" = ${orgId}
    WHERE ce."organizationId" = ${orgId} AND ce.model = ${VOYAGE_MODEL}
    ORDER BY ce."embedding" <=> ${`[${vector.join(",")}]`}::vector
    LIMIT ${limit}
  `
  return rows.map(toHit).filter((hit: SearchHit) => hit.similarity >= threshold)
}

/** Without Voyage: every word of the query in the title, number, counterparty or text. */
export async function searchByWords(orgId: string, query: string, limit: number): Promise<SearchHit[]> {
  const words = query.toLocaleLowerCase("az").split(/\s+/).map((w) => w.replace(/[%_\\]/g, "")).filter((w) => w.length >= 2).slice(0, 8)
  if (words.length === 0) return []
  const conditions = words.map((word) => Prisma.sql`(
    c.title ILIKE ${`%${word}%`} OR c."contractNumber" ILIKE ${`%${word}%`}
    OR co.name ILIKE ${`%${word}%`} OR c."renderedBody" ILIKE ${`%${word}%`}
  )`)
  const rows: HitRow[] = await prisma.$queryRaw<HitRow[]>`
    SELECT c.id AS "contractId", c."contractNumber", c.title, c.status, c."valueAmount"::text AS "valueAmount", c.currency, 1 AS similarity
    FROM contracts c
    LEFT JOIN companies co ON co.id = c."companyId" AND co."organizationId" = c."organizationId"
    WHERE c."organizationId" = ${orgId} AND ${Prisma.join(conditions, " AND ")}
    ORDER BY c."updatedAt" DESC
    LIMIT ${limit}
  `
  return rows.map(toHit)
}
