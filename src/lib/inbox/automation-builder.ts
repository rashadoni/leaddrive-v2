export type LinearFlowActionType =
  | "business_hours_gate"
  | "assign_to_queue"
  | "menu"
  | "send_reply"
  | "ai_reply"
  | "handoff_agent"
  | "update_field";

export const LINEAR_FLOW_ACTION_TYPES: LinearFlowActionType[] = [
  "assign_to_queue",
  "menu",
  "send_reply",
  "ai_reply",
  "handoff_agent",
  "update_field",
];

export const SEND_REPLY_CHANNELS = [
  "email",
  "telegram",
  "sms",
  "whatsapp",
  "tiktok",
  "facebook",
  "instagram",
  "vkontakte",
] as const;

export const AI_REPLY_CHANNELS = [
  "facebook",
  "instagram",
  "telegram",
  "vkontakte",
  "tiktok",
] as const;

export interface LinearFlowStep {
  id: string;
  type: LinearFlowActionType;
  config?: {
    queueId?: string;
    prompt?: string;
    optionsText?: string;
    text?: string;
    toUserId?: string;
    reason?: string;
    userMessage?: string;
    channelType?: string;
    field?: string;
    value?: string;
  };
}

export type LinearFlowStepIssueCode =
  | "missing_queue"
  | "missing_prompt"
  | "missing_options"
  | "missing_text"
  | "missing_user"
  | "missing_field"
  | "missing_value";

export interface LinearFlowStepIssue {
  stepId: string;
  code: LinearFlowStepIssueCode;
}

export interface GraphActionSummary {
  type: string;
  queueId?: string;
  prompt?: string;
  optionsText?: string;
  text?: string;
  toUserId?: string;
  reason?: string;
  userMessage?: string;
  channelType?: string;
  field?: string;
  value?: string;
}

function cleanString(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function actionNodeId(index: number): string {
  return `action_${index + 1}`;
}

function parseMenuOptionsText(value: unknown): { id: string; label: string; match: string[] }[] {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(0, 12).map((line, index) => {
    const label = line.replace(/^[-*•\s]*(?:\d+[\).:\-\s]+)?/, "").trim() || line;
    const id = `option_${index + 1}`;
    return {
      id,
      label,
      match: [String(index + 1), label],
    };
  });
}

function buildActionConfig(step: LinearFlowStep): Record<string, unknown> {
  switch (step.type) {
    case "business_hours_gate":
      return cleanString(step.config?.channelType)
        ? { channelType: cleanString(step.config?.channelType) }
        : {};
    case "assign_to_queue":
      return { queueId: cleanString(step.config?.queueId) ?? "" };
    case "menu":
      return {
        prompt: cleanString(step.config?.prompt) ?? "",
        options: parseMenuOptionsText(step.config?.optionsText),
      };
    case "send_reply":
      return { text: cleanString(step.config?.text) ?? "" };
    case "ai_reply": {
      const userMessage = cleanString(step.config?.userMessage);
      return userMessage ? { userMessage } : {};
    }
    case "handoff_agent": {
      const reason = cleanString(step.config?.reason);
      return {
        toUserId: cleanString(step.config?.toUserId) ?? "",
        ...(reason ? { reason } : {}),
      };
    }
    case "update_field":
      return {
        field: cleanString(step.config?.field) ?? "",
        value: cleanString(step.config?.value) ?? "",
      };
  }
}

export function validateLinearFlowSteps(
  steps: LinearFlowStep[],
): LinearFlowStepIssue[] {
  return steps.flatMap<LinearFlowStepIssue>((step): LinearFlowStepIssue[] => {
    switch (step.type) {
      case "assign_to_queue":
        return cleanString(step.config?.queueId)
          ? []
          : [{ stepId: step.id, code: "missing_queue" as const }];
      case "menu":
        return [
          ...(cleanString(step.config?.prompt)
            ? []
            : [{ stepId: step.id, code: "missing_prompt" as const }]),
          ...(parseMenuOptionsText(step.config?.optionsText).length > 0
            ? []
            : [{ stepId: step.id, code: "missing_options" as const }]),
        ];
      case "send_reply":
        return cleanString(step.config?.text)
          ? []
          : [{ stepId: step.id, code: "missing_text" as const }];
      case "handoff_agent":
        return cleanString(step.config?.toUserId)
          ? []
          : [{ stepId: step.id, code: "missing_user" as const }];
      case "update_field":
        return [
          ...(cleanString(step.config?.field)
            ? []
            : [{ stepId: step.id, code: "missing_field" as const }]),
          ...(cleanString(step.config?.value)
            ? []
            : [{ stepId: step.id, code: "missing_value" as const }]),
        ];
      case "ai_reply":
      case "business_hours_gate":
        return [];
    }
  });
}

export function buildLinearConversationFlowGraph(steps: LinearFlowStep[]) {
  const nodes = [
    { id: "trigger", type: "trigger", data: { event: "message_inbound" } },
    ...steps.map((step, index) => ({
      id: actionNodeId(index),
      type: "action",
      data: {
        action: {
          type: step.type,
          config: buildActionConfig(step),
        },
      },
    })),
    { id: "end", type: "end" },
  ];

  const edges = steps.length
    ? [
        { source: "trigger", target: actionNodeId(0) },
        ...steps.flatMap((_step, index) => {
          const nextTarget =
            index === steps.length - 1 ? "end" : actionNodeId(index + 1);
          return [
            {
              source: actionNodeId(index),
              target: nextTarget,
              sourceHandle: "success",
            },
            {
              source: actionNodeId(index),
              target: "end",
              sourceHandle: "failure",
            },
          ];
        }),
      ]
    : [{ source: "trigger", target: "end" }];

  return {
    nodes,
    edges,
    metadata: {
      builder: "inbox-automation-linear-v1",
      actionCount: steps.length,
      actions: steps.map((step) => step.type),
    },
  };
}

export function extractGraphActionSummaries(
  graph: unknown,
): GraphActionSummary[] {
  if (!graph || typeof graph !== "object") return [];
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];

  return nodes.flatMap((node) => {
    if (!node || typeof node !== "object") return [];
    const data = (node as { data?: unknown }).data;
    if (!data || typeof data !== "object") return [];
    const action = (data as { action?: unknown }).action;
    if (!action || typeof action !== "object") return [];
    const type = (action as { type?: unknown }).type;
    if (typeof type !== "string") return [];
    const config = (action as { config?: unknown }).config;
    const c =
      config && typeof config === "object"
        ? (config as Record<string, unknown>)
        : {};
    return [
      {
        type,
        queueId: cleanString(c.queueId ?? c.teamQueueId),
        prompt: cleanString(c.prompt),
        optionsText: Array.isArray(c.options)
          ? c.options
              .map((option) =>
                option && typeof option === "object"
                  ? cleanString((option as Record<string, unknown>).label)
                  : undefined,
              )
              .filter(Boolean)
              .join("\n")
          : cleanString(c.optionsText),
        text: cleanString(c.text),
        toUserId: cleanString(c.toUserId ?? c.assignTo),
        reason: cleanString(c.reason),
        userMessage: cleanString(c.userMessage),
        channelType: cleanString(c.channelType),
        field: cleanString(c.field ?? c.path),
        value: cleanString(c.value),
      },
    ];
  });
}
