import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { hmacToken } from "@/lib/secure-token"

/**
 * The demo request form's bot check: a proof of work the visitor's browser
 * solves while they type, signed by us, good for one request.
 *
 * Owner, 2026-10-18: «защита от спама нужна чтоб боты не заполняли формы».
 * Nothing for a person to click, and no third party: the form fetches a
 * challenge when it opens (`GET /api/v1/public/demo-requests/challenge`),
 * finds the number whose SHA-256 with the salt is the challenge — about
 * 50 000 hashes on average, a second or two of a phone's time spent while
 * the fields are being filled — and sends it with the request. Same scheme
 * as ALTCHA, written out here rather than added as a dependency.
 *
 * What a bot has to do to get one request in:
 *   - run the page's script or reimplement it — the generic form fillers
 *     that post every field they find do neither;
 *   - wait: a solution signed less than DEMO_FORM_MIN_FILL_MS ago is refused;
 *   - spend a new challenge on every request — a solved challenge stored with
 *     its request (`demo_requests."formChallengeSalt"`, unique) never opens a
 *     second one.
 * On top of this the address limiter (10 public POSTs a minute) and the one
 * link per address per day (auto-issue.ts) still apply, and the owner hears
 * only about confirmed addresses (email-confirmation.ts).
 */
export const DEMO_FORM_CHALLENGE_MAX_NUMBER = 100_000
export const DEMO_FORM_MIN_FILL_MS = 3_000
export const DEMO_FORM_CHALLENGE_TTL_MS = 2 * 60 * 60_000

const PURPOSE = "demo-form-challenge"

export interface DemoFormChallenge {
  salt: string
  issuedAt: number
  challenge: string
  maxNumber: number
  signature: string
}

export const demoFormSolutionSchema = z.object({
  salt: z.string().regex(/^[a-f0-9]{24}$/u),
  issuedAt: z.number().int().positive(),
  challenge: z.string().regex(/^[a-f0-9]{64}$/u),
  maxNumber: z.number().int().positive(),
  signature: z.string().regex(/^[a-f0-9]{64}$/u),
  number: z.number().int().min(0),
})

export type DemoFormSolution = z.infer<typeof demoFormSolutionSchema>

/**
 * `missing`/`expired` can happen to a person (the challenge did not load, the
 * tab sat open for hours): they are asked to send again. The rest only a
 * script produces, and get the honeypot's silent answer.
 */
export type DemoFormVerdict = "ok" | "missing" | "expired" | "forged" | "unsolved" | "too_fast"

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function sign(salt: string, issuedAt: number, challenge: string, maxNumber: number): string {
  return hmacToken(`${salt}.${issuedAt}.${challenge}.${maxNumber}`, PURPOSE)
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex")
  const right = Buffer.from(b, "hex")
  return left.length === right.length && timingSafeEqual(left, right)
}

export function issueDemoFormChallenge(now: number = Date.now()): DemoFormChallenge {
  const salt = randomBytes(12).toString("hex")
  const maxNumber = DEMO_FORM_CHALLENGE_MAX_NUMBER
  const challenge = sha256Hex(`${salt}${randomInt(0, maxNumber + 1)}`)
  return { salt, issuedAt: now, challenge, maxNumber, signature: sign(salt, now, challenge, maxNumber) }
}

export function verifyDemoFormSolution(input: unknown, now: number = Date.now()): DemoFormVerdict {
  if (input === undefined || input === null) return "missing"
  const parsed = demoFormSolutionSchema.safeParse(input)
  if (!parsed.success) return "forged"
  const { salt, issuedAt, challenge, maxNumber, signature, number } = parsed.data
  // The signature covers the difficulty too: a bot cannot lower it.
  if (!sameHex(signature, sign(salt, issuedAt, challenge, maxNumber))) return "forged"
  if (now - issuedAt > DEMO_FORM_CHALLENGE_TTL_MS) return "expired"
  if (now - issuedAt < DEMO_FORM_MIN_FILL_MS) return "too_fast"
  if (number > maxNumber || sha256Hex(`${salt}${number}`) !== challenge) return "unsolved"
  return "ok"
}
