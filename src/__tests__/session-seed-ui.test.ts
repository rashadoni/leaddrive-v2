// @vitest-environment jsdom
/**
 * A page that arrives with its session does not ask for it again.
 *
 * Measured on production 2026-11-23 in the owner's browser («очень долго
 * открывается срм»): every CRM page opened as a staircase — the document, then
 * `/api/auth/session` (0.55–1.8 s), and only after that answer did the page
 * mount and ask for its own data. The session was asked for twice per load
 * (next-auth's provider hears its own cross-tab announcement), and once more in
 * every other open CRM tab.
 *
 * The real `Providers` — next-auth's real `SessionProvider` under it — is
 * server-rendered and hydrated here over a counted network. Nothing of
 * next-auth is mocked: what is asserted is what reaches `fetch` and what a page
 * under the provider is told, in the order it is told it.
 */
import { act, createElement, useEffect, type ReactNode } from "react"
import { createRoot, hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { useSession } from "next-auth/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Providers } from "@/components/providers"
import { SESSION_IDENTITY_CHANNEL, sessionIdentityKey } from "@/components/session-seed-gate"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const person = (id: string, organizationId = "synthetic-org-a") => ({
  expires: "2099-01-01T00:00:00.000Z",
  iat: 1,
  user: { id, email: `${id}@example.invalid`, name: id, role: "manager", organizationId },
})

const ALICE = person("synthetic-alice")
const BORIS = person("synthetic-boris")

/** What `/api/auth/session` answers right now — the cookie's owner. */
let cookieOwner: ReturnType<typeof person> | null = ALICE
let sessionRequests = 0
let otherRequests: string[] = []

/** Every status a page under the provider was rendered with, and whose session it was. */
let seen: string[] = []
/** Every time the page's own data effect ran — what `useEffect([userId])` pages do. */
let dataLoads: string[] = []

function Page() {
  const { data, status } = useSession()
  const userId = data?.user?.id
  seen.push(`${status}:${userId ?? "-"}`)
  useEffect(() => {
    if (userId) dataLoads.push(userId)
  }, [userId])
  return createElement("p", { "data-testid": "who" }, `${status}:${userId ?? "-"}`)
}

const tree = (session: ReturnType<typeof person> | null | undefined, children: ReactNode = createElement(Page)) =>
  createElement(Providers, { session: session as never }, children)

const settle = async (ms = 30) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

let container: HTMLDivElement
let root: Root | null = null
const channels: BroadcastChannel[] = []

/** Another tab: a channel of its own on the same name. */
function otherTab(name: string): { heard: unknown[]; say: (message: unknown) => void } {
  const channel = new BroadcastChannel(name)
  channels.push(channel)
  const heard: unknown[] = []
  channel.onmessage = (event) => heard.push(event.data)
  return { heard, say: (message) => channel.postMessage(message) }
}

beforeEach(() => {
  cookieOwner = ALICE
  sessionRequests = 0
  otherRequests = []
  seen = []
  dataLoads = []
  container = document.createElement("div")
  document.body.appendChild(container)
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.includes("/api/auth/session")) {
      sessionRequests++
      // Auth.js answers the literal `null` when nobody is signed in.
      return new Response(JSON.stringify(cookieOwner), { status: 200, headers: { "content-type": "application/json" } })
    }
    otherRequests.push(url)
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  }))
})

afterEach(async () => {
  if (root) await act(async () => { root?.unmount() })
  root = null
  container.remove()
  channels.splice(0).forEach((channel) => channel.close())
  vi.unstubAllGlobals()
})

describe("a page that arrives with its session", () => {
  it("is rendered by the server exactly as before: still «loading», nobody's name in the HTML", () => {
    const html = renderToString(tree(ALICE))
    expect(html).toContain("loading:-")
    expect(html).not.toContain(ALICE.user.id)
    expect(seen).toEqual(["loading:-"])
  })

  it("knows who is signed in the moment it hydrates, without asking the server", async () => {
    container.innerHTML = renderToString(tree(ALICE))
    seen = []
    const hydrationErrors: unknown[] = []
    await act(async () => {
      root = hydrateRoot(container, tree(ALICE), { onRecoverableError: (error) => hydrationErrors.push(error) })
    })

    // Hydration matched the server's «loading», then the session was there —
    // inside the same act(), with no time for a request to have come back.
    expect(hydrationErrors).toEqual([])
    expect(seen[0]).toBe("loading:-")
    expect(seen.at(-1)).toBe(`authenticated:${ALICE.user.id}`)
    expect(container.querySelector("[data-testid=who]")?.textContent).toBe(`authenticated:${ALICE.user.id}`)
    expect(dataLoads).toEqual([ALICE.user.id])

    await settle()
    expect(sessionRequests, "no request for the session on load").toBe(0)
    expect(otherRequests).toEqual([])
    // And the page's data did not load a second time: nothing replaced the session.
    expect(dataLoads).toEqual([ALICE.user.id])
  })

  it("knows it at once in a tree that was never server-rendered", async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(tree(ALICE))
    })
    expect(seen).toEqual([`authenticated:${ALICE.user.id}`])
    await settle()
    expect(sessionRequests).toBe(0)
  })

  it("does not make the other tabs fetch their sessions: next-auth's channel stays silent", async () => {
    const nextAuthTab = otherTab("next-auth")
    container.innerHTML = renderToString(tree(ALICE))
    await act(async () => { root = hydrateRoot(container, tree(ALICE)) })
    await settle()
    expect(nextAuthTab.heard).toEqual([])
  })

  it("says who it is on its own channel, so a tab of somebody else can notice", async () => {
    const tab = otherTab(SESSION_IDENTITY_CHANNEL)
    container.innerHTML = renderToString(tree(ALICE))
    await act(async () => { root = hydrateRoot(container, tree(ALICE)) })
    await settle()
    expect(tab.heard).toEqual([sessionIdentityKey(ALICE)])
  })
})

describe("a tab that hears another tab's page load", () => {
  beforeEach(async () => {
    container.innerHTML = renderToString(tree(ALICE))
    await act(async () => { root = hydrateRoot(container, tree(ALICE)) })
    await settle()
    seen = []
  })

  it("does nothing when it is the same person — the reload storm this replaces", async () => {
    const tab = otherTab(SESSION_IDENTITY_CHANNEL)
    tab.say(sessionIdentityKey(ALICE))
    tab.say(sessionIdentityKey(ALICE))
    await settle()
    expect(sessionRequests).toBe(0)
    expect(seen).toEqual([])
  })

  it("re-reads its session when the browser now belongs to somebody else, and becomes that person", async () => {
    cookieOwner = BORIS
    const tab = otherTab(SESSION_IDENTITY_CHANNEL)
    tab.say(sessionIdentityKey(BORIS))
    await settle(60)
    expect(sessionRequests).toBeGreaterThanOrEqual(1)
    expect(container.querySelector("[data-testid=who]")?.textContent).toBe(`authenticated:${BORIS.user.id}`)
    expect(dataLoads).toEqual([ALICE.user.id, BORIS.user.id])

    // Once it is that person, the same name is no longer news.
    const before = sessionRequests
    tab.say(sessionIdentityKey(BORIS))
    await settle(60)
    expect(sessionRequests).toBe(before)
  })

  it("ignores anything that is not a name", async () => {
    const tab = otherTab(SESSION_IDENTITY_CHANNEL)
    tab.say("")
    tab.say({ event: "session" })
    tab.say(null)
    await settle()
    expect(sessionRequests).toBe(0)
  })
})

describe("a page that arrives without a session — a sign-in page, or the server could not read it", () => {
  it("asks for it itself, as it always did", async () => {
    const tab = otherTab(SESSION_IDENTITY_CHANNEL)
    const nextAuthTab = otherTab("next-auth")
    container.innerHTML = renderToString(tree(null))
    seen = []
    await act(async () => { root = hydrateRoot(container, tree(null)) })
    // Loading until the answer is back — and the answer had to be asked for.
    expect(seen[0]).toBe("loading:-")
    await settle(60)
    expect(sessionRequests).toBeGreaterThanOrEqual(1)
    expect(container.querySelector("[data-testid=who]")?.textContent).toBe(`authenticated:${ALICE.user.id}`)
    // next-auth announces such a load itself — which is also the proof that the
    // silence asserted above is the page's, not this test's deafness — and the
    // page adds nothing of its own.
    expect(nextAuthTab.heard.length).toBeGreaterThanOrEqual(1)
    expect(tab.heard).toEqual([])
  })

  it("reads «nobody» from the server's answer, never from the missing session", async () => {
    cookieOwner = null
    await act(async () => {
      root = createRoot(container)
      root.render(tree(undefined))
    })
    expect(seen[0]).toBe("loading:-")
    await settle(60)
    expect(sessionRequests).toBeGreaterThanOrEqual(1)
    expect(container.querySelector("[data-testid=who]")?.textContent).toBe("unauthenticated:-")
  })
})
