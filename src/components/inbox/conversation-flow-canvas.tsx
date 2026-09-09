"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bot,
  CheckCircle2,
  GitBranch,
  MessageSquare,
  Send,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import {
  canvasToConversationGraph,
  conversationGraphToCanvas,
  type ConversationFlowCanvasEdge,
  type ConversationFlowCanvasNode,
  type ConversationFlowCanvasNodeData,
  type ConversationFlowEdgeTone,
  type ConversationFlowRuntimeGraph,
  type ConversationFlowVisualLabels,
} from "@/lib/inbox/conversation-flow-visual";
import { cn } from "@/lib/utils";

interface ConversationFlowPaletteAction {
  type: string;
  label: string;
  config?: Record<string, unknown>;
}

interface ConversationFlowCanvasEditorLabels {
  palette?: string;
  save?: string;
  saving?: string;
  reset?: string;
  delete?: string;
  dirty?: string;
  clean?: string;
  hint?: string;
}

interface ConversationFlowCanvasProps {
  graph: unknown;
  labels?: ConversationFlowVisualLabels;
  editable?: boolean;
  disabled?: boolean;
  paletteActions?: ConversationFlowPaletteAction[];
  editorLabels?: ConversationFlowCanvasEditorLabels;
  onSaveGraph?: (graph: ConversationFlowRuntimeGraph) => Promise<void> | void;
  className?: string;
}

type ConversationFlowReactNode = Node<ConversationFlowCanvasNodeData>;

const TONE_CLASSES: Record<ConversationFlowCanvasNodeData["kind"], string> = {
  trigger: "border-blue-300 bg-blue-50 text-blue-950",
  action: "border-violet-300 bg-violet-50 text-violet-950",
  end: "border-emerald-300 bg-emerald-50 text-emerald-950",
  unknown: "border-zinc-300 bg-zinc-50 text-zinc-950",
};

const EDGE_STYLES: Record<
  ConversationFlowEdgeTone,
  { stroke: string; strokeWidth: number }
> = {
  neutral: { stroke: "#94a3b8", strokeWidth: 2 },
  success: { stroke: "#22c55e", strokeWidth: 2 },
  failure: { stroke: "#ef4444", strokeWidth: 2 },
};

const DEFAULT_EDITOR_LABELS: Required<ConversationFlowCanvasEditorLabels> = {
  palette: "Add block",
  save: "Save path",
  saving: "Saving…",
  reset: "Reset",
  delete: "Delete selected",
  dirty: "Unsaved changes",
  clean: "Saved",
  hint: "Move blocks, reconnect branches, then save.",
};

function NodeIcon({
  kind,
  actionType,
}: {
  kind: ConversationFlowCanvasNodeData["kind"];
  actionType?: string;
}) {
  const className = "h-4 w-4";
  if (kind === "trigger") return <GitBranch className={className} />;
  if (kind === "end") return <CheckCircle2 className={className} />;

  switch (actionType) {
    case "assign_to_queue":
      return <Users className={className} />;
    case "send_reply":
      return <Send className={className} />;
    case "ai_reply":
      return <Sparkles className={className} />;
    case "handoff_agent":
      return <UserRound className={className} />;
    case "notify":
      return <MessageSquare className={className} />;
    default:
      return <Bot className={className} />;
  }
}

function minimapColor(data: ConversationFlowCanvasNodeData): string {
  if (data.kind === "trigger") return "#3b82f6";
  if (data.kind === "end") return "#22c55e";
  switch (data.actionType) {
    case "assign_to_queue":
      return "#8b5cf6";
    case "send_reply":
      return "#0ea5e9";
    case "ai_reply":
      return "#a855f7";
    case "handoff_agent":
      return "#f97316";
    case "notify":
      return "#14b8a6";
    default:
      return "#8b5cf6";
  }
}

function ConversationNode({
  data,
  selected,
}: NodeProps<ConversationFlowReactNode>) {
  const canReceive = data.kind !== "trigger";
  const canSend = data.kind !== "end";
  const showBranchHandles = data.kind === "action";

  return (
    <div
      className={cn(
        "relative min-w-[190px] rounded-xl border-2 px-4 py-3 shadow-sm transition",
        TONE_CLASSES[data.kind],
        selected && "ring-2 ring-primary ring-offset-2",
      )}
    >
      {canReceive && (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !border-2 !border-background !bg-muted-foreground"
        />
      )}

      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background/80 shadow-sm">
          <NodeIcon kind={data.kind} actionType={data.actionType} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{data.label}</p>
          <p className="mt-0.5 truncate text-[11px] opacity-70">
            {data.subtitle}
          </p>
          {data.configPreview && (
            <p className="mt-1.5 line-clamp-2 text-[11px] opacity-80">
              {data.configPreview}
            </p>
          )}
        </div>
      </div>

      {showBranchHandles ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="success"
            className="!h-3 !w-3 !border-2 !border-background !bg-emerald-500"
            style={{ left: "32%" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="failure"
            className="!h-3 !w-3 !border-2 !border-background !bg-red-500"
            style={{ left: "68%" }}
          />
          <div className="mt-2 flex justify-between px-3 text-[9px] font-semibold tracking-wide">
            <span className="text-emerald-600">
              {data.successLabel ?? "Success"}
            </span>
            <span className="text-red-600">
              {data.failureLabel ?? "Failure"}
            </span>
          </div>
        </>
      ) : (
        canSend && (
          <Handle
            type="source"
            position={Position.Bottom}
            className="!h-3 !w-3 !border-2 !border-background !bg-muted-foreground"
          />
        )
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  conversationNode: ConversationNode,
};

function edgeToneFromHandle(
  sourceHandle?: string | null,
): ConversationFlowEdgeTone {
  if (sourceHandle === "success") return "success";
  if (sourceHandle === "failure") return "failure";
  return "neutral";
}

function edgeLabelFromHandle(
  sourceHandle: string | null | undefined,
  labels: ConversationFlowVisualLabels | undefined,
): string | undefined {
  if (sourceHandle === "success") return labels?.success ?? "Success";
  if (sourceHandle === "failure") return labels?.failure ?? "Failure";
  return undefined;
}

function toReactEdge(
  edge: ConversationFlowCanvasEdge,
  labels: ConversationFlowVisualLabels | undefined,
): Edge {
  const tone = edge.tone ?? edgeToneFromHandle(edge.sourceHandle);
  const style = EDGE_STYLES[tone];
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    type: "smoothstep",
    animated: tone !== "neutral",
    label: edge.label ?? edgeLabelFromHandle(edge.sourceHandle, labels),
    labelStyle: {
      fill: style.stroke,
      fontSize: 10,
      fontWeight: 700,
    },
    style,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: style.stroke,
    },
  };
}

function toCanvasEdge(edge: Edge): ConversationFlowCanvasEdge {
  const sourceHandle =
    typeof edge.sourceHandle === "string" ? edge.sourceHandle : undefined;
  const tone = edgeToneFromHandle(sourceHandle);
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(sourceHandle ? { sourceHandle } : {}),
    label: typeof edge.label === "string" ? edge.label : undefined,
    tone,
  };
}

function createPaletteNode(
  action: ConversationFlowPaletteAction,
  index: number,
  labels: ConversationFlowVisualLabels | undefined,
): ConversationFlowCanvasNode {
  const id = `action_canvas_${Date.now().toString(36)}_${index}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  return {
    id,
    type: "conversationNode",
    position: { x: 360 + (index % 2) * 220, y: 180 + index * 80 },
    data: {
      kind: "action",
      label: action.label,
      subtitle: labels?.actionSubtitle ?? "Action",
      actionType: action.type,
      actionConfig: action.config ?? {},
      successLabel: labels?.success,
      failureLabel: labels?.failure,
      runtimeType: "action",
    },
  };
}

export function ConversationFlowCanvas({
  graph,
  labels,
  editable = false,
  disabled = false,
  paletteActions = [],
  editorLabels,
  onSaveGraph,
  className,
}: ConversationFlowCanvasProps) {
  const mergedEditorLabels = { ...DEFAULT_EDITOR_LABELS, ...editorLabels };
  const canvas = useMemo(
    () => conversationGraphToCanvas(graph, labels),
    [graph, labels],
  );
  const initialNodes = useMemo<ConversationFlowReactNode[]>(
    () => canvas.nodes,
    [canvas.nodes],
  );
  const initialEdges = useMemo<Edge[]>(
    () => canvas.edges.map((edge) => toReactEdge(edge, labels)),
    [canvas.edges, labels],
  );
  const [nodes, setNodes, onNodesChange] =
    useNodesState<ConversationFlowReactNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSelectedNodeId(null);
    setDirty(false);
  }, [initialNodes, initialEdges, setEdges, setNodes]);

  const markDirty = useCallback(() => {
    if (editable) setDirty(true);
  }, [editable]);

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      if (
        changes.some((change) =>
          ["add", "position", "remove"].includes(change.type),
        )
      ) {
        markDirty();
      }
      onNodesChange(changes);
    },
    [markDirty, onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      if (changes.some((change) => change.type !== "select")) markDirty();
      onEdgesChange(changes);
    },
    [markDirty, onEdgesChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!editable) return;
      markDirty();
      const sourceHandle =
        typeof connection.sourceHandle === "string"
          ? connection.sourceHandle
          : undefined;
      const tone = edgeToneFromHandle(sourceHandle);
      const style = EDGE_STYLES[tone];
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${sourceHandle ?? "default"}-${connection.target}-${Date.now()}`,
            type: "smoothstep",
            animated: tone !== "neutral",
            label: edgeLabelFromHandle(sourceHandle, labels),
            labelStyle: {
              fill: style.stroke,
              fontSize: 10,
              fontWeight: 700,
            },
            style,
            markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
          },
          current,
        ),
      );
    },
    [editable, labels, markDirty, setEdges],
  );

  const addPaletteNode = useCallback(
    (action: ConversationFlowPaletteAction, index: number) => {
      if (!editable || disabled) return;
      markDirty();
      setNodes((current) => [
        ...current,
        createPaletteNode(action, current.length + index, labels),
      ]);
    },
    [disabled, editable, labels, markDirty, setNodes],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const canDeleteSelected =
    editable &&
    selectedNode &&
    selectedNode.data.kind !== "trigger" &&
    selectedNode.data.kind !== "end";

  const deleteSelected = useCallback(() => {
    if (!canDeleteSelected || !selectedNodeId) return;
    markDirty();
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) =>
      current.filter(
        (edge) =>
          edge.source !== selectedNodeId && edge.target !== selectedNodeId,
      ),
    );
    setSelectedNodeId(null);
  }, [canDeleteSelected, markDirty, selectedNodeId, setEdges, setNodes]);

  const resetGraph = useCallback(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSelectedNodeId(null);
    setDirty(false);
  }, [initialEdges, initialNodes, setEdges, setNodes]);

  const saveGraph = useCallback(async () => {
    if (!onSaveGraph || disabled || saving) return;
    setSaving(true);
    try {
      const runtimeGraph = canvasToConversationGraph({
        nodes: nodes.map((node) => ({
          id: node.id,
          type: "conversationNode",
          position: node.position,
          data: node.data,
        })),
        edges: edges.map(toCanvasEdge),
      });
      await onSaveGraph(runtimeGraph);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [disabled, edges, nodes, onSaveGraph, saving]);

  if (nodes.length === 0) {
    return (
      <div
        className={cn(
          "flex h-[320px] items-center justify-center rounded-2xl border border-dashed bg-muted/20 text-sm text-muted-foreground",
          className,
        )}
      >
        {labels?.empty ?? "No blocks yet"}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[1.35rem] border bg-background",
        className,
      )}
    >
      {editable && (
        <div className="border-b bg-muted/35 p-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {mergedEditorLabels.palette}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {paletteActions.map((action, index) => (
                  <button
                    key={action.type}
                    type="button"
                    disabled={disabled}
                    onClick={() => addPaletteNode(action, index)}
                    className="rounded-full border border-primary/20 bg-background px-3 py-1.5 text-xs font-semibold text-primary shadow-sm transition hover:-translate-y-0.5 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  dirty
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700",
                )}
              >
                {dirty ? mergedEditorLabels.dirty : mergedEditorLabels.clean}
              </span>
              <button
                type="button"
                disabled={disabled || !canDeleteSelected}
                onClick={deleteSelected}
                className="rounded-full border bg-background px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mergedEditorLabels.delete}
              </button>
              <button
                type="button"
                disabled={disabled || !dirty}
                onClick={resetGraph}
                className="rounded-full border bg-background px-3 py-1.5 text-xs font-semibold transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mergedEditorLabels.reset}
              </button>
              <button
                type="button"
                disabled={disabled || saving || !dirty || !onSaveGraph}
                onClick={saveGraph}
                className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                {saving ? mergedEditorLabels.saving : mergedEditorLabels.save}
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {mergedEditorLabels.hint}
          </p>
        </div>
      )}
      <div className="h-[420px] bg-[radial-gradient(circle_at_20%_20%,hsl(var(--primary)/0.08),transparent_30%),radial-gradient(circle_at_80%_0%,hsl(var(--muted)),transparent_28%)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={editable && !disabled}
          nodesConnectable={editable && !disabled}
          elementsSelectable={editable && !disabled}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="#e2e8f0" />
          <Controls
            showInteractive={false}
            className="!rounded-lg !border !bg-card !shadow-md"
          />
          <MiniMap
            className="!rounded-lg !border !bg-muted !shadow-sm"
            maskColor="rgba(0,0,0,0.05)"
            nodeColor={(node) => {
              const data = node.data as ConversationFlowCanvasNodeData;
              return minimapColor(data);
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
