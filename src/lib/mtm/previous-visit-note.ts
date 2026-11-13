/**
 * The note from the last visit to a route stop's subject (Zeytun 2026-11-13,
 * owner's mockup approved with «Давай»: «всё, что пишется в заметки в конце
 * визита, при следующем визите нужно, чтоб напоминало агенту — в маршруте и в
 * момент, когда он начинает визит»).
 *
 * The subject is the doctor on a doctor stop and the organization on an
 * organization stop — a doctor's note does not follow the agent to the
 * pharmacy downstairs, and a pharmacy's note is not about any one doctor.
 * Any agent's note counts: the next agent on the territory needs it most.
 * Only visits begun before the route's day: a note written today is not
 * «last time» for today's stops.
 */
import type { Prisma } from "@prisma/client"

export const PREVIOUS_VISIT_NOTE_MAX_CHARS = 1000
/** Visits read per subject: whitespace-only notes are skipped, not fatal. */
const CANDIDATES_PER_SUBJECT = 5

export type MtmPreviousVisitNote = {
  visitId: string
  text: string
  /** The visit's check-in, ISO. */
  at: string
  agentName: string | null
}

type CandidateVisit = {
  id: string
  checkInAt: Date
  notes: string | null
  resultNotes: string | null
  agent: { name: string | null } | null
}

type Subject = { customerId: string; contactId?: string | null }

type VisitReader = {
  mtmVisit: {
    findMany(args: Prisma.MtmVisitFindManyArgs): Promise<unknown[]>
  }
}

/** The text a person wrote at the end of a visit: the result note and the checkout note, once each. */
export function previousVisitNoteText(visit: { notes?: string | null; resultNotes?: string | null }): string | null {
  const parts: string[] = []
  for (const value of [visit.resultNotes, visit.notes]) {
    const text = value?.trim()
    if (text && !parts.includes(text)) parts.push(text)
  }
  if (parts.length === 0) return null
  const text = parts.join("\n")
  return text.length > PREVIOUS_VISIT_NOTE_MAX_CHARS
    ? `${text.slice(0, PREVIOUS_VISIT_NOTE_MAX_CHARS - 1)}…`
    : text
}

/** The newest visit (candidates come newest first) that left words behind. */
export function pickPreviousVisitNote(candidates: CandidateVisit[]): MtmPreviousVisitNote | null {
  for (const visit of candidates) {
    const text = previousVisitNoteText(visit)
    if (text) {
      return { visitId: visit.id, text, at: visit.checkInAt.toISOString(), agentName: visit.agent?.name ?? null }
    }
  }
  return null
}

export function previousVisitSubjectKey(subject: Subject): string {
  return subject.contactId ? `contact:${subject.contactId}` : `customer:${subject.customerId}`
}

export function previousVisitSubjectWhere(subject: Subject): Prisma.MtmVisitWhereInput {
  return subject.contactId
    ? { contactId: subject.contactId }
    : { customerId: subject.customerId, contactId: null }
}

/**
 * One note per stop, keyed by the stop's id. Subjects repeated on a route are
 * read once.
 */
export async function previousVisitNotesForPoints(
  db: VisitReader,
  input: {
    organizationId: string
    before: Date
    points: Array<{ id: string } & Subject>
  },
): Promise<Map<string, MtmPreviousVisitNote | null>> {
  const subjects = new Map<string, Subject>()
  for (const point of input.points) subjects.set(previousVisitSubjectKey(point), point)
  const notes = new Map<string, MtmPreviousVisitNote | null>()
  await Promise.all([...subjects.entries()].map(async ([key, subject]) => {
    const candidates = await db.mtmVisit.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        status: "CHECKED_OUT",
        checkInAt: { lt: input.before },
        OR: [{ notes: { not: null } }, { resultNotes: { not: null } }],
        ...previousVisitSubjectWhere(subject),
      },
      orderBy: { checkInAt: "desc" },
      take: CANDIDATES_PER_SUBJECT,
      select: {
        id: true,
        checkInAt: true,
        notes: true,
        resultNotes: true,
        agent: { select: { name: true } },
      },
    }) as CandidateVisit[]
    notes.set(key, pickPreviousVisitNote(candidates))
  }))
  return new Map(input.points.map((point) => [point.id, notes.get(previousVisitSubjectKey(point)) ?? null]))
}
