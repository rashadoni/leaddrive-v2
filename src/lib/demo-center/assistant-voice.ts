import { timingSafeEqual } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { hmacToken } from "@/lib/secure-token"
import { checkVoiceBudget, DEMO_ASSISTANT_VOICE_LIMITS, type DemoVoiceBudgetRefusal, type DemoVoiceLimits } from "./assistant/voice-policy"

/**
 * The guide's voice budget, kept where no restart and no second process can
 * reset it: the demo's own access trail.
 *
 * Every paid voice call — an answer spoken, a question heard — is CLAIMED
 * before Google is asked: one row in `demo_access_events` carrying the seconds
 * it may cost. Claims are decided one at a time for all demos together, under
 * one advisory lock, against both ceilings (the person's twenty minutes,
 * every demo's 300 a day), so requests arriving together — from one demo, or
 * from two demos of the same person — cannot each see the same room and all
 * go out. Only then is Google called, outside the lock. A spoken
 * answer's claim is an estimate; once the audio is there the row records its
 * real length instead, lower or higher, because that is what Google billed and
 * what the next claim must see. A failed call keeps its claim, because Google
 * may have billed it.
 *
 * The rows hold seconds and an outcome, nothing else: never the question, the
 * answer, or the audio.
 *
 * The person is the address the demo was requested from
 * (`DemoRequest.emailNormalized`, voice-policy.ts): their spend is the sum
 * over every grant of every request from it, read inside the lock, so a
 * claim from one of their demos sees what the others just claimed.
 *
 * `demo_access_events`, `demo_grants` and `demo_requests` are under FORCE RLS
 * behind the system bypass. A sum taken outside `runWithRlsBypass` reads no
 * rows and would mean «nothing spent» — `demo-assistant-voice-postgres.test.ts`
 * runs this against a role that cannot bypass RLS to show it.
 */

const VOICED = "ASSISTANT_VOICED"
const HEARD = "ASSISTANT_HEARD"
const VOICE_LOCK = "demo-assistant-voice"
const ANSWER_HASH_PURPOSE = "demo-assistant-answer"
const DAY_MS = 24 * 60 * 60_000

/**
 * A keyed hash over the grant, the answer's id and its exact text. The
 * assistant route hands it out with a Da Vinci answer; the voice route speaks
 * a text only when the hash matches, so the browser cannot have anything else
 * read aloud in the guide's voice.
 */
export function demoAnswerHash(grantId: string, answerId: string, text: string): string {
  return hmacToken(`${grantId}\n${answerId}\n${text.normalize("NFC")}`, ANSWER_HASH_PURPOSE)
}

export function demoAnswerHashMatches(grantId: string, answerId: string, text: string, hash: unknown): boolean {
  if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) return false
  const expected = Buffer.from(demoAnswerHash(grantId, answerId, text), "hex")
  const actual = Buffer.from(hash, "hex")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** The one row an answer's voicing may ever have: a second claim for it meets this key. */
export function demoVoicedEventId(answerId: string): string {
  return `voiced_${answerId}`
}

export type DemoVoiceKind = "speak" | "hear"

export type DemoVoiceClaim =
  | { ok: true; eventId: string; seconds: number }
  | { ok: false; refusal: "already_voiced" }
  | DemoVoiceBudgetRefusal

function secondsOf(metadata: unknown): number {
  const value = (metadata as { seconds?: unknown } | null)?.seconds
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Claims `seconds` for one voice call of `grantId`'s demo, or says which
 * ceiling it would cross: its person's or the day's. `answerId` is required
 * to speak: an answer is spoken at most once.
 */
export async function claimDemoVoiceSeconds(params: {
  grantId: string
  kind: DemoVoiceKind
  seconds: number
  answerId?: string
  stepId?: string | null
  now?: Date
  limits?: DemoVoiceLimits
}): Promise<DemoVoiceClaim> {
  const now = params.now ?? new Date()
  const since = new Date(now.getTime() - DAY_MS)
  const seconds = Math.max(1, Math.ceil(params.seconds))
  if (params.kind === "speak" && !params.answerId) throw new Error("claimDemoVoiceSeconds: speaking needs the answer's id")
  return runWithRlsBypass(() =>
    prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Void result: $executeRaw, never $queryRaw (advisory-lock-uses-execute-raw.test.ts).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${VOICE_LOCK}))`
      if (params.kind === "speak") {
        const already = await tx.demoAccessEvent.findUnique({ where: { id: demoVoicedEventId(params.answerId!) }, select: { id: true } })
        if (already) return { ok: false as const, refusal: "already_voiced" as const }
      }
      // Whose voice this is: every grant on a request from the same address.
      const grant = await tx.demoGrant.findUnique({ where: { id: params.grantId }, select: { request: { select: { emailNormalized: true } } } })
      if (!grant) throw new Error("claimDemoVoiceSeconds: no such grant")
      const personGrants = await tx.demoGrant.findMany({
        where: { request: { emailNormalized: grant.request.emailNormalized } },
        select: { id: true },
      })
      const person = new Set([params.grantId, ...personGrants.map((row) => row.id)])
      // Model queries, not raw SQL: Prisma binds the window as the column's
      // own UTC timestamp, where a raw Date would be shifted by the session's
      // time zone (Europe/Berlin on prod).
      const rows = await tx.demoAccessEvent.findMany({
        where: { eventType: { in: [VOICED, HEARD] }, OR: [{ grantId: { in: [...person] } }, { occurredAt: { gt: since } }] },
        select: { grantId: true, occurredAt: true, metadata: true },
      })
      let personSpent = 0
      let day = 0
      for (const row of rows) {
        const spent = secondsOf(row.metadata)
        if (person.has(row.grantId)) personSpent += spent
        if (row.occurredAt > since) day += spent
      }
      const budget = checkVoiceBudget({ person: personSpent, day }, seconds, params.limits ?? DEMO_ASSISTANT_VOICE_LIMITS)
      if (!budget.ok) return budget
      const metadata = { seconds, outcome: "claimed" }
      const created = await tx.demoAccessEvent.create({
        data: params.kind === "speak"
          ? { id: demoVoicedEventId(params.answerId!), grantId: params.grantId, eventType: VOICED, stepId: params.stepId ?? null, metadata, occurredAt: now }
          : { grantId: params.grantId, eventType: HEARD, stepId: params.stepId ?? null, metadata, occurredAt: now },
        select: { id: true },
      })
      return { ok: true as const, eventId: created.id, seconds }
    }, { maxWait: 10_000, timeout: 15_000 }),
  )
}

export type DemoVoiceOutcome = "voiced" | "heard" | "silent" | "failed"

/**
 * What became of a claim. A spoken answer records the audio's real length,
 * shorter or longer than claimed: shorter gives the rest back, longer is spend
 * Google billed all the same, and a ledger that left it out would let the
 * ceilings drift above twenty minutes a person. A failed call keeps its claim.
 */
export async function settleDemoVoiceSeconds(claim: { eventId: string; seconds: number }, outcome: DemoVoiceOutcome, usedSeconds?: number): Promise<void> {
  const seconds = usedSeconds === undefined || outcome === "failed"
    ? claim.seconds
    : Math.max(1, Math.ceil(usedSeconds))
  await runWithRlsBypass(() =>
    prisma.demoAccessEvent.update({ where: { id: claim.eventId }, data: { metadata: { seconds, outcome } } }),
  )
}
