import { NextResponse } from "next/server"
import { BRANCH_SCREEN_COOKIE, BRANCH_SCREEN_COOKIE_MAX_AGE_SECONDS, BRANCH_SCREEN_COOKIE_PATH } from "@/lib/mtm/attendance-branch-screen-security"

// A code and a branch name: never kept by a browser cache or a proxy, never indexed.
export const SCREEN_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow",
}

export function screenJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...SCREEN_HEADERS, ...headers } })
}

export function screenRateLimited(retryAfterSeconds: number) {
  return screenJson({ success: false, state: "RATE_LIMITED", retryAfterSeconds }, 429, { "Retry-After": String(Math.max(1, retryAfterSeconds)) })
}

/** The secret lives only in this httpOnly cookie, sent only to the screen's own routes. */
export function setScreenCookie(response: NextResponse, secret: string) {
  response.cookies.set(BRANCH_SCREEN_COOKIE, secret, { httpOnly: true, secure: true, sameSite: "strict", path: BRANCH_SCREEN_COOKIE_PATH, maxAge: BRANCH_SCREEN_COOKIE_MAX_AGE_SECONDS })
  return response
}

export function clearScreenCookie(response: NextResponse) {
  response.cookies.set(BRANCH_SCREEN_COOKIE, "", { httpOnly: true, secure: true, sameSite: "strict", path: BRANCH_SCREEN_COOKIE_PATH, maxAge: 0 })
  return response
}
