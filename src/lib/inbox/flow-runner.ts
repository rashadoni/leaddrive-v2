// E1.1c — Conversation Automation Engine: the FLOW RUNNER.
//
// Walks a ConversationFlow graph for one conversation: trigger → action nodes (each
// dispatched to executeConversationAction) → branch on success/failure → end. Persists
// a ConversationFlowRun so the run is auditable.
//
// THE RUNNER IS THE ORG-TRUST BOUNDARY (architect E1.1a/b): it fetches the conversation
// snapshot org-scoped, so the create_ticket/notify/add_participant actions — which trust
// ctx.conversation.* without re-checking org — can never act on a cross-tenant conversation.
//
// Live only when Organization.features contains `conversationFlowEvents` (default OFF):
// inbound webhooks emit conversation_opened/message_inbound and the dispatcher selects
// matching active flows.
import { prisma } from "@/lib/prisma"
import {
  executeConversationAction,
  type ConversationAction,
  type ConversationActionContext,
  type ConversationSnapshot,
} from "@/lib/inbox/conversation-actions"

/** A node in the @xyflow graph the builder produces. */
export interface FlowNode {
  id: string
  type: "trigger" | "action" | "end"
  data?: { action?: ConversationAction }
}
export interface FlowEdge {
  source: string
  target: string
  /** "success" | "failure" for ordinary actions; custom handles such as "option:<id>" for menu branches. */
  sourceHandle?: string | null
}
export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface RunFlowParams {
  flow: { id: string; graph: unknown; organizationId: string }
  conversationId: string
  organizationId: string
  actorUserId?: string | null
  /** Loop backstop — a malformed cyclic graph can't run forever. */
  maxSteps?: number
}

export interface FlowRunResult {
  ok: boolean
  /** A terminal action outcome (notably deliveryUnknown) forbids any sibling
   *  flow or downstream auto-responder from attempting another customer send. */
  terminal?: boolean
  runId?: string
  status: "completed" | "failed" | "aborted"
  error?: string
  steps: { nodeId: string; action?: string; ok?: boolean; error?: string }[]
}

function parseGraph(graph: unknown): FlowGraph | null {
  if (!graph || typeof graph !== "object") return null
  const g = graph as Record<string, unknown>
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null
  return { nodes: g.nodes as FlowNode[], edges: g.edges as FlowEdge[] }
}

/** Pick the next node id from `from`: for an action node prefer the branch matching the
 *  result (success/failure handle), else the default (handle-less) edge. */
function nextNodeId(edges: FlowEdge[], from: string, branch?: string): string | null {
  if (branch) {
    const branched = edges.find((e) => e.source === from && e.sourceHandle === branch)
    if (branched) return branched.target
    // A `menu` action can return option:<id>. Visual graphs may wire those option handles
    // explicitly; the linear builder does not, so a matched option should still continue
    // through the ordinary success path instead of silently draining the run.
    if (branch.startsWith("option:")) {
      const success = edges.find((e) => e.source === from && e.sourceHandle === "success")
      if (success) return success.target
    }
  }
  const def = edges.find((e) => e.source === from && (e.sourceHandle == null || e.sourceHandle === ""))
  return def ? def.target : null
}

export async function runConversationFlow(params: RunFlowParams): Promise<FlowRunResult> {
  const { flow, conversationId, organizationId: orgId, actorUserId } = params
  const maxSteps = params.maxSteps ?? 50
  const steps: FlowRunResult["steps"] = []

  // 1. ORG-TRUST BOUNDARY — fetch the conversation org-scoped. A cross-tenant or missing
  //    id resolves to nothing here, so no action ever touches another org's conversation.
  const convo = await prisma.socialConversation.findFirst({
    where: { id: conversationId, organizationId: orgId },
    select: {
      id: true,
      contactId: true,
      contactName: true,
      platform: true,
      externalId: true,
      channelConfigId: true,
      lastMessage: true,
      status: true,
      assignedTo: true,
      metadata: true,
    },
  })
  if (!convo) return { ok: false, status: "aborted", error: "conversation_not_found", steps }

  const graph = parseGraph(flow.graph)
  if (!graph) return { ok: false, status: "aborted", error: "invalid_graph", steps }

  const trigger = graph.nodes.find((n) => n.type === "trigger")
  if (!trigger) return { ok: false, status: "aborted", error: "no_trigger", steps }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const snapshot: ConversationSnapshot = {
    id: convo.id,
    contactId: convo.contactId,
    contactName: convo.contactName,
    platform: convo.platform,
    externalId: convo.externalId,
    channelConfigId: convo.channelConfigId,
    lastMessage: convo.lastMessage,
    status: convo.status,
    assignedTo: convo.assignedTo,
    metadata: (convo.metadata as Record<string, unknown> | null) ?? null,
  }
  const ctx: ConversationActionContext = { organizationId: orgId, conversationId, conversation: snapshot, actorUserId }

  // 2. Open a run record (auditable).
  const run = await prisma.conversationFlowRun.create({
    data: { organizationId: orgId, flowId: flow.id, conversationId, status: "running", currentNodeId: trigger.id },
  })

  // 3. Walk: trigger → ... → end / natural drain. Loop-guarded. We DISTINGUISH a clean end
  //    (reached an `end` node, or simply ran out of outgoing edges) from a BROKEN graph (an
  //    edge pointing at a node that doesn't exist) — the latter is a failure, not a silent
  //    "completed" (architect E1.1c). graph is stored as free JSON (z.any), so a malformed
  //    builder export can really produce a dangling edge.
  let current: FlowNode | null = trigger
  let stepCount = 0
  let stop: "end" | "drained" | "broken_target" | "missing_action" | "terminal_failure" | "loop" = "drained"

  // Next node from `fromId`, flagging a dangling edge (target id present but node missing).
  const advance = (fromId: string, branch?: string): { next: FlowNode | null; broken: boolean } => {
    const nid = nextNodeId(graph.edges, fromId, branch)
    if (nid == null) return { next: null, broken: false } // no outgoing edge → natural drain
    const next = nodeById.get(nid) ?? null
    return { next, broken: next === null }
  }

  while (current && stepCount < maxSteps) {
    stepCount++
    if (current.type === "end") {
      stop = "end"
      break
    }
    if (current.type === "action") {
      const action = current.data?.action
      if (!action) {
        steps.push({ nodeId: current.id, error: "missing_action" })
        stop = "missing_action"
        current = null
        break
      }
      const result = await executeConversationAction(action, {
        ...ctx,
        deliveryOperationId: `${run.id}:${current.id}`,
      })
      steps.push({
        nodeId: current.id,
        action: action.type,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      })
      if (!result.ok && result.terminal) {
        stop = "terminal_failure"
        current = null
        break
      }
      const resultBranch = result.ok
        ? (typeof result.branch === "string" && result.branch.trim() ? result.branch.trim() : "success")
        : "failure"
      const { next, broken } = advance(current.id, resultBranch)
      if (broken) {
        stop = "broken_target"
        current = null
        break
      }
      current = next
    } else {
      // trigger (or any pass-through) — follow the default outgoing edge.
      const { next, broken } = advance(current.id)
      if (broken) {
        stop = "broken_target"
        current = null
        break
      }
      current = next
    }
  }
  // Backstop tripped ONLY when we exited the while-loop without a clean break — i.e. stop is
  // still the initial "drained" AND a node is still pending. A flow that reached `end` (or any
  // break) exactly on the maxSteps-th step already set stop and must NOT be re-flagged as loop.
  if (stop === "drained" && current && stepCount >= maxSteps) stop = "loop"

  // Only a clean end ("end" node) or a natural "drained" run is a success; a broken edge,
  // a node missing its action, or a loop backstop are all failures.
  const status: FlowRunResult["status"] = stop === "end" || stop === "drained" ? "completed" : "failed"

  await prisma.conversationFlowRun.update({
    where: { id: run.id },
    data: { status, currentNodeId: current?.id ?? null, state: { steps, stop } as object },
  })

  return {
    ok: status === "completed",
    runId: run.id,
    status,
    error: status === "failed" ? stop : undefined,
    terminal: stop === "terminal_failure" || undefined,
    steps,
  }
}
