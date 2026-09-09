/* eslint-disable @typescript-eslint/no-explicit-any */
import { handlers } from "@/lib/auth"

/**
 * `/api/auth/providers` is refused.
 *
 * Auth.js publishes it to anonymous callers, and it enumerates every configured
 * identity provider together with its sign-in and callback URLs — reported by a
 * penetration test as authentication metadata disclosure. Nothing in this
 * application reads it: `signIn` in `lib/auth-signin.ts` knows the
 * provider→endpoint mapping statically, precisely so this route can be closed.
 *
 * 404 rather than 403: the absence of a discovery endpoint is not itself a
 * secret worth confirming, and clients treat both the same. Every other Auth.js
 * route — csrf, session, signin, callback, signout — passes through untouched;
 * those carry the sign-in flow itself and cannot be removed.
 */
function isProviderDiscovery(url: string): boolean {
  const { pathname } = new URL(url)
  return pathname.replace(/\/+$/, "").endsWith("/api/auth/providers")
}

export async function GET(request: Request, context: any) {
  if (isProviderDiscovery(request.url)) {
    return new Response(null, { status: 404 })
  }
  return (handlers.GET as any)(request, context)
}

export const POST = handlers.POST as any
