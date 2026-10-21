import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"

/**
 * The agent's external code is given by the system, one after another (owner,
 * 2026-10-20, on the agent form: «тут код агента чтоб автоматически
 * задавался. последовательно»). A code typed in the form is still kept as
 * typed: some organizations carry the code of their own outside database.
 *
 * The next code continues the sequence most of the organization's codes are
 * in — «AG-007», «NZ-001», «AG-016» → «AG-017» — past the highest number that
 * sequence has reached. One code typed by hand in another shape does not
 * start a new sequence; a tie goes to the sequence given most recently. With
 * no code in the organization yet, the first is «AG-001», the shape the form's
 * hint has always shown.
 */

export const MTM_AGENT_CODE_DEFAULT_PREFIX = "AG-"
const DEFAULT_WIDTH = 3
/** Two people saving a new agent in the same moment draw the same number; the loser draws again. */
const MAX_ATTEMPTS = 10

/** «AG-016» → prefix «AG-», number 16, width 3; null for a code that does not end in digits. */
export function splitMtmAgentCode(code: string): { prefix: string; number: number; width: number } | null {
  const match = /^(.*?)(\d+)$/.exec(code.trim())
  if (!match) return null
  const number = Number(match[2])
  if (!Number.isSafeInteger(number)) return null
  return { prefix: match[1], number, width: match[2].length }
}

/** The code the next agent gets, from the organization's codes listed newest card first. */
export function nextMtmAgentCode(codesNewestFirst: ReadonlyArray<string | null>): string {
  const parsed = codesNewestFirst.flatMap((code) => {
    const split = code ? splitMtmAgentCode(code) : null
    return split ? [split] : []
  })
  const counts = new Map<string, number>()
  for (const code of parsed) counts.set(code.prefix, (counts.get(code.prefix) ?? 0) + 1)
  // Newest first, so on a tie the first one met is the sequence given last.
  const sequence = parsed.reduce<(typeof parsed)[number] | null>(
    (chosen, code) => (!chosen || counts.get(code.prefix)! > counts.get(chosen.prefix)! ? code : chosen),
    null,
  )
  const prefix = sequence?.prefix ?? MTM_AGENT_CODE_DEFAULT_PREFIX
  const width = sequence?.width ?? DEFAULT_WIDTH
  const top = parsed.reduce((highest, code) => (code.prefix === prefix && code.number > highest ? code.number : highest), 0)
  return `${prefix}${String(top + 1).padStart(width, "0")}`
}

type AgentCodeReader = {
  mtmAgent: {
    findMany(args: {
      where: { organizationId: string; externalCode: { not: null } }
      orderBy: Array<{ createdAt: "desc" } | { id: "desc" }>
      select: { externalCode: true }
    }): Promise<Array<{ externalCode: string | null }>>
  }
}

/** Every card counts, the inactive ones too: the database keeps a code unique among all of them. */
export async function nextMtmAgentCodeFor(db: AgentCodeReader, organizationId: string): Promise<string> {
  const rows = await db.mtmAgent.findMany({
    where: { organizationId, externalCode: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { externalCode: true },
  })
  return nextMtmAgentCode(rows.map((row) => row.externalCode))
}

/** The database refused the code because another card of the organization already carries it. */
export function isMtmAgentCodeConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false
  const target = error.meta?.target
  return Array.isArray(target) ? target.includes("externalCode") : String(target ?? "").includes("externalCode")
}

/**
 * Writes a card with the code that was typed, or with the next one when none
 * was. A typed code another card holds is refused; a drawn one that another
 * save took a moment earlier is drawn again.
 */
export async function writeWithMtmAgentCode<T>(
  db: AgentCodeReader,
  organizationId: string,
  typed: string | null,
  // `=> T`, awaited below, rather than `=> Promise<T>`: a write through the
  // untyped client returns `any`, and matched against `Promise<T>` that makes
  // T `unknown` — the card would lose its type at every call.
  write: (code: string) => T,
): Promise<{ ok: true; value: Awaited<T>; code: string } | { ok: false; code: string }> {
  for (let attempt = 1; ; attempt += 1) {
    const code = typed ?? (await nextMtmAgentCodeFor(db, organizationId))
    try {
      return { ok: true, value: await write(code), code }
    } catch (error) {
      if (!isMtmAgentCodeConflict(error)) throw error
      if (typed || attempt >= MAX_ATTEMPTS) return { ok: false, code }
    }
  }
}

export function mtmAgentCodeTakenResponse(code: string): NextResponse {
  return NextResponse.json(
    { error: `Another agent already has the code ${code}`, code: "MTM_AGENT_CODE_TAKEN" },
    { status: 409 },
  )
}
