// @vitest-environment jsdom
/**
 * Omni-channel numbers and pages an admin hides from one person (owner, 2026-11-11: «номера и
 * страницы» → «Давай»). The rule (lib/inbox/channel-access), the wrapper every route about one
 * conversation goes through, the guard that keeps a new such route from forgetting it, and the
 * ticks on the user card.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ hidden: [] as string[], conversations: {} as Record<string, string | null> }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id in db.conversations ? { channelConfigId: db.conversations[where.id] } : null) },
  },
}))

import { conversationAccessDenial, hiddenChannelIdsFor, visibleChannelWhere, withConversationChannelAccess } from "@/lib/inbox/channel-access"
import { UserChannelAccess } from "@/components/settings/user-channel-access"
import type { AuthResult } from "@/lib/api-auth"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The session carries the list, as api-auth builds it from the user row.
const person = (role: string, principalType: "session" | "api_key" = "session") =>
  ({ orgId: "org_1", userId: "u_1", role, principalType, email: "x@y", name: "X", hiddenChannelConfigIds: db.hidden }) as AuthResult

beforeEach(() => {
  db.hidden = ["wa-fanum", "fb-andro"]
  db.conversations = { "conv-fanum": "wa-fanum", "conv-main": "wa-main", "conv-email": null }
})

describe("who the rule narrows", () => {
  it("takes the person's hidden numbers and pages from their session", async () => {
    expect([...await hiddenChannelIdsFor(person("support"))]).toEqual(["wa-fanum", "fb-andro"])
  })

  it("never narrows an admin, a superadmin or an API key, whatever the list says", async () => {
    for (const auth of [person("admin"), person("superadmin"), person("sales", "api_key")]) {
      expect((await hiddenChannelIdsFor(auth)).size).toBe(0)
    }
  })

  it("a query keeps rows with no channel and drops only the hidden ones", () => {
    expect(visibleChannelWhere(new Set(["wa-fanum"]))).toEqual({ OR: [{ channelConfigId: null }, { channelConfigId: { notIn: ["wa-fanum"] } }] })
    expect(visibleChannelWhere(new Set())).toBeUndefined()
  })
})

describe("a route about one conversation", () => {
  const handler = vi.fn(async () => new Response("ok"))
  const call = (id: string, auth = person("support")) =>
    withConversationChannelAccess(handler)(new Request("http://x") as never, auth, { params: Promise.resolve({ id }) })

  beforeEach(() => handler.mockClear())

  it("answers «not found» for a conversation on a hidden number, without running the route", async () => {
    const res = await call("conv-fanum")
    expect(res.status).toBe(404)
    expect(handler).not.toHaveBeenCalled()
  })

  it("runs the route for a visible one, one without a channel, and an id that is not a conversation", async () => {
    for (const id of ["conv-main", "conv-email", "contact-123"]) expect((await call(id)).status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it("lets an admin through to every conversation", async () => {
    expect((await call("conv-fanum", person("admin"))).status).toBe(200)
  })

  it("the bare check says the same", async () => {
    expect((await conversationAccessDenial(person("sales"), "conv-fanum"))?.status).toBe(404)
    expect(await conversationAccessDenial(person("sales"), "conv-main")).toBeNull()
  })
})

describe("every route under /api/v1/inbox/conversations/[id] is wrapped", () => {
  const ROOT = join(process.cwd(), "src/app/api/v1/inbox/conversations/[id]")
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : name === "route.ts" ? [path] : []
  })

  it.each(files(ROOT).map((f) => [f.slice(ROOT.length) || "/"]))("%s", (rel) => {
    const path = join(ROOT, rel)
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true)
    const unwrapped: string[] = []
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(decl.name.text)) continue
        const init = decl.initializer
        const handler = init && ts.isCallExpression(init) ? init.arguments.find((a) => ts.isCallExpression(a) || ts.isArrowFunction(a)) : undefined
        const wrapped = handler && ts.isCallExpression(handler) && ts.isIdentifier(handler.expression) && handler.expression.text === "withConversationChannelAccess"
        if (!wrapped) unwrapped.push(decl.name.text)
      }
    }
    expect(unwrapped).toEqual([])
  })
})

describe("the ticks on the user card", () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const OPTIONS = [
    { id: "wa-main", channelType: "whatsapp", name: "LeadDrive WhatsApp", number: "+994 10 531 30 65", numberIsMetaId: false },
    { id: "wa-fanum", channelType: "whatsapp", name: "Fanum Sec", number: "+994 10 531 80 49", numberIsMetaId: false },
    { id: "fb-andro", channelType: "facebook", name: "Andrologiya.az", number: null, numberIsMetaId: false },
  ]

  function render(hidden: string[], onChange = vi.fn()) {
    act(() => root.render(createElement(UserChannelAccess, { options: OPTIONS, hidden, title: "T", hint: "H", onChange })))
    return onChange
  }
  const boxes = () => [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")]

  it("ticks every channel the person sees and leaves the hidden ones empty", () => {
    render(["wa-fanum"])
    expect(boxes().map((b) => b.checked)).toEqual([true, false, true])
    expect(container.textContent).toContain("+994 10 531 30 65")
    expect(container.textContent).toContain("Andrologiya.az")
  })

  it("unticking hides that channel, ticking shows it again", () => {
    const onChange = render([])
    act(() => { boxes()[2].click() })
    expect(onChange).toHaveBeenLastCalledWith(["fb-andro"])
    const again = render(["fb-andro"])
    act(() => { boxes()[2].click() })
    expect(again).toHaveBeenLastCalledWith([])
  })
})
