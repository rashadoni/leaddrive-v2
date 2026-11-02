import { createHash, randomBytes, randomInt } from "node:crypto"
import { z } from "zod"
import { attendanceDistanceMeters } from "@/lib/mtm/attendance-location-contract"

/**
 * Pairing a branch screen: an administrator gets a one-time code, types it on
 * the tablet at the branch, and the tablet gets a secret it keeps in an
 * httpOnly cookie. Only SHA-256 digests of both are stored: the code is a short
 * human string (rate-limited, ten minutes), the secret 256 random bits.
 */

// No 0/O, 1/I/L: the code is read off one screen and typed into another.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
export const BRANCH_SCREEN_CODE_LENGTH = 8
export const BRANCH_SCREEN_CODE_LIFETIME_MS = 10 * 60_000
export const BRANCH_SCREEN_COOKIE = "ld_branch_screen"
export const BRANCH_SCREEN_COOKIE_PATH = "/api/v1/public/attendance-screen"
// Browsers cap a cookie's life at 400 days; a screen is re-paired after that.
export const BRANCH_SCREEN_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

const digest = (value: string) => createHash("sha256").update(value).digest("hex")

/** Shown as `XXXX-XXXX`. */
export function generateBranchScreenCode(): { code: string; codeHash: string } {
  let code = ""
  for (let index = 0; index < BRANCH_SCREEN_CODE_LENGTH; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return { code: `${code.slice(0, 4)}-${code.slice(4)}`, codeHash: hashBranchScreenCode(code)! }
}

/** Whatever was typed — lower case, spaces, the dash — or null when it cannot be a code. */
export function normalizeBranchScreenCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 32) return null
  const code = raw.toUpperCase().replace(/[\s-]/g, "")
  if (code.length !== BRANCH_SCREEN_CODE_LENGTH || [...code].some(char => !CODE_ALPHABET.includes(char))) return null
  return code
}

export function hashBranchScreenCode(raw: unknown): string | null {
  const code = normalizeBranchScreenCode(raw)
  return code ? digest(`mtm-branch-screen-code:v1:${code}`) : null
}

export function generateBranchScreenSecret(): { secret: string; secretHash: string } {
  const secret = `mtms1.${randomBytes(32).toString("base64url")}`
  return { secret, secretHash: hashBranchScreenSecret(secret)! }
}

export function hashBranchScreenSecret(secret: unknown): string | null {
  if (typeof secret !== "string" || !/^mtms1\.[A-Za-z0-9_-]{43}$/.test(secret)) return null
  return digest(`mtm-branch-screen-secret:v1:${secret}`)
}

/**
 * The screen's own place (owner, 2026-10-30: a laptop paired at home showed
 * the branch's code at home). Each request for a code carries the browser's
 * latest fix; a code is issued only to a screen at its branch. The rule is the
 * phone's: no wider than 100 m of accuracy, and the accuracy circle must reach
 * the branch circle. A screen that cannot tell where it is shows no code.
 */
export const BRANCH_SCREEN_MAX_ACCURACY_METERS = 100
// The kiosk keeps watching the position; a fix older than this is not "now".
export const BRANCH_SCREEN_MAX_FIX_AGE_MS = 2 * 60_000
export type BranchScreenFix = { latitude: number; longitude: number; accuracy: number; ageMs: number }
export type BranchScreenPlace = { state: "AT_BRANCH" | "AWAY" | "NO_FIX"; distanceMeters: number | null }

const fixSchema = z.object({
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(100000), ageMs: z.number().finite().min(0).max(24 * 60 * 60_000),
}).strict()

/** The request body's `fix`, or null when there is none or it is malformed. */
export function parseBranchScreenFix(body: unknown): BranchScreenFix | null {
  const raw = body && typeof body === "object" ? (body as { fix?: unknown }).fix : undefined
  const parsed = fixSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function evaluateBranchScreenPlace(fix: BranchScreenFix | null, branch: { latitude: number; longitude: number; radiusMeters: number }): BranchScreenPlace {
  if (!fix || fix.ageMs > BRANCH_SCREEN_MAX_FIX_AGE_MS) return { state: "NO_FIX", distanceMeters: null }
  const distance = attendanceDistanceMeters(fix, branch)
  // Far beyond any accuracy: say so, the administrator sees where the screen went.
  if (distance - fix.accuracy > branch.radiusMeters) return { state: "AWAY", distanceMeters: Math.round(distance) }
  if (fix.accuracy > BRANCH_SCREEN_MAX_ACCURACY_METERS) return { state: "NO_FIX", distanceMeters: null }
  return { state: "AT_BRANCH", distanceMeters: Math.round(distance) }
}
