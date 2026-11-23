"use client"

import { useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react"
import { SessionContext, type SessionContextValue } from "next-auth/react"

/**
 * Sits between next-auth's provider and the app when the session came with the
 * page (lib/session-seed.ts). Two jobs, both about keeping everything else
 * exactly as it was.
 *
 * 1. The first paint does not change. With a session known from the first
 *    render, every `useSession()` in the tree would answer «authenticated»
 *    while the server renders the document — and a hundred pages that have only
 *    ever been rendered in a browser would be rendered on the server for the
 *    first time, `window` and `localStorage` included. So until the page has
 *    hydrated, the tree is told what it was always told at that moment:
 *    «loading». The instant hydration commits, it gets the session — with no
 *    request in between, which is the whole gain.
 *
 * 2. Tabs still learn that somebody else signed in. next-auth's provider used
 *    to announce every page load to every other tab, and each of them answered
 *    by fetching its session again: that is how a tab found out the browser now
 *    belongs to another person, and also why one page load cost a session
 *    request in every open CRM tab. A page that starts with its session makes
 *    no such request and no such announcement, so it says who it is on a
 *    channel of its own, and a tab re-reads its session only when the name it
 *    hears is not its own.
 */

export const SESSION_IDENTITY_CHANNEL = "leaddrive-session-identity"

type SessionLike = { user?: { id?: string | null; email?: string | null; organizationId?: string | null; role?: string | null } | null } | null | undefined

/** Who a session belongs to — the same three facts the shell resets a page on. Empty when nobody. */
export function sessionIdentityKey(session: SessionLike): string {
  const user = session?.user
  if (!user) return ""
  return `${user.organizationId ?? ""}:${user.id ?? user.email ?? ""}:${user.role ?? ""}`
}

const subscribeToNothing = () => () => {}

export function SessionSeedGate({ seeded, children }: { seeded: boolean; children: ReactNode }) {
  const live = useContext(SessionContext)
  // false on the server and during hydration, true from the commit after it —
  // and true at once in a tree that was never server-rendered.
  const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false)
  const held = seeded && !hydrated

  const value = useMemo(() => {
    if (!live || !held) return live
    // What next-auth's own provider reports before its first read lands.
    return { data: undefined, status: "loading", update: live.update } as unknown as SessionContextValue
  }, [live, held])

  const identity = live?.status === "loading" ? null : sessionIdentityKey(live?.data)
  const identityRef = useRef(identity)
  const updateRef = useRef(live?.update)
  useEffect(() => {
    identityRef.current = identity
    updateRef.current = live?.update
  }, [identity, live?.update])

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(SESSION_IDENTITY_CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      const theirs = typeof event.data === "string" ? event.data : ""
      const mine = identityRef.current
      // Mid-read: whatever is being read is already the newest answer.
      if (!theirs || mine === null || theirs === mine) return
      // The same refresh a page asks for after changing its own session: it
      // re-reads, and next-auth tells the remaining tabs to do likewise.
      void updateRef.current?.()
    }
    // A page that asked for its session has already been announced by next-auth.
    if (seeded && identityRef.current) channel.postMessage(identityRef.current)
    return () => channel.close()
  }, [seeded])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
