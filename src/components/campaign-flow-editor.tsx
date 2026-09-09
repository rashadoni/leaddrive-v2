"use client"

import { useCallback, useState, useRef, useMemo } from "react"
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
  Panel,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Users, Mail, Clock, GitBranch, Split, Plus, Save, Trash2, Play,
  MessageSquare, Filter, MousePointerClick, CheckCircle2
} from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

/* ───── types ───── */
export type FlowNodeType = "audience" | "email" | "sms" | "wait" | "condition" | "split" | "action"

export interface FlowNodeData {
  label: string
  type: FlowNodeType
  config?: Record<string, any>
  status?: "pending" | "active" | "completed" | "error"
  [key: string]: unknown
}

const NODE_DEFS: { type: FlowNodeType; label: string; icon: any; color: string; bg: string }[] = [
  { type: "audience", label: "Audience", icon: Users, color: "text-blue-600", bg: "bg-blue-50 border-blue-300" },
  { type: "email", label: "Send Email", icon: Mail, color: "text-green-600", bg: "bg-green-50 border-green-300" },
  { type: "sms", label: "Send SMS", icon: MessageSquare, color: "text-violet-600", bg: "bg-violet-50 border-violet-300" },
  { type: "wait", label: "Wait", icon: Clock, color: "text-amber-600", bg: "bg-amber-50 border-amber-300" },
  { type: "condition", label: "Condition", icon: GitBranch, color: "text-orange-600", bg: "bg-orange-50 border-orange-300" },
  { type: "split", label: "A/B Split", icon: Split, color: "text-pink-600", bg: "bg-pink-50 border-pink-300" },
  { type: "action", label: "Action", icon: MousePointerClick, color: "text-teal-600", bg: "bg-teal-50 border-teal-300" },
]

const STATUS_RING: Record<string, string> = {
  pending: "ring-border",
  active: "ring-blue-500 ring-2 animate-pulse",
  completed: "ring-green-500 ring-2",
  error: "ring-red-500 ring-2",
}

/* ───── custom node component ───── */
function FlowNode({ data, selected }: { data: FlowNodeData; selected?: boolean }) {
  const def = NODE_DEFS.find(d => d.type === data.type) || NODE_DEFS[0]
  const Icon = def.icon
  const status = data.status
  const isCondition = data.type === "condition" || data.type === "split"

  return (
    <div className={cn(
      "relative rounded-xl border-2 px-4 py-3 shadow-md min-w-[160px] transition-all",
      def.bg,
      selected && "ring-2 ring-primary",
      status && STATUS_RING[status],
    )}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-muted-foreground !border-white !border-2" />

      <div className="flex items-center gap-2">
        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center bg-card shadow-sm", def.color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground/80 truncate">{data.label}</p>
          <p className="text-[10px] text-muted-foreground capitalize">{data.type}</p>
        </div>
        {status === "completed" && <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />}
      </div>

      {data.config?.description && (
        <p className="text-[10px] text-muted-foreground mt-1.5 line-clamp-2">{data.config.description}</p>
      )}

      {isCondition ? (
        <>
          <Handle type="source" position={Position.Bottom} id="yes" className="!w-3 !h-3 !bg-green-500 !border-white !border-2" style={{ left: "30%" }} />
          <Handle type="source" position={Position.Bottom} id="no" className="!w-3 !h-3 !bg-red-500 !border-white !border-2" style={{ left: "70%" }} />
          <div className="flex justify-between px-2 mt-1">
            <span className="text-[9px] text-green-600 font-medium">Yes</span>
            <span className="text-[9px] text-red-600 font-medium">No</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-muted-foreground !border-white !border-2" />
      )}
    </div>
  )
}

const nodeTypes: NodeTypes = {
  flowNode: FlowNode as any,
}

/* ───── default flow (empty campaign) ───── */
const DEFAULT_NODES: Node[] = [
  {
    id: "audience-1",
    type: "flowNode",
    position: { x: 250, y: 50 },
    data: { label: "All Recipients", type: "audience", config: { description: "Campaign audience segment" } } as FlowNodeData,
  },
]

/* ───── editor props ───── */
interface CampaignFlowEditorProps {
  flowData?: { nodes: Node[]; edges: Edge[] } | null
  onSave?: (data: { nodes: Node[]; edges: Edge[] }) => Promise<void>
  readOnly?: boolean
}

export function CampaignFlowEditor({ flowData, onSave, readOnly = false }: CampaignFlowEditorProps) {
  const t = useTranslations("campaigns")
  const initialNodes = flowData?.nodes?.length ? flowData.nodes : DEFAULT_NODES
  const initialEdges = flowData?.edges || []

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [saving, setSaving] = useState(false)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const idCounter = useRef(nodes.length + 1)

  const onConnect = useCallback((connection: Connection) => {
    setEdges(eds => addEdge({
      ...connection,
      type: "smoothstep",
      animated: true,
      style: { stroke: "#94a3b8", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
    }, eds))
  }, [setEdges])

  const addNode = useCallback((type: FlowNodeType) => {
    const def = NODE_DEFS.find(d => d.type === type)!
    const id = `${type}-${++idCounter.current}`
    const newNode: Node = {
      id,
      type: "flowNode",
      position: { x: 200 + Math.random() * 200, y: 100 + nodes.length * 120 },
      data: { label: def.label, type, config: {} } as FlowNodeData,
    }
    setNodes(nds => [...nds, newNode])
  }, [nodes.length, setNodes])

  const deleteSelected = useCallback(() => {
    if (!selectedNode) return
    setNodes(nds => nds.filter(n => n.id !== selectedNode))
    setEdges(eds => eds.filter(e => e.source !== selectedNode && e.target !== selectedNode))
    setSelectedNode(null)
  }, [selectedNode, setNodes, setEdges])

  const handleSave = useCallback(async () => {
    if (!onSave) return
    setSaving(true)
    try {
      await onSave({ nodes, edges })
    } finally {
      setSaving(false)
    }
  }, [nodes, edges, onSave])

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node.id)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  return (
    <div className="flex flex-col h-[600px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b bg-muted/80 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground mr-2">{t("flowAdd")}:</span>
          {NODE_DEFS.map(def => {
            const Icon = def.icon
            return (
              <Button key={def.type} variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => addNode(def.type)}>
                <Icon className={cn("h-3 w-3", def.color)} />
                {def.label}
              </Button>
            )
          })}
          <div className="flex-1" />
          {selectedNode && (
            <Button variant="outline" size="sm" className="h-7 text-xs text-red-500 gap-1" onClick={deleteSelected}>
              <Trash2 className="h-3 w-3" /> {t("flowDelete")}
            </Button>
          )}
          <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSave} disabled={saving}>
            <Save className="h-3 w-3" /> {saving ? t("flowSaving") : t("flowSave")}
          </Button>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={readOnly ? undefined : onNodesChange}
          onEdgesChange={readOnly ? undefined : onEdgesChange}
          onConnect={readOnly ? undefined : onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly}
          defaultEdgeOptions={{
            type: "smoothstep",
            animated: true,
            style: { stroke: "#94a3b8", strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="#e2e8f0" />
          <Controls showInteractive={false} className="!bg-card !shadow-md !border !rounded-lg" />
          <MiniMap
            className="!bg-muted !border !rounded-lg !shadow-sm"
            maskColor="rgba(0,0,0,0.05)"
            nodeColor={(n: Node) => {
              const d = n.data as FlowNodeData
              const map: Record<string, string> = {
                audience: "#3b82f6", email: "#22c55e", sms: "#8b5cf6",
                wait: "#f59e0b", condition: "#f97316", split: "#ec4899", action: "#14b8a6",
              }
              return map[d.type] || "#94a3b8"
            }}
          />
          {readOnly && (
            <Panel position="top-right">
              <Badge variant="outline" className="bg-card shadow-sm text-xs">
                <Play className="h-3 w-3 mr-1" /> {t("flowPreviewMode")}
              </Badge>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </div>
  )
}
