export type ConversationFlowVisualKind =
  | "trigger"
  | "action"
  | "end"
  | "unknown";
export type ConversationFlowEdgeTone = "neutral" | "success" | "failure";

export interface ConversationFlowRuntimeNode {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface ConversationFlowRuntimeEdge {
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface ConversationFlowRuntimeGraph {
  nodes: ConversationFlowRuntimeNode[];
  edges: ConversationFlowRuntimeEdge[];
  metadata?: Record<string, unknown>;
}

export interface ConversationFlowCanvasNodeData extends Record<
  string,
  unknown
> {
  kind: ConversationFlowVisualKind;
  label: string;
  subtitle: string;
  event?: string;
  actionType?: string;
  actionConfig?: Record<string, unknown>;
  configPreview?: string;
  successLabel?: string;
  failureLabel?: string;
  runtimeType: string;
}

export interface ConversationFlowCanvasNode {
  id: string;
  type: "conversationNode";
  position: { x: number; y: number };
  data: ConversationFlowCanvasNodeData;
}

export interface ConversationFlowCanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
  tone: ConversationFlowEdgeTone;
}

export interface ConversationFlowCanvas {
  nodes: ConversationFlowCanvasNode[];
  edges: ConversationFlowCanvasEdge[];
}

export interface ConversationFlowVisualLabels {
  trigger?: string;
  triggerSubtitle?: string;
  actionSubtitle?: string;
  end?: string;
  endSubtitle?: string;
  success?: string;
  failure?: string;
  empty?: string;
  actionLabels?: Record<string, string>;
}

const DEFAULT_LABELS: Required<
  Omit<ConversationFlowVisualLabels, "actionLabels">
> = {
  trigger: "Trigger",
  triggerSubtitle: "Conversation event",
  actionSubtitle: "Action",
  end: "End",
  endSubtitle: "Final step",
  success: "Success",
  failure: "Failure",
  empty: "No blocks yet",
};

const MAIN_LANE_X = 260;
const FAILURE_LANE_X = 560;
const START_Y = 48;
const ROW_GAP = 132;
const MAX_PREVIEW_LENGTH = 48;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function previewString(value: unknown): string | undefined {
  const text = cleanString(value);
  if (!text) return undefined;
  return text.length > MAX_PREVIEW_LENGTH
    ? `${text.slice(0, MAX_PREVIEW_LENGTH - 1)}…`
    : text;
}

function parsePosition(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

function parseGraph(graph: unknown): ConversationFlowRuntimeGraph | null {
  if (!isRecord(graph)) return null;
  const rawNodes = graph.nodes;
  const rawEdges = graph.edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;

  const nodes = rawNodes.flatMap<ConversationFlowRuntimeNode>((node) => {
    if (!isRecord(node)) return [];
    const id = cleanString(node.id);
    const type = cleanString(node.type);
    if (!id || !type) return [];
    return [
      {
        id,
        type,
        data: isRecord(node.data) ? node.data : undefined,
        position: parsePosition(node.position),
      },
    ];
  });

  const edges = rawEdges.flatMap<ConversationFlowRuntimeEdge>((edge) => {
    if (!isRecord(edge)) return [];
    const source = cleanString(edge.source);
    const target = cleanString(edge.target);
    if (!source || !target) return [];
    const sourceHandle = cleanString(edge.sourceHandle);
    return [{ source, target, ...(sourceHandle ? { sourceHandle } : {}) }];
  });

  return {
    nodes,
    edges,
    metadata: isRecord(graph.metadata) ? graph.metadata : undefined,
  };
}

function actionFromNode(node: ConversationFlowRuntimeNode): {
  type?: string;
  config?: Record<string, unknown>;
} {
  const action = isRecord(node.data?.action) ? node.data.action : undefined;
  if (!action) return {};
  return {
    type: cleanString(action.type),
    config: isRecord(action.config) ? action.config : undefined,
  };
}

function nodeKind(
  node: ConversationFlowRuntimeNode,
): ConversationFlowVisualKind {
  if (node.type === "trigger") return "trigger";
  if (node.type === "action") return "action";
  if (node.type === "end") return "end";
  return "unknown";
}

function actionConfigPreview(
  config: Record<string, unknown> | undefined,
): string | undefined {
  if (!config) return undefined;
  return (
    previewString(config.text) ??
    previewString(config.userMessage) ??
    previewString(config.reason) ??
    previewString(config.queueId) ??
    previewString(config.teamQueueId) ??
    previewString(config.channelType) ??
    previewString(config.toUserId) ??
    previewString(config.assignTo)
  );
}

function nodeLabel(
  node: ConversationFlowRuntimeNode,
  labels: ConversationFlowVisualLabels,
): ConversationFlowCanvasNodeData {
  const mergedLabels = { ...DEFAULT_LABELS, ...labels };
  const kind = nodeKind(node);
  const event = cleanString(node.data?.event);
  const action = actionFromNode(node);
  const actionType = action.type;
  const actionLabel = actionType
    ? (labels.actionLabels?.[actionType] ?? actionType)
    : undefined;

  if (kind === "trigger") {
    return {
      kind,
      label: mergedLabels.trigger,
      subtitle: mergedLabels.triggerSubtitle,
      event,
      runtimeType: node.type,
    };
  }

  if (kind === "end") {
    return {
      kind,
      label: mergedLabels.end,
      subtitle: mergedLabels.endSubtitle,
      runtimeType: node.type,
    };
  }

  if (kind === "action") {
    return {
      kind,
      label: actionLabel ?? "Action",
      subtitle: mergedLabels.actionSubtitle,
      actionType,
      actionConfig: action.config,
      configPreview: actionConfigPreview(action.config),
      successLabel: mergedLabels.success,
      failureLabel: mergedLabels.failure,
      runtimeType: node.type,
    };
  }

  return {
    kind,
    label: node.type,
    subtitle: "unsupported node",
    runtimeType: node.type,
  };
}

function reachableOrder(graph: ConversationFlowRuntimeGraph): string[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map<string, ConversationFlowRuntimeEdge[]>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }

  const triggers = graph.nodes
    .filter((node) => node.type === "trigger")
    .map((node) => node.id);
  const queue = triggers.length
    ? [...triggers]
    : graph.nodes.slice(0, 1).map((node) => node.id);
  const visited = new Set<string>();
  const order: string[] = [];

  while (queue.length) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (!visited.has(edge.target)) queue.push(edge.target);
    }
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) order.push(node.id);
  }

  return order;
}

function edgeTone(edge: ConversationFlowRuntimeEdge): ConversationFlowEdgeTone {
  if (edge.sourceHandle === "success") return "success";
  if (edge.sourceHandle === "failure") return "failure";
  return "neutral";
}

function edgeLabel(
  edge: ConversationFlowRuntimeEdge,
  labels: ConversationFlowVisualLabels,
): string | undefined {
  const mergedLabels = { ...DEFAULT_LABELS, ...labels };
  if (edge.sourceHandle === "success") return mergedLabels.success;
  if (edge.sourceHandle === "failure") return mergedLabels.failure;
  return undefined;
}

export function conversationGraphToCanvas(
  graph: unknown,
  labels: ConversationFlowVisualLabels = {},
): ConversationFlowCanvas {
  const parsed = parseGraph(graph);
  if (!parsed) return { nodes: [], edges: [] };

  const order = reachableOrder(parsed);
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const incomingFailureTargets = new Set(
    parsed.edges
      .filter((edge) => edge.sourceHandle === "failure")
      .map((edge) => edge.target),
  );

  const nodes = parsed.nodes.map<ConversationFlowCanvasNode>((node) => {
    const index = orderIndex.get(node.id) ?? 0;
    const kind = nodeKind(node);
    const isFailureLane = kind !== "end" && incomingFailureTargets.has(node.id);
    const fallbackPosition = {
      x: isFailureLane ? FAILURE_LANE_X : MAIN_LANE_X,
      y: START_Y + index * ROW_GAP,
    };
    return {
      id: node.id,
      type: "conversationNode",
      position: node.position ?? fallbackPosition,
      data: nodeLabel(node, labels),
    };
  });

  const edges = parsed.edges.map<ConversationFlowCanvasEdge>((edge, index) => ({
    id: `e-${edge.source}-${edge.sourceHandle ?? "default"}-${edge.target}-${index}`,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    label: edgeLabel(edge, labels),
    tone: edgeTone(edge),
  }));

  return { nodes, edges };
}

export function canvasToConversationGraph(
  canvas: ConversationFlowCanvas,
): ConversationFlowRuntimeGraph {
  return {
    nodes: canvas.nodes.map((node) => {
      if (node.data.kind === "action") {
        return {
          id: node.id,
          type: node.data.runtimeType,
          position: node.position,
          data: {
            action: {
              type: node.data.actionType,
              config: node.data.actionConfig ?? {},
            },
          },
        };
      }
      if (node.data.kind === "trigger") {
        return {
          id: node.id,
          type: node.data.runtimeType,
          position: node.position,
          data: { event: node.data.event },
        };
      }
      return {
        id: node.id,
        type: node.data.runtimeType,
        position: node.position,
      };
    }),
    edges: canvas.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    })),
  };
}
