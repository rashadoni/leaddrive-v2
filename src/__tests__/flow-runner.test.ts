import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ConversationAction, ConversationActionType } from "@/lib/inbox/conversation-actions"

/**
 * E1.1c — Conversation flow runner: graph traversal, success/failure branching,
 * the org-trust boundary (conversation fetched org-scoped), and the loop backstop.
 */
type MockAction = ConversationAction
type MockConversation = {
  id: string
  contactId: string | null
  contactName: string
  platform: string
  externalId: string
  channelConfigId: string | null
  lastMessage: string
  status: string
  assignedTo: string | null
  metadata: Record<string, unknown> | null
}

const ctrl = vi.hoisted((): {
  fail: Set<ConversationActionType>
  terminal: Set<ConversationActionType>
  branch: Map<ConversationActionType, string>
} => ({
  fail: new Set<ConversationActionType>(),
  terminal: new Set<ConversationActionType>(),
  branch: new Map<ConversationActionType, string>(),
}))
const actionContexts = vi.hoisted(() => [] as Record<string, unknown>[])
const db = vi.hoisted((): {
  convo: MockConversation | null
  created: Record<string, unknown> | null
  updated: Record<string, unknown> | null
} => ({
  convo: {
    id: "c_1",
    contactId: "ct_1",
    contactName: "Anna",
    platform: "whatsapp",
    externalId: "+994501234567",
    channelConfigId: "ch_1",
    lastMessage: "hello",
    status: "open",
    assignedTo: null,
    metadata: {},
  },
  created: null,
  updated: null,
}))

vi.mock("@/lib/inbox/conversation-actions", () => ({
  executeConversationAction: vi.fn(async (action: MockAction, ctx: Record<string, unknown>) => {
    actionContexts.push(ctx)
    if (ctrl.terminal.has(action.type)) {
      return { ok: false, action: action.type, error: "delivery_unknown", terminal: true }
    }
    if (ctrl.fail.has(action.type)) return { ok: false, action: action.type, error: "boom" }
    const branch = ctrl.branch.get(action.type)
    return branch ? { ok: true, action: action.type, branch } : { ok: true, action: action.type }
  }),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: { findFirst: vi.fn(async () => db.convo) },
    conversationFlowRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.created = data
        return { id: "run_1" }
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.updated = data
        return {}
      }),
    },
  },
}))

import { runConversationFlow, type FlowGraph } from "@/lib/inbox/flow-runner"

const n = (id: string, type: "trigger" | "action" | "end", action?: MockAction) => ({ id, type, data: action ? { action } : undefined })
const e = (source: string, target: string, sourceHandle?: string) => ({ source, target, sourceHandle })
const run = (graph: FlowGraph) =>
  runConversationFlow({ flow: { id: "f_1", graph, organizationId: "org_1" }, conversationId: "c_1", organizationId: "org_1", actorUserId: "u_1" })

beforeEach(() => {
  ctrl.fail = new Set<ConversationActionType>()
  ctrl.terminal = new Set<ConversationActionType>()
  ctrl.branch = new Map<ConversationActionType, string>()
  actionContexts.length = 0
  db.convo = { id: "c_1", contactId: "ct_1", contactName: "Anna", platform: "whatsapp", externalId: "+994501234567", channelConfigId: "ch_1", lastMessage: "hello", status: "open", assignedTo: null, metadata: {} }
  db.created = null
  db.updated = null
  vi.clearAllMocks()
})

describe("linear flow", () => {
  it("runs trigger → assign → close → end (completed)", async () => {
    const graph: FlowGraph = {
      nodes: [n("t", "trigger"), n("a1", "action", { type: "assign", config: { assignTo: "u2" } }), n("a2", "action", { type: "close" }), n("end", "end")],
      edges: [e("t", "a1"), e("a1", "a2"), e("a2", "end")],
    }
    const r = await run(graph)
    expect(r.status).toBe("completed")
    expect(r.ok).toBe(true)
    expect(r.steps.map((s) => s.action)).toEqual(["assign", "close"])
    expect(actionContexts.map((ctx) => ctx.deliveryOperationId)).toEqual(["run_1:a1", "run_1:a2"])
  })
})

describe("branching", () => {
  it("takes the FAILURE edge when an action fails", async () => {
    ctrl.fail.add("assign")
    const graph: FlowGraph = {
      nodes: [n("t", "trigger"), n("a1", "action", { type: "assign" }), n("ok", "action", { type: "close" }), n("ko", "action", { type: "notify" })],
      edges: [e("t", "a1"), e("a1", "ok", "success"), e("a1", "ko", "failure")],
    }
    const r = await run(graph)
    expect(r.steps.map((s) => s.action)).toEqual(["assign", "notify"])
    expect(r.steps[0].ok).toBe(false)
  })
  it("takes the SUCCESS edge when an action succeeds", async () => {
    const graph: FlowGraph = {
      nodes: [n("t", "trigger"), n("a1", "action", { type: "assign" }), n("ok", "action", { type: "close" }), n("ko", "action", { type: "notify" })],
      edges: [e("t", "a1"), e("a1", "ok", "success"), e("a1", "ko", "failure")],
    }
    const r = await run(graph)
    expect(r.steps.map((s) => s.action)).toEqual(["assign", "close"])
  })
  it("stops on an unknown delivery instead of executing the failure branch", async () => {
    ctrl.terminal.add("send_reply")
    const graph: FlowGraph = {
      nodes: [
        n("t", "trigger"),
        n("send", "action", { type: "send_reply" }),
        n("retry", "action", { type: "send_reply" }),
      ],
      edges: [e("t", "send"), e("send", "retry", "failure")],
    }

    const r = await run(graph)

    expect(r.status).toBe("failed")
    expect(r.error).toBe("terminal_failure")
    expect(r.terminal).toBe(true)
    expect(r.steps.map((s) => s.action)).toEqual(["send_reply"])
  })
  it("takes a custom option edge when a menu action returns option:<id>", async () => {
    ctrl.branch.set("menu", "option:support")
    const graph: FlowGraph = {
      nodes: [
        n("t", "trigger"),
        n("menu", "action", { type: "menu" }),
        n("sales", "action", { type: "notify" }),
        n("support", "action", { type: "assign_to_queue" }),
      ],
      edges: [
        e("t", "menu"),
        e("menu", "sales", "option:sales"),
        e("menu", "support", "option:support"),
        e("menu", "sales", "success"),
      ],
    }

    const r = await run(graph)

    expect(r.steps.map((s) => s.action)).toEqual(["menu", "assign_to_queue"])
  })
  it("falls back to the success edge for a selected menu option in linear graphs", async () => {
    ctrl.branch.set("menu", "option:support")
    const graph: FlowGraph = {
      nodes: [
        n("t", "trigger"),
        n("menu", "action", { type: "menu" }),
        n("next", "action", { type: "send_reply" }),
      ],
      edges: [
        e("t", "menu"),
        e("menu", "next", "success"),
        e("menu", "t", "failure"),
      ],
    }

    const r = await run(graph)

    expect(r.steps.map((s) => s.action)).toEqual(["menu", "send_reply"])
  })
})

describe("dead-end semantics", () => {
  it("completes when an action naturally runs out of edges (no end node)", async () => {
    const graph: FlowGraph = {
      nodes: [n("t", "trigger"), n("a1", "action", { type: "assign" })],
      edges: [e("t", "a1")], // a1 has no outgoing edge → natural drain
    }
    const r = await run(graph)
    expect(r.status).toBe("completed")
    expect(r.steps.map((s) => s.action)).toEqual(["assign"])
  })
  it("FAILS on a dangling edge (target node missing) instead of reporting success", async () => {
    const graph: FlowGraph = {
      nodes: [n("t", "trigger"), n("a1", "action", { type: "assign" })],
      edges: [e("t", "a1"), e("a1", "ghost")], // edge points at a node that doesn't exist
    }
    const r = await run(graph)
    expect(r.status).toBe("failed")
    expect(r.error).toBe("broken_target")
  })
})

describe("org-trust boundary + validation", () => {
  it("aborts when the conversation is not in this org (findFirst → null)", async () => {
    db.convo = null
    const r = await run({ nodes: [n("t", "trigger")], edges: [] })
    expect(r).toMatchObject({ ok: false, status: "aborted", error: "conversation_not_found" })
  })
  it("aborts on an invalid graph", async () => {
    const r = await runConversationFlow({ flow: { id: "f", graph: null, organizationId: "org_1" }, conversationId: "c_1", organizationId: "org_1" })
    expect(r.error).toBe("invalid_graph")
  })
  it("aborts when there is no trigger node", async () => {
    const r = await run({ nodes: [n("a1", "action", { type: "close" })], edges: [] })
    expect(r.error).toBe("no_trigger")
  })
})

describe("loop backstop", () => {
  it("fails a cyclic graph instead of looping forever", async () => {
    const graph: FlowGraph = {
      nodes: [n("t", "trigger"), n("a1", "action", { type: "assign" })],
      edges: [e("t", "a1"), e("a1", "a1")], // self-loop on the default edge
    }
    const r = await runConversationFlow({ flow: { id: "f", graph, organizationId: "org_1" }, conversationId: "c_1", organizationId: "org_1", maxSteps: 5 })
    expect(r.status).toBe("failed")
    // 5 total iterations: the trigger consumes one (no step pushed), then 4 action executions.
    expect(r.steps.length).toBe(4)
    expect(r.steps.length).toBeLessThanOrEqual(5)
  })
  it("completes (NOT loop) when `end` is reached exactly on the last allowed step", async () => {
    const graph: FlowGraph = {
      nodes: [n("t", "trigger"), n("a1", "action", { type: "assign" }), n("end", "end")],
      edges: [e("t", "a1"), e("a1", "end")],
    }
    // 3 iterations: trigger, action, end — end hit exactly at maxSteps=3; must not be re-flagged "loop".
    const r = await runConversationFlow({ flow: { id: "f", graph, organizationId: "org_1" }, conversationId: "c_1", organizationId: "org_1", maxSteps: 3 })
    expect(r.status).toBe("completed")
  })
})

describe("run persistence", () => {
  it("opens a run (running) and closes it with the final status", async () => {
    await run({ nodes: [n("t", "trigger"), n("end", "end")], edges: [e("t", "end")] })
    expect(db.created).toMatchObject({ organizationId: "org_1", flowId: "f_1", conversationId: "c_1", status: "running" })
    expect(db.updated).toMatchObject({ status: "completed" })
  })
})
