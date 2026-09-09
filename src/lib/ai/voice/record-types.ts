/**
 * Records the voice assistant can find by name and put on screen.
 *
 * Third time this lesson has been learned in this feature, and the first two
 * are why the file exists rather than another hand-written list:
 *
 *  - navigation destinations were listed by hand and shipped without `leads`;
 *  - read tools were written one per entity and shipped without quotes, boards
 *    and per-person breakdowns;
 *  - openable records were listed by hand — extended to eight types after the
 *    owner asked for invoices, then found on the very next attempt that boards
 *    were the ninth I had not thought of.
 *
 * Each time the hole was found by the owner, not by me, because a list cannot
 * tell you what is missing from it. So this file is paired with a test that
 * walks the app's own detail routes and fails when one is neither registered
 * nor explicitly excluded. The test is the guarantee; the list is just data.
 */

export type RecordDescriptor = {
  /** Route prefix; the id is appended. */
  route: string
  /** Prisma model that holds the row. */
  model: string
  /** Columns matched against what the user said, in order of usefulness. */
  searchFields: string[]
}

/**
 * One canonical list for navigation, model input validation and authorization.
 * Adding a type here intentionally makes the typed descriptor/access maps and
 * the exhaustive search dispatcher fail until the new record is fully wired.
 */
export const RECORD_TYPE_NAMES = [
  "deal",
  "contact",
  "company",
  "lead",
  "ticket",
  "invoice",
  "project",
  "contract",
  "board",
  "product",
  "quote",
  "campaign",
  "complaint",
  "event",
  "task",
] as const

export type VoiceRecordType = (typeof RECORD_TYPE_NAMES)[number]

export const RECORD_TYPES = {
  deal: { route: "/deals", model: "deal", searchFields: ["name"] },
  contact: { route: "/contacts", model: "contact", searchFields: ["fullName"] },
  company: { route: "/companies", model: "company", searchFields: ["name"] },
  lead: { route: "/leads", model: "lead", searchFields: ["contactName", "companyName"] },
  ticket: { route: "/tickets", model: "ticket", searchFields: ["subject"] },
  invoice: { route: "/invoices", model: "invoice", searchFields: ["invoiceNumber"] },
  project: { route: "/projects", model: "project", searchFields: ["name"] },
  contract: { route: "/contracts", model: "contract", searchFields: ["title"] },
  // A board is a Division. `key` is searched because the card prints it
  // ("HHH", "MEETING") and that is what a person reads out loud.
  board: { route: "/boards", model: "division", searchFields: ["name", "key"] },
  product: { route: "/products", model: "product", searchFields: ["name", "sku"] },
  quote: { route: "/quotes", model: "quote", searchFields: ["quoteNumber"] },
  campaign: { route: "/campaigns", model: "campaign", searchFields: ["name"] },
  // Complaints are Ticket rows with a one-to-one ComplaintMeta relation; there
  // is deliberately no standalone Prisma `complaint` model.
  complaint: { route: "/complaints", model: "ticket", searchFields: ["subject"] },
  event: { route: "/events", model: "event", searchFields: ["name"] },
  task: { route: "/tasks", model: "task", searchFields: ["title"] },
} satisfies Record<VoiceRecordType, RecordDescriptor>

/**
 * Detail routes that exist but must NOT be voice-openable, with the reason.
 *
 * Written down rather than merely absent: the test cannot tell a decision from
 * an oversight, and an oversight is exactly what keeps happening here.
 *
 *  - "internal"  — a tool surface, not a customer record (cobrowse sessions).
 *  - "config"    — a template or definition, not data to look at.
 *  - "nested"    — reachable only inside a parent; opening it alone is
 *                  meaningless without the context it sits in.
 *  - "pending"   — a real record type nobody has registered yet. Countable, and
 *                  meant to shrink.
 */
export const NOT_OPENABLE: Record<string, "internal" | "config" | "nested" | "pending"> = {
  "cobrowse/[id]": "internal",
  "marketplace/demo/[id]": "internal",
  "forms/[id]": "config",
  "knowledge-base/[id]": "config",
  "surveys/[id]": "config",
  "loyalty/accounts/[id]": "nested",
  "offers/[id]": "pending",
  "health/[id]": "pending",
  "insurance/[id]": "pending",
  "energy/[id]": "pending",
  "media/[id]": "pending",
  "mtm/contacts/[id]": "pending",
  "mtm/customers/[id]": "pending",
  "mtm/promotions/[id]": "pending",
  "mtm/tasks/[id]": "pending",
  // An operational surface for dispatching calls, not a customer record the
  // voice agent reads aloud. Keeping it unopenable holds the read-only line.
  "voip/call-queues/[id]": "internal",
}

export function recordRoute(type: string, id: string): string | null {
  const d = RECORD_TYPES[type as VoiceRecordType]
  return d ? `${d.route}/${id}` : null
}

/**
 * Types read_record can read. Lives here, in the client-safe module, because
 * the tool registry is imported by the browser voice console: importing it
 * from record-read.ts dragged @/lib/prisma (and node:async_hooks) into the
 * client compile and broke `next build` outright. Boards are absent on
 * purpose - their card is a task list, covered by get_boards_summary.
 */
export const VOICE_READABLE_TYPES = [
  "deal",
  "contact",
  "company",
  "lead",
  "ticket",
  "invoice",
  "project",
  "contract",
  "product",
] as const
export type VoiceReadableType = (typeof VOICE_READABLE_TYPES)[number]
