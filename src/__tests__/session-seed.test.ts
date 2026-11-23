/**
 * Which documents carry the session, and which session is fit to be carried
 * (lib/session-seed.ts). The real root layout is run and asked what it hands
 * the session provider — the same way mtm-location-share-link-boundary.test.ts
 * asks it about the message catalog.
 */
import { readFileSync } from "node:fs"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const request = vi.hoisted(() => ({ pathname: null as string | null }))
const server = vi.hoisted(() => ({
  session: null as unknown,
  fails: false,
  reads: 0,
}))

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: (name: string) => (name === "x-request-pathname" ? request.pathname : null) })),
}))
vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "ru"),
  getMessages: vi.fn(async () => ({ auth: {}, portal: {} })),
  getTimeZone: vi.fn(async () => "Asia/Baku"),
}))
vi.mock("sonner", () => ({ Toaster: () => null }))
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => {
    server.reads++
    if (server.fails) throw new Error("database is away")
    return server.session
  }),
}))

import RootLayout from "@/app/layout"
import { Providers } from "@/components/providers"
import { documentCarriesSession, sessionWorthCarrying } from "@/lib/session-seed"

const SIGNED_IN = {
  expires: "2099-01-01T00:00:00.000Z",
  user: { id: "synthetic-user", organizationId: "synthetic-org", role: "manager" },
}

/** The `session` the root layout gives the provider for the document at `pathname`. */
async function handedTo(pathname: string | null): Promise<unknown> {
  request.pathname = pathname
  const found: unknown[] = []
  const look = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(look)
    if (!node || typeof node !== "object") return
    const element = node as ReactElement<{ session?: unknown; children?: unknown }>
    if (!element.props) return
    if (element.type === Providers) found.push(element.props.session)
    look(element.props.children)
  }
  look(await RootLayout({ children: null }))
  expect(found, "one session provider").toHaveLength(1)
  return found[0]
}

beforeEach(() => {
  request.pathname = null
  server.session = SIGNED_IN
  server.fails = false
  server.reads = 0
})

describe("what the root layout hands the session provider", () => {
  it.each(["/dashboard", "/inbox", "/deals/synthetic-id", "/", "/mtm/routes", "/settings/users"])(
    "the signed-in person, for the CRM page %s",
    async (pathname) => {
      expect(await handedTo(pathname)).toEqual(SIGNED_IN)
      expect(server.reads).toBe(1)
    },
  )

  it.each(["/login", "/login/", "/login/verify-2fa", "/login/setup-2fa", "/forgot-password", "/reset-password", "/portal", "/portal/login", "/portal/tickets"])(
    "nothing for %s, and the session is not even read",
    async (pathname) => {
      expect(await handedTo(pathname)).toBeNull()
      expect(server.reads).toBe(0)
    },
  )

  it("nothing when nobody is signed in — the provider asks for itself", async () => {
    server.session = null
    expect(await handedTo("/dashboard")).toBeNull()
  })

  it("nothing when the read fails: a page must open with the database away", async () => {
    server.fails = true
    expect(await handedTo("/dashboard")).toBeNull()
  })

  it.each([
    ["a second factor still owed", { needs2fa: true }],
    ["a second factor still to be set up", { needsSetup2fa: true }],
  ])("nothing for a session with %s", async (_name, claim) => {
    server.session = { ...SIGNED_IN, user: { ...SIGNED_IN.user, ...claim } }
    expect(await handedTo("/dashboard")).toBeNull()
  })
})

describe("documentCarriesSession", () => {
  it("is false only for the sign-in pages and the portal", () => {
    expect(documentCarriesSession("/login")).toBe(false)
    expect(documentCarriesSession("/portal/login")).toBe(false)
    // A CRM page whose name merely starts the same way is a CRM page.
    expect(documentCarriesSession("/login-history")).toBe(true)
    expect(documentCarriesSession("/portal-users")).toBe(true)
    expect(documentCarriesSession(null)).toBe(true)
  })
})

describe("sessionWorthCarrying", () => {
  it("wants a person and their organization", () => {
    expect(sessionWorthCarrying(null)).toBeNull()
    expect(sessionWorthCarrying({ expires: "x", user: {} } as never)).toBeNull()
    expect(sessionWorthCarrying({ expires: "x", user: { id: "u" } } as never)).toBeNull()
    expect(sessionWorthCarrying(SIGNED_IN as never)).toBe(SIGNED_IN)
  })
})

describe("the provider", () => {
  it("is never told «nobody» by a missing session: null becomes undefined", () => {
    const source = readFileSync("src/components/providers.tsx", "utf8")
    expect(source).toContain("const seeded = session ?? undefined")
    expect(source).toContain("<SessionProvider session={seeded}")
  })
})
