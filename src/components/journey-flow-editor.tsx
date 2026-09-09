"use client"

import { useCallback, useState, useRef } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Button } from "@/components/ui/button"
import {
  Mail, Clock, GitBranch, Plus, Save, Trash2,
  MessageSquare, Bell, CheckCircle2, Smartphone, UserPlus,
  Split, Target, Globe,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

/* ───── types ───── */
export type JourneyNodeType = "trigger" | "send_email" | "wait" | "condition" | "create_task" | "send_telegram" | "send_whatsapp" | "sms" | "ab_split" | "goal_check" | "webhook"

export interface JourneyNodeData {
  label: string
  type: JourneyNodeType
  config?: Record<string, any>
  [key: string]: unknown
}

const NODE_DEFS: { type: JourneyNodeType; label: string; icon: any; color: string; bg: string }[] = [
  { type: "trigger", label: "Trigger", icon: UserPlus, color: "text-purple-600", bg: "bg-purple-50 border-purple-300" },
  { type: "send_email", label: "Send Email", icon: Mail, color: "text-violet-600", bg: "bg-violet-50 border-violet-300" },
  { type: "wait", label: "Wait", icon: Clock, color: "text-amber-600", bg: "bg-amber-50 border-amber-300" },
  { type: "condition", label: "Condition", icon: GitBranch, color: "text-orange-600", bg: "bg-orange-50 border-orange-300" },
  { type: "create_task", label: "Create Task", icon: CheckCircle2, color: "text-teal-600", bg: "bg-teal-50 border-teal-300" },
  { type: "send_telegram", label: "Telegram", icon: MessageSquare, color: "text-sky-600", bg: "bg-sky-50 border-sky-300" },
  { type: "send_whatsapp", label: "WhatsApp", icon: Smartphone, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-300" },
  { type: "sms", label: "SMS", icon: Bell, color: "text-violet-600", bg: "bg-violet-50 border-violet-300" },
  { type: "ab_split", label: "A/B Split", icon: Split, color: "text-orange-600", bg: "bg-orange-50 border-orange-300" },
  { type: "goal_check", label: "Goal Check", icon: Target, color: "text-purple-600", bg: "bg-purple-50 border-purple-300" },
  { type: "webhook", label: "Webhook", icon: Globe, color: "text-teal-600", bg: "bg-teal-50 border-teal-300" },
]

/* ───── custom node ───── */
// Creatio-style icon tiles: purple diamond trigger, purple square
// communication steps, orange circle wait. Flow runs left → right, so
// handles live on the node sides.
const COMM_TYPES = new Set<JourneyNodeType>(["send_email", "send_telegram", "send_whatsapp", "sms"])

function nodeTileClasses(type: JourneyNodeType): string {
  if (type === "trigger") return "rounded-md rotate-45 bg-gradient-to-br from-purple-500 to-fuchsia-600"
  if (type === "wait") return "rounded-full bg-gradient-to-br from-orange-400 to-amber-500"
  if (COMM_TYPES.has(type)) return "rounded-lg bg-gradient-to-br from-violet-500 to-purple-600"
  if (type === "condition" || type === "ab_split") return "rounded-lg bg-gradient-to-br from-orange-500 to-red-500"
  if (type === "goal_check") return "rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600"
  return "rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600"
}

function JourneyNode({ data, selected }: { data: JourneyNodeData; selected?: boolean }) {
  const def = NODE_DEFS.find(d => d.type === data.type) || NODE_DEFS[0]
  const Icon = def.icon
  const isCondition = data.type === "condition"
  const isTrigger = data.type === "trigger"
  const isAbSplit = data.type === "ab_split"
  const isGoalCheck = data.type === "goal_check"
  const isWebhook = data.type === "webhook"

  const splitCount = Math.min(Math.max(data.config?.splitCount ?? 2, 2), 4)

  return (
    <div className={cn(
      "relative flex flex-col items-center px-3 py-2.5 w-[132px] rounded-xl border bg-card/95 shadow-sm transition-all",
      selected ? "ring-2 ring-primary border-primary/40" : "border-zinc-200 dark:border-zinc-700",
      isGoalCheck && "border-dashed",
    )}>
      {!isTrigger && (
        <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-muted-foreground !border-white !border-2" />
      )}

      <div className={cn("h-10 w-10 flex items-center justify-center text-white shadow-sm mb-1.5", nodeTileClasses(data.type))}>
        <Icon className={cn("h-4.5 w-4.5", isTrigger && "-rotate-45")} />
      </div>
      <p className="text-[11px] font-semibold text-foreground/85 text-center leading-tight truncate w-full">{data.label}</p>

      {data.config?.subject && (
        <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1 w-full text-center">{data.config.subject}</p>
      )}
      {data.config?.days && (
        <p className="text-[9px] text-muted-foreground mt-0.5">{data.config.days}d</p>
      )}
      {isWebhook && data.config?.url && (
        <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1 font-mono w-full text-center">{data.config.url}</p>
      )}
      {isGoalCheck && data.config?.goalName && (
        <p className="text-[9px] text-purple-600 mt-0.5 font-medium line-clamp-1 w-full text-center">{data.config.goalName}</p>
      )}

      {isCondition || isGoalCheck ? (
        <>
          <Handle type="source" position={Position.Right} id="yes" className="!w-2.5 !h-2.5 !bg-green-500 !border-white !border-2" style={{ top: "32%" }} />
          <Handle type="source" position={Position.Right} id="no" className="!w-2.5 !h-2.5 !bg-red-500 !border-white !border-2" style={{ top: "72%" }} />
          <div className="flex justify-between w-full px-1 mt-1">
            <span className="text-[9px] text-green-600 font-medium">{isGoalCheck ? "Met" : "Yes"}</span>
            <span className="text-[9px] text-red-600 font-medium">{isGoalCheck ? "Not met" : "No"}</span>
          </div>
        </>
      ) : isAbSplit ? (
        <>
          {Array.from({ length: splitCount }, (_, i) => {
            const pct = ((i + 1) / (splitCount + 1)) * 100
            const colors = ["!bg-blue-500", "!bg-orange-500", "!bg-green-500", "!bg-pink-500"]
            return (
              <Handle
                key={`split-${i}`}
                type="source"
                position={Position.Right}
                id={`split-${i}`}
                className={cn("!w-2.5 !h-2.5 !border-white !border-2", colors[i])}
                style={{ top: `${pct}%` }}
              />
            )
          })}
          <div className="flex justify-around w-full px-1 mt-1">
            {Array.from({ length: splitCount }, (_, i) => {
              const labels = ["A", "B", "C", "D"]
              const pctValue = data.config?.splitPaths?.[i]?.percentage
              return (
                <span key={i} className="text-[9px] text-orange-600 font-medium">
                  {labels[i]}{pctValue ? ` ${pctValue}%` : ""}
                </span>
              )
            })}
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-muted-foreground !border-white !border-2" />
      )}
    </div>
  )
}

const nodeTypes: NodeTypes = {
  journeyNode: JourneyNode as any,
}

/* ───── helpers: convert steps ↔ nodes ───── */
const DEFAULT_EDGE_STYLE = { stroke: "#cbd5e1", strokeWidth: 1.5 }
const YES_EDGE_STYLE = { stroke: "#22c55e", strokeWidth: 1.5 }
const NO_EDGE_STYLE = { stroke: "#ef4444", strokeWidth: 1.5 }
const SPLIT_COLORS = ["#3b82f6", "#f97316", "#22c55e", "#ec4899"]

function makeEdge(id: string, source: string, target: string, opts?: { sourceHandle?: string; label?: string; style?: Record<string, any>; labelStyle?: Record<string, any> }): Edge {
  return {
    id,
    source,
    target,
    type: "smoothstep",
    animated: false,
    style: opts?.style ?? DEFAULT_EDGE_STYLE,
    markerEnd: { type: MarkerType.ArrowClosed, color: (opts?.style?.stroke as string) ?? "#cbd5e1" },
    ...(opts?.sourceHandle ? { sourceHandle: opts.sourceHandle } : {}),
    ...(opts?.label ? { label: opts.label, labelStyle: opts.labelStyle ?? { fontWeight: 600, fontSize: 10 } } : {}),
  }
}

export function stepsToFlow(steps: any[]): { nodes: Node[]; edges: Edge[] } {
  if (!steps?.length) {
    return {
      nodes: [{ id: "trigger-1", type: "journeyNode", position: { x: 40, y: 140 }, data: { label: "Entry Trigger", type: "trigger" } as JourneyNodeData }],
      edges: [],
    }
  }

  const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder)
  const stepMap = new Map<string, any>()
  sorted.forEach(s => stepMap.set(String(s.id), s))

  // Horizontal Creatio-style layout: trigger on the left, steps flow right.
  const nodes: Node[] = [
    { id: "trigger-1", type: "journeyNode", position: { x: 40, y: 140 }, data: { label: "Entry Trigger", type: "trigger" } as JourneyNodeData },
  ]
  const edges: Edge[] = []

  sorted.forEach((step, i) => {
    const nodeId = `step-${step.id || i}`
    nodes.push({
      id: nodeId,
      type: "journeyNode",
      position: { x: 240 + i * 185, y: 140 },
      data: {
        label: NODE_DEFS.find(d => d.type === step.stepType)?.label || step.stepType,
        type: step.stepType as JourneyNodeType,
        config: step.config || {},
      } as JourneyNodeData,
    })
  })

  // Check if steps use new ID-based linking
  const hasIdLinks = sorted.some(s => s.yesNextStepId || s.noNextStepId || s.splitPaths)

  if (hasIdLinks) {
    // First step connects from trigger
    if (sorted.length > 0) {
      const firstNodeId = `step-${sorted[0].id || 0}`
      edges.push(makeEdge(`e-trigger-1-${firstNodeId}`, "trigger-1", firstNodeId))
    }

    sorted.forEach((step, i) => {
      const nodeId = `step-${step.id || i}`
      const isBranching = step.stepType === "condition" || step.stepType === "goal_check"

      if (isBranching) {
        if (step.yesNextStepId) {
          const targetId = `step-${step.yesNextStepId}`
          edges.push(makeEdge(`e-${nodeId}-yes-${targetId}`, nodeId, targetId, {
            sourceHandle: "yes",
            label: step.stepType === "goal_check" ? "Met" : "Yes",
            style: YES_EDGE_STYLE,
            labelStyle: { fontWeight: 600, fontSize: 10, fill: "#22c55e" },
          }))
        }
        if (step.noNextStepId) {
          const targetId = `step-${step.noNextStepId}`
          edges.push(makeEdge(`e-${nodeId}-no-${targetId}`, nodeId, targetId, {
            sourceHandle: "no",
            label: step.stepType === "goal_check" ? "Not met" : "No",
            style: NO_EDGE_STYLE,
            labelStyle: { fontWeight: 600, fontSize: 10, fill: "#ef4444" },
          }))
        }
      } else if (step.stepType === "ab_split" && step.splitPaths?.length) {
        step.splitPaths.forEach((sp: any, si: number) => {
          if (sp.nextStepId) {
            const targetId = `step-${sp.nextStepId}`
            const labels = ["A", "B", "C", "D"]
            edges.push(makeEdge(`e-${nodeId}-split${si}-${targetId}`, nodeId, targetId, {
              sourceHandle: `split-${si}`,
              label: `${labels[si]}${sp.percentage ? ` ${sp.percentage}%` : ""}`,
              style: { stroke: SPLIT_COLORS[si], strokeWidth: 2 },
              labelStyle: { fontWeight: 600, fontSize: 10, fill: SPLIT_COLORS[si] },
            }))
          }
        })
      } else {
        // Regular node with yesNextStepId as single forward link
        if (step.yesNextStepId) {
          const targetId = `step-${step.yesNextStepId}`
          edges.push(makeEdge(`e-${nodeId}-${targetId}`, nodeId, targetId))
        }
      }
    })
  } else {
    // Backward-compat: chain nodes by stepOrder
    sorted.forEach((step, i) => {
      const nodeId = `step-${step.id || i}`
      const sourceId = i === 0 ? "trigger-1" : `step-${sorted[i - 1].id || (i - 1)}`
      edges.push(makeEdge(`e-${sourceId}-${nodeId}`, sourceId, nodeId))
    })
  }

  return { nodes, edges }
}

export function flowToSteps(nodes: Node[], edges: Edge[]): any[] {
  // Build outgoing edges map per node
  const outgoing: Record<string, Edge[]> = {}
  edges.forEach(e => {
    if (!outgoing[e.source]) outgoing[e.source] = []
    outgoing[e.source].push(e)
  })

  // BFS from trigger to compute stepOrder
  const bfsOrder: string[] = []
  const visited = new Set<string>()
  const queue = ["trigger-1"]
  visited.add("trigger-1")

  while (queue.length) {
    const curr = queue.shift()!
    if (curr !== "trigger-1") bfsOrder.push(curr)
    const outs = outgoing[curr] || []
    for (const e of outs) {
      if (!visited.has(e.target)) {
        visited.add(e.target)
        queue.push(e.target)
      }
    }
  }

  // Also pick up any orphan nodes not reached by BFS
  nodes.forEach(n => {
    if (n.id !== "trigger-1" && !visited.has(n.id)) {
      bfsOrder.push(n.id)
    }
  })

  // Extract step ID from node ID (step-{id} -> {id})
  function stepIdFromNodeId(nodeId: string): string {
    return nodeId.replace(/^step-/, "")
  }

  return bfsOrder
    .map((nodeId, i) => {
      const node = nodes.find(n => n.id === nodeId)
      if (!node) return null
      const data = node.data as JourneyNodeData
      const outs = outgoing[nodeId] || []
      const isBranching = data.type === "condition" || data.type === "goal_check"

      const step: Record<string, any> = {
        id: stepIdFromNodeId(nodeId),
        stepOrder: i + 1,
        stepType: data.type,
        config: data.config || {},
      }

      if (isBranching) {
        const yesEdge = outs.find(e => e.sourceHandle === "yes")
        const noEdge = outs.find(e => e.sourceHandle === "no")
        if (yesEdge) step.yesNextStepId = stepIdFromNodeId(yesEdge.target)
        if (noEdge) step.noNextStepId = stepIdFromNodeId(noEdge.target)
      } else if (data.type === "ab_split") {
        const splitEdges = outs
          .filter(e => e.sourceHandle?.startsWith("split-"))
          .sort((a, b) => (a.sourceHandle || "").localeCompare(b.sourceHandle || ""))
        if (splitEdges.length) {
          step.splitPaths = splitEdges.map((e, si) => ({
            nextStepId: stepIdFromNodeId(e.target),
            percentage: data.config?.splitPaths?.[si]?.percentage,
          }))
        }
      } else {
        // Regular node: single outgoing edge
        if (outs.length > 0) {
          step.yesNextStepId = stepIdFromNodeId(outs[0].target)
        }
      }

      return step
    })
    .filter(Boolean)
}

/* ───── editor ───── */
interface JourneyFlowEditorProps {
  steps?: any[]
  onSave?: (steps: any[]) => Promise<void>
}

export function JourneyFlowEditor({ steps, onSave }: JourneyFlowEditorProps) {
  const t = useTranslations("journeys")
  const initial = stepsToFlow(steps || [])
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [saving, setSaving] = useState(false)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const idCounter = useRef(nodes.length + 1)

  const onConnect = useCallback((connection: Connection) => {
    // Determine edge style based on source node type and handle
    const sourceNode = nodes.find(n => n.id === connection.source)
    const sourceData = sourceNode?.data as JourneyNodeData | undefined
    const isBranching = sourceData?.type === "condition" || sourceData?.type === "goal_check"
    const isAbSplit = sourceData?.type === "ab_split"
    const handle = connection.sourceHandle

    let style = DEFAULT_EDGE_STYLE
    let label: string | undefined
    let labelStyle: Record<string, any> | undefined

    if (isBranching && handle === "yes") {
      style = YES_EDGE_STYLE
      label = sourceData?.type === "goal_check" ? "Met" : "Yes"
      labelStyle = { fontWeight: 600, fontSize: 10, fill: "#22c55e" }
    } else if (isBranching && handle === "no") {
      style = NO_EDGE_STYLE
      label = sourceData?.type === "goal_check" ? "Not met" : "No"
      labelStyle = { fontWeight: 600, fontSize: 10, fill: "#ef4444" }
    } else if (isAbSplit && handle?.startsWith("split-")) {
      const idx = parseInt(handle.replace("split-", ""), 10)
      const labels = ["A", "B", "C", "D"]
      style = { stroke: SPLIT_COLORS[idx] || "#cbd5e1", strokeWidth: 1.5 }
      label = labels[idx]
      labelStyle = { fontWeight: 600, fontSize: 10, fill: SPLIT_COLORS[idx] || "#94a3b8" }
    }

    setEdges(eds => addEdge({
      ...connection,
      type: "smoothstep",
      animated: false,
      style,
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke as string },
      ...(label ? { label, labelStyle } : {}),
    }, eds))
  }, [setEdges, nodes])

  const addNode = useCallback((type: JourneyNodeType) => {
    const def = NODE_DEFS.find(d => d.type === type)!
    const id = `${type}-${++idCounter.current}`
    const newNode: Node = {
      id,
      type: "journeyNode",
      position: { x: 240 + (nodes.length - 1) * 185, y: 140 + Math.round(Math.random() * 60 - 30) },
      data: { label: def.label, type, config: {} } as JourneyNodeData,
    }
    setNodes(nds => [...nds, newNode])
  }, [nodes.length, setNodes])

  const deleteSelected = useCallback(() => {
    if (!selectedNode || selectedNode === "trigger-1") return
    setNodes(nds => nds.filter(n => n.id !== selectedNode))
    setEdges(eds => eds.filter(e => e.source !== selectedNode && e.target !== selectedNode))
    setSelectedNode(null)
  }, [selectedNode, setNodes, setEdges])

  const handleSave = useCallback(async () => {
    if (!onSave) return
    setSaving(true)
    try {
      const steps = flowToSteps(nodes, edges)
      await onSave(steps)
    } finally {
      setSaving(false)
    }
  }, [nodes, edges, onSave])

  return (
    <div className="flex flex-col h-[550px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b bg-muted/80 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground mr-2">{t("flowAddStep")}:</span>
        {NODE_DEFS.filter(d => d.type !== "trigger").map(def => {
          const Icon = def.icon
          return (
            <Button key={def.type} variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => addNode(def.type)}>
              <Icon className={cn("h-3 w-3", def.color)} />
              {def.label}
            </Button>
          )
        })}
        <div className="flex-1" />
        {selectedNode && selectedNode !== "trigger-1" && (
          <Button variant="outline" size="sm" className="h-7 text-xs text-red-500 gap-1" onClick={deleteSelected}>
            <Trash2 className="h-3 w-3" /> {t("flowDelete")}
          </Button>
        )}
        <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSave} disabled={saving}>
          <Save className="h-3 w-3" /> {saving ? "..." : t("flowSave")}
        </Button>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNode(node.id)}
          onPaneClick={() => setSelectedNode(null)}
          nodeTypes={nodeTypes}
          fitView
          defaultEdgeOptions={{
            type: "smoothstep",
            animated: false,
            style: { stroke: "#cbd5e1", strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#cbd5e1" },
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="#e2e8f0" />
          <Controls showInteractive={false} className="!bg-card !shadow-md !border !rounded-lg" />
          <MiniMap
            className="!bg-muted !border !rounded-lg !shadow-sm"
            maskColor="rgba(0,0,0,0.05)"
            nodeColor={(n: Node) => {
              const d = n.data as JourneyNodeData
              const map: Record<string, string> = {
                trigger: "#3b82f6", send_email: "#22c55e", wait: "#f59e0b",
                condition: "#f97316", create_task: "#14B8A6", send_telegram: "#0EA5E9",
                send_whatsapp: "#10b981", sms: "#8b5cf6",
                ab_split: "#f97316", goal_check: "#a855f7", webhook: "#14b8a6",
              }
              return map[d.type] || "#94a3b8"
            }}
          />
        </ReactFlow>
      </div>
    </div>
  )
}
