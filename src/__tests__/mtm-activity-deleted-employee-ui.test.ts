// @vitest-environment jsdom
/**
 * The MTM activity journal on the day an employee is removed.
 *
 * #677 made the removal leave a row at all. It read «Rashad Rahimov · Агент
 * удалён · Сотрудник»: who did it and that somebody was removed, but not whom.
 * The name was in the row the whole time — `oldData.name` — and nothing on the
 * screen looked there. The row cannot name him any other way: `agentId` is a
 * foreign key, cleared with the employee, and the same clearing reaches every
 * earlier row about him («Агент добавлен», «Агент изменён»).
 *
 * The page is rendered for real and its requests are answered by the real
 * activity route over rows shaped as the three writers in
 * `src/app/api/v1/mtm/agents` leave them. So what is checked is the line a
 * manager reads and the file «Экспорт» hands him, not a call to a helper.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
// The phone's token verifier reads the auth secret on import and refuses to
// load where there is a `window`. The journal is read with a browser session.
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const { default: messages } = await import("../../messages/ru.json")
  // One translator per namespace, as next-intl gives.
  const translators = new Map<string, unknown>()
  return {
    ...actual,
    useLocale: () => "ru",
    useTranslations: (namespace: string) => {
      if (!translators.has(namespace)) {
        translators.set(namespace, actual.createTranslator({ locale: "ru", messages: messages as never, namespace: namespace as never }))
      }
      return translators.get(namespace)
    },
  }
})
// A stable object: the page loads the journal when the session's organization appears.
const session = { data: { user: { organizationId: "org-1", role: "admin" } }, status: "authenticated" }
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

import MtmActivityPage from "@/app/(dashboard)/mtm/activity/page"
import { GET } from "@/app/api/v1/mtm/activity/route"
import { requireAuth } from "@/lib/api-auth"
import { resetMtmFieldScopeMemo } from "@/lib/mtm/field-access"
import { prisma } from "@/lib/prisma"
import messages from "../../messages/ru.json"

const t = messages.mtmActivity
const GONE = "agent-gone"
const DELETED_NAME = "Anar Məmmədov"
// What the card kept about him besides his name: the managers' notes. An
// administrator's journal carries them in the row; the line must not.
const NOTES = ["стажёр", "ночная смена", "teal", "pink"]

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000)
const row = (id: string, fields: Record<string, unknown>) => ({
  id,
  organizationId: "org-1",
  entity: "agent",
  actorUserId: "admin-user",
  oldData: null,
  newData: null,
  ...fields,
})

/** The journal of one employee's whole life in the system, newest first. */
const JOURNAL = [
  // DELETE /api/v1/mtm/agents/[id] after #677: no agentId, the card's «before».
  row("log-removed", {
    action: "AGENT_DELETE", metadataKind: "agent_delete", entityId: GONE, agentId: null, agent: null,
    oldData: { id: GONE, name: DELETED_NAME, email: "anar@example.com", role: "AGENT" },
    createdAt: at(1),
  }),
  // PUT …/agents/[id]: the «before» is the whole card, the «after» what was sent.
  // Written with his agentId; the foreign key has cleared it since.
  row("log-renamed", {
    action: "AGENT_UPDATE", metadataKind: "agent_update", entityId: GONE, agentId: null, agent: null,
    oldData: { id: GONE, name: "Anar Mamedov", email: "anar@example.com", role: "AGENT", status: "ACTIVE", tags: ["стажёр"], mapColor: "teal" },
    newData: { name: DELETED_NAME, tags: ["ночная смена"], mapColor: "pink" },
    createdAt: at(2),
  }),
  // The same save from a caller that sends only what changed: no name in the «after».
  row("log-blocked", {
    action: "AGENT_UPDATE", metadataKind: "agent_update", entityId: GONE, agentId: null, agent: null,
    oldData: { id: GONE, name: "Anar Mamedov", email: "anar@example.com", role: "AGENT", status: "ACTIVE", tags: ["стажёр"], mapColor: "teal" },
    newData: { status: "INACTIVE" },
    createdAt: at(3),
  }),
  // POST …/agents: only an «after».
  row("log-added", {
    action: "AGENT_CREATE", metadataKind: "agent_create", entityId: GONE, agentId: null, agent: null,
    newData: { name: "Anar Mamedov", email: "anar@example.com", role: "AGENT", canPlanOwnRoutes: true, canSelfPublishRoutes: false, tags: ["стажёр"], mapColor: "teal" },
    createdAt: at(4),
  }),
  // A removal whose snapshot is not there. Nothing to name him by.
  row("log-removed-nameless", {
    action: "AGENT_DELETE", metadataKind: "agent_delete", entityId: "agent-unknown", agentId: null, agent: null,
    createdAt: at(5),
  }),
  // And one whose snapshot has everything but a name: the notes are not a name.
  row("log-removed-notes-only", {
    action: "AGENT_DELETE", metadataKind: "agent_delete", entityId: "agent-unnamed", agentId: null, agent: null,
    oldData: { id: "agent-unnamed", name: "   ", role: "AGENT", tags: ["стажёр"], mapColor: "teal" },
    createdAt: at(6),
  }),
  // A living employee's row keeps its link — and now says whose card it was.
  row("log-living", {
    action: "AGENT_UPDATE", metadataKind: "agent_update", entityId: "agent-2", agentId: "agent-2",
    agent: { id: "agent-2", name: "Leyla Həsənova", avatar: null },
    oldData: { id: "agent-2", name: "Leyla Həsənova", role: "SUPERVISOR", status: "ACTIVE" },
    newData: { phone: "+994500000000" },
    createdAt: at(7),
  }),
]

let container: HTMLDivElement
let root: Root
let exported: Blob | null = null

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

/** Every journal row on the screen as its reader meets it. */
function screenRows() {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="mtm-activity-row"]')].map((element) => {
    const details = element.querySelector<HTMLElement>('[data-testid="mtm-activity-row-details"]')!
    return {
      action: element.querySelector("span[title]")!.getAttribute("title"),
      details: details.textContent,
      tooltip: details.getAttribute("title"),
      text: element.textContent ?? "",
    }
  })
}

function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

/** The file «Экспорт» produces, as rows of cells (header first). */
async function exportedCsv(): Promise<string[][]> {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === t.export)
  if (!button) throw new Error(`button «${t.export}» not found`)
  await act(async () => { button.click() })
  if (!exported) throw new Error("nothing was exported")
  const text = (await readText(exported)).replace(/^﻿/, "")
  return text.split("\n").map((line) => line.slice(1, -1).split('","'))
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetMtmFieldScopeMemo()
  exported = null
  // An administrator at a browser: the only reader of rows that name no agent,
  // and the one the route gives the labels and the map colour to.
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "admin-user", role: "admin", email: "r@example.com", name: "Rashad Rahimov", principalType: "session" } as never)
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({ plan: "starter", addons: [], features: ["mtm"], modules: { mtm: true } } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmAgent.findUnique).mockResolvedValue(null as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmAuditLog.count).mockResolvedValue(JOURNAL.length as never)
  vi.mocked(prisma.mtmAuditLog.findMany).mockResolvedValue(JOURNAL as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "admin-user", name: "Rashad Rahimov", email: "r@example.com" }] as never)

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith("/api/v1/mtm/activity?")) {
      return GET(new NextRequest(`http://localhost${url}`, { headers: init?.headers as HeadersInit }))
    }
    // The employee filter's list. He is not on it any more.
    if (url === "/api/v1/mtm/agents") return Response.json({ success: true, data: { agents: [{ id: "agent-2", name: "Leyla Həsənova" }] } })
    throw new Error(`unexpected request to ${url}`)
  })
  // jsdom has no object URLs and does not download; keep the file instead.
  URL.createObjectURL = vi.fn((blob: Blob) => { exported = blob; return "blob:activity" }) as never
  URL.revokeObjectURL = vi.fn() as never
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(MtmActivityPage)) })
  await settle()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("activity journal — rows about an employee who was removed", () => {
  it("names the removed employee in the row, with his id in the tooltip", () => {
    const [removed] = screenRows()

    expect(removed.action).toBe(t.action.AGENT_DELETE)
    expect(removed.details).toBe(DELETED_NAME)
    // Who removed him is still the row's first line; the id is still off it.
    expect(removed.text).toContain("Rashad Rahimov")
    expect(removed.text).not.toContain(GONE)
    expect(removed.tooltip).toBe(GONE)
  })

  it("names him in the rows written while he was there, by the name each change left", () => {
    const [, renamed, blocked, added, , , living] = screenRows()

    expect([renamed.action, renamed.details]).toEqual([t.action.AGENT_UPDATE, DELETED_NAME])
    // Nothing in the «after» about the name: it is the card's own, from «before».
    expect([blocked.action, blocked.details]).toEqual([t.action.AGENT_UPDATE, "Anar Mamedov"])
    expect([added.action, added.details]).toEqual([t.action.AGENT_CREATE, "Anar Mamedov"])
    expect([living.action, living.details]).toEqual([t.action.AGENT_UPDATE, "Leyla Həsənova"])
  })

  it("still says «Сотрудник» when the row kept no name", () => {
    const [, , , , nameless, notesOnly] = screenRows()

    expect(nameless.details).toBe(t.entity.agent)
    expect(nameless.tooltip).toBe("agent-unknown")
    expect(notesOnly.details).toBe(t.entity.agent)
  })

  it("shows the name and nothing else of the card — not its labels, not its map colour", async () => {
    // The administrator's answer does carry them: the route gave them to him.
    const answer = await (await GET(new NextRequest("http://localhost/api/v1/mtm/activity?period=7d"))).json()
    expect(JSON.stringify(answer.data.logs)).toContain("стажёр")

    const onScreen = container.textContent ?? ""
    const inFile = (await exportedCsv()).flat().join(" ")
    for (const note of NOTES) {
      expect(onScreen, `«${note}» on the screen`).not.toContain(note)
      expect(inFile, `«${note}» in the file`).not.toContain(note)
    }
  })

  it("puts the same words in the details column of the export", async () => {
    const [header, ...lines] = await exportedCsv()

    expect(header).toEqual([t.colTime, t.colAgent, t.colAction, t.colDetails])
    expect(lines.map((cells) => cells.slice(1))).toEqual([
      ["Rashad Rahimov", t.action.AGENT_DELETE, DELETED_NAME],
      ["Rashad Rahimov", t.action.AGENT_UPDATE, DELETED_NAME],
      ["Rashad Rahimov", t.action.AGENT_UPDATE, "Anar Mamedov"],
      ["Rashad Rahimov", t.action.AGENT_CREATE, "Anar Mamedov"],
      ["Rashad Rahimov", t.action.AGENT_DELETE, t.entity.agent],
      ["Rashad Rahimov", t.action.AGENT_DELETE, t.entity.agent],
      ["Rashad Rahimov", t.action.AGENT_UPDATE, "Leyla Həsənova"],
    ])
    // The export is the screen, line for line.
    expect(lines.map((cells) => cells[3])).toEqual(screenRows().map((shown) => shown.details))
  })
})
