/**
 * Per-record-type content extraction — H13 Phase 3 slice 1.
 *
 * Each CRM record type has a different "searchable surface" — the
 * fields a sales rep would scan when looking for a deal/contact/etc.
 * This module centralises the field-picking so the indexer + the route
 * agree on what counts as that record's semantic content.
 *
 * Pure, synchronous. No I/O. Caller passes a typed record-shaped
 * object; extractor returns a single concatenated string ready for
 * embedding.
 */
import type { RecordType } from "./types"

/** Maximum length of content fed to the embedder — Voyage cap is 8000 chars. */
export const MAX_CONTENT_CHARS = 8000

function joinNonEmpty(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join("\n")
}

function trimContent(text: string): string {
  // Collapse runs of whitespace + truncate to MAX_CONTENT_CHARS.
  const collapsed = text.replace(/\s+/g, " ").trim()
  return collapsed.length > MAX_CONTENT_CHARS
    ? collapsed.slice(0, MAX_CONTENT_CHARS)
    : collapsed
}

export interface DealRecord {
  name: string
  notes?: string | null
  customerNeed?: string | null
  lostReason?: string | null
  stage?: string | null
  salesChannel?: string | null
  tags?: readonly string[] | null
}

export interface ContactRecord {
  fullName: string
  email?: string | null
  phone?: string | null
  /** Contact's job title — Prisma column is `position`, not `jobTitle`. */
  position?: string | null
  department?: string | null
}

export interface CompanyRecord {
  name: string
  industry?: string | null
  /** Company has `description`, not `notes` — Prisma column name confusion in the L6 era. */
  description?: string | null
  website?: string | null
}

export interface TicketRecord {
  subject: string
  description?: string | null
  category?: string | null
  tags?: readonly string[] | null
}

export interface KbArticleRecord {
  title: string
  content: string
  category?: string | null
}

/**
 * Build the searchable content string for a Deal. Includes name +
 * customer need + notes + lost reason — the fields a rep would scan
 * when looking for a related opportunity. Stage and tags add
 * structured context the embedder can use for category-style matches.
 */
export function dealContent(d: DealRecord): string {
  return trimContent(
    joinNonEmpty([
      `Deal: ${d.name}`,
      d.customerNeed ? `Customer need: ${d.customerNeed}` : null,
      d.notes,
      d.lostReason ? `Lost reason: ${d.lostReason}` : null,
      d.stage ? `Stage: ${d.stage}` : null,
      d.salesChannel ? `Sales channel: ${d.salesChannel}` : null,
      d.tags && d.tags.length > 0 ? `Tags: ${d.tags.join(", ")}` : null,
    ])
  )
}

export function contactContent(c: ContactRecord): string {
  return trimContent(
    joinNonEmpty([
      `Contact: ${c.fullName}`,
      c.position ? `Position: ${c.position}` : null,
      c.department ? `Department: ${c.department}` : null,
      c.email,
      c.phone,
    ])
  )
}

export function companyContent(c: CompanyRecord): string {
  return trimContent(
    joinNonEmpty([
      `Company: ${c.name}`,
      c.industry ? `Industry: ${c.industry}` : null,
      c.description,
      c.website,
    ])
  )
}

export function ticketContent(t: TicketRecord): string {
  return trimContent(
    joinNonEmpty([
      `Ticket: ${t.subject}`,
      t.category ? `Category: ${t.category}` : null,
      t.description,
      t.tags && t.tags.length > 0 ? `Tags: ${t.tags.join(", ")}` : null,
    ])
  )
}

export function kbArticleContent(a: KbArticleRecord): string {
  return trimContent(
    joinNonEmpty([
      `Article: ${a.title}`,
      a.category ? `Category: ${a.category}` : null,
      a.content,
    ])
  )
}

/**
 * Type-dispatched content extractor — caller passes a generic record
 * shape and the type tag picks the right field set. Throws on unknown
 * type so the caller catches drift between the type union and the
 * dispatch table.
 */
export function extractContent(recordType: RecordType, record: unknown): string {
  switch (recordType) {
    case "deal":
      return dealContent(record as DealRecord)
    case "contact":
      return contactContent(record as ContactRecord)
    case "company":
      return companyContent(record as CompanyRecord)
    case "ticket":
      return ticketContent(record as TicketRecord)
    case "kb_article":
      return kbArticleContent(record as KbArticleRecord)
    default: {
      const exhaustive: never = recordType
      throw new Error(`Unsupported recordType: ${exhaustive}`)
    }
  }
}
