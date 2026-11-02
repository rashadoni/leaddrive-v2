// @vitest-environment jsdom
/**
 * The /inbox/ai-agent screen drawn from pure views
 * (src/components/settings/*-view.tsx), so the guided demo can show the
 * product's own screen with LeadDrive's own agent in it. These hold that the
 * views take everything through props, that the containers still load and
 * save for the tenant exactly as before, and that nothing the demo needs
 * (a field to mark, a button instead of a link) changes the product.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useLocale: () => "az",
  useTranslations: () => {
    const translate = (key: string) => key
    translate.has = () => false
    return translate
  },
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org_1" } }, status: "authenticated" }),
}))
vi.mock("next/link", () => ({
  default: (props: { href: string; className?: string; children?: unknown }) =>
    createElement("a", { href: props.href, className: props.className }, props.children as never),
}))
vi.mock("@/lib/client/organization-features", () => ({
  loadOrganizationFeatures: vi.fn(async () => ["aiAutoReply"]),
  updateOrganizationFeature: vi.fn(async () => ["aiAutoReply"]),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

import { InboxAgentEditor } from "@/components/settings/inbox-agent-editor"
import { INBOX_AGENT_MODELS, InboxAgentEditorView, type InboxAgent } from "@/components/settings/inbox-agent-editor-view"
import { ChannelReplyMatrixView, type ChannelReplyRow } from "@/components/settings/channel-reply-matrix-view"
import { AiAgentKnowledgeSourcesView, type AiAgentKnowledgeArticle } from "@/components/settings/ai-agent-page-view"
import { AiAgentKnowledgeSources } from "@/components/settings/ai-agent-knowledge-sources"
import { LEADDRIVE_AGENT_PROFILE } from "@/lib/demo-center/journey/leaddrive-agent-profile"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(element)
  })
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** Types into a controlled field the way a person does. */
function type(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

const AGENT: InboxAgent = {
  id: "cfg_1",
  systemPrompt: "# Rol\nSatış köməkçisi",
  knowledgeBase: "- LeadDrive CRM Bakıda hazırlanıb",
  replyLanguage: "",
  model: "claude-haiku-4-5-20251001",
  temperature: 0.7,
  escalationEnabled: true,
  greeting: "Salam!",
  autoLeadEnabled: false,
  autoAssignSales: true,
  autonomousBacklogEnabled: false,
  autonomousLookbackDays: 7,
  autonomousBatchSize: 20,
}

function viewProps(overrides: Record<string, unknown> = {}) {
  return {
    agent: AGENT,
    onAgentChange: vi.fn(),
    aiOn: true,
    onAiOnChange: vi.fn(),
    boards: [],
    qualificationBoardId: "",
    onQualificationBoardChange: vi.fn(),
    saving: false,
    savedTick: false,
    error: null,
    onSave: vi.fn(),
    importing: false,
    onExport: vi.fn(),
    onImport: vi.fn(),
    ...overrides,
  }
}

describe("the AI agent card as a view", () => {
  it("sends every edit out as a patch and keeps nothing of its own", async () => {
    const props = viewProps()
    await render(createElement(InboxAgentEditorView, props))
    const [prompt, knowledge] = [...container.querySelectorAll("textarea")]
    expect(prompt.value).toBe(AGENT.systemPrompt)
    expect(knowledge.value).toBe(AGENT.knowledgeBase)
    await act(async () => type(prompt, "Yeni prompt"))
    expect(props.onAgentChange).toHaveBeenCalledWith({ systemPrompt: "Yeni prompt" })
    const greeting = [...container.querySelectorAll("input")].find((input) => input.value === AGENT.greeting)!
    await act(async () => type(greeting, "Hello"))
    expect(props.onAgentChange).toHaveBeenCalledWith({ greeting: "Hello" })
  })

  it("is drawn as the product draws it: six and eight rows, no file input and no read-only fields of its own", async () => {
    await render(createElement(InboxAgentEditorView, viewProps()))
    const [prompt, knowledge] = [...container.querySelectorAll("textarea")]
    expect([prompt.rows, knowledge.rows]).toEqual([6, 8])
    expect(prompt.readOnly).toBe(false)
    expect(prompt.className).not.toContain("overflow-hidden")
    expect(container.querySelector('input[type="file"]')).toBeNull()
  })

  it("lets the demo show the fields without editing them, and mark the parts its guide points at", async () => {
    const decorate = (field: string, node: unknown) => createElement("div", { "data-field": field }, node as never)
    await render(createElement(InboxAgentEditorView, viewProps({ readOnly: true, fitContent: true, decorate })))
    for (const textarea of container.querySelectorAll("textarea")) {
      expect(textarea.readOnly).toBe(true)
      expect(textarea.className).toContain("overflow-hidden")
    }
    const marked = [...container.querySelectorAll("[data-field]")].map((node) => node.getAttribute("data-field"))
    expect(marked).toEqual(["master", "prompt", "knowledge", "settings", "greeting", "escalation", "autonomy", "actions"])
    // The model, reply language and temperature row is the one marked «settings».
    expect(container.querySelector('[data-field="settings"]')!.querySelectorAll("select")).toHaveLength(2)
  })

  it("offers the model the demo's agent really answers with", () => {
    expect(INBOX_AGENT_MODELS.map((model) => model.value)).toContain("claude-haiku-4-5-20251001")
    expect(LEADDRIVE_AGENT_PROFILE.greeting.length).toBeGreaterThan(0)
  })
})

describe("the AI agent card for a tenant", () => {
  it("still loads the inbox agent and saves it to its own config, with the file input right after Import", async () => {
    const calls: { url: string; method: string; body?: Record<string, unknown> }[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url === "/api/v1/ai-configs") {
        return new Response(JSON.stringify({ data: { configs: [{ ...AGENT, agentType: "inbox" }] } }))
      }
      if (url === "/api/v1/divisions") return new Response(JSON.stringify({ data: { divisions: [] } }))
      return new Response(JSON.stringify({ data: { id: "cfg_1" } }))
    }))
    await render(createElement(InboxAgentEditor))
    expect(container.querySelectorAll("textarea")[0].value).toBe(AGENT.systemPrompt)

    const importButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("importBtn"))!
    expect(importButton.nextElementSibling?.getAttribute("type")).toBe("file")

    const save = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("saveBtn"))!
    await act(async () => save.click())
    await render(createElement(InboxAgentEditor))
    const patch = calls.find((call) => call.method === "PATCH")!
    expect(patch.url).toBe("/api/v1/ai-configs/cfg_1")
    expect(patch.body).toMatchObject({ configName: "Inbox AI Agent", agentType: "inbox", systemPrompt: AGENT.systemPrompt })
  })
})

const row = (overrides: Partial<ChannelReplyRow> & { channelType: string }): ChannelReplyRow => ({
  id: overrides.channelType,
  configName: `${overrides.channelType} line`,
  isActive: true,
  reply: { mode: "agent", modeSource: "explicit" },
  ...overrides,
})

describe("the channel matrix as a view", () => {
  it("lets the demo point its guide at one mode of one channel", async () => {
    const onUiModeChange = vi.fn()
    await render(createElement(ChannelReplyMatrixView, {
      rows: [row({ channelType: "telegram" }), row({ channelType: "email" })],
      loading: false,
      savingId: null,
      onUiModeChange,
      onRolloutChange: vi.fn(),
      onThresholdChange: vi.fn(),
      targetFor: (target: ChannelReplyRow, mode: string) =>
        target.channelType === "telegram" && mode === "ai_draft" ? { "data-demo-target": "pick-draft" } : undefined,
    }))
    const targets = container.querySelectorAll('[data-demo-target="pick-draft"]')
    expect(targets).toHaveLength(1)
    expect(targets[0].textContent).toBe("aiModeDraft")
    await act(async () => (targets[0] as HTMLButtonElement).click())
    expect(onUiModeChange).toHaveBeenCalledWith(expect.objectContaining({ channelType: "telegram" }), "ai_draft")
  })

  it("shows a channel that does not honour the setting yet as disabled and «coming soon»; the Da Vinci note only for WhatsApp's default", async () => {
    await render(createElement(ChannelReplyMatrixView, {
      rows: [
        row({ channelType: "email" }),
        row({ channelType: "whatsapp", reply: { mode: "ai", modeSource: "whatsapp_default_ai" } }),
        row({ channelType: "telegram", reply: { mode: "ai", modeSource: "explicit" } }),
      ],
      loading: false,
      savingId: null,
      onUiModeChange: vi.fn(),
      onRolloutChange: vi.fn(),
      onThresholdChange: vi.fn(),
    }))
    expect(container.textContent!.match(/aiRoutingComingSoon/g)).toHaveLength(1)
    const emailButtons = [...container.querySelectorAll("button")].slice(0, 3)
    expect(emailButtons.every((button) => button.disabled)).toBe(true)
    expect(container.textContent!.match(/replyModeWhatsappDefaultHint/g)).toHaveLength(1)
  })
})

const ARTICLES: AiAgentKnowledgeArticle[] = Array.from({ length: 7 }, (_, index) => ({
  id: `kb_${index + 1}`,
  title: `Article ${index + 1}`,
  content: `Body ${index + 1}`,
  status: "published",
  updatedAt: "2026-10-18T00:00:00.000Z",
}))

describe("the knowledge sources card", () => {
  it("shows the first five and the total, as links in the product and as buttons in the demo", async () => {
    await render(createElement(AiAgentKnowledgeSourcesView, { articles: ARTICLES, total: 14, loading: false, error: null }))
    expect(container.textContent).toContain("14 aiAgentKnowledgePublished")
    expect(container.textContent).toContain("Article 5")
    expect(container.textContent).not.toContain("Article 6")
    expect(container.querySelectorAll('a[href^="/knowledge-base/"]')).toHaveLength(5)

    const onOpenArticle = vi.fn()
    await render(createElement(AiAgentKnowledgeSourcesView, { articles: ARTICLES, total: 14, loading: false, error: null, onOpenArticle, onManage: vi.fn() }))
    expect(container.querySelector("a")).toBeNull()
    await act(async () => (container.querySelector("button") as HTMLButtonElement).click())
    expect(onOpenArticle).toHaveBeenCalledWith(ARTICLES[0])
  })

  it("still reads the tenant's published articles for the product page", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { articles: ARTICLES.slice(0, 2), total: 2 } })))
    vi.stubGlobal("fetch", fetchMock)
    await render(createElement(AiAgentKnowledgeSources))
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/kb?status=published&limit=5", { cache: "no-store" })
    expect(container.textContent).toContain("2 aiAgentKnowledgePublished")
  })
})
