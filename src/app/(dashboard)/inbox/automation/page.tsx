"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bot,
  BookOpen,
  CheckCircle2,
  Clock3,
  GitBranch,
  Loader2,
  MousePointerClick,
  Plus,
  RefreshCw,
  Route,
  Send,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpButton } from "@/components/help/help-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AI_REPLY_CHANNELS,
  LINEAR_FLOW_ACTION_TYPES,
  SEND_REPLY_CHANNELS,
  buildLinearConversationFlowGraph,
  extractGraphActionSummaries,
  validateLinearFlowSteps,
  type GraphActionSummary,
  type LinearFlowActionType,
  type LinearFlowStep,
  type LinearFlowStepIssueCode,
} from "@/lib/inbox/automation-builder";
import { cn } from "@/lib/utils";

const ConversationFlowCanvas = dynamic(
  () =>
    import("@/components/inbox/conversation-flow-canvas").then((mod) => ({
      default: mod.ConversationFlowCanvas,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[360px] animate-pulse rounded-xl border bg-muted/40" />
    ),
  },
);

type QueueStrategy = "least_loaded" | "round_robin" | "skill_match";
type FlowStatus = "draft" | "active" | "paused";
type AutomationTab = "overview" | "builder" | "flows" | "runs";
type FlowTemplateId =
  | "queue_route"
  | "reply_then_queue"
  | "ai_then_queue"
  | "mark_vip_then_queue"
  | "whatsapp_business_intake"
  | "tiktok_chatwoot_triage"
  | "atl_sms_callback"
  | "social_dm_qualify";

interface TeamQueue {
  id: string;
  name: string;
  skillTags: string[];
  strategy: QueueStrategy;
  lastAssignedTo: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ConversationFlow {
  id: string;
  name: string;
  status: FlowStatus;
  trigger: string;
  channelTypes: string[];
  graph: unknown;
  version: number;
  updatedAt: string;
}

interface ConversationFlowRun {
  id: string;
  flowId: string;
  conversationId: string;
  status: "running" | "completed" | "failed" | string;
  currentNodeId: string | null;
  startedAt: string;
  updatedAt: string;
  summary: {
    stepCount: number;
    stop: string | null;
  };
  flow: {
    id: string;
    name: string;
    trigger: string;
    status: string;
  } | null;
  conversation: {
    id: string;
    platform: string;
    contactName: string;
    status: string;
    lastMessageAt: string;
  } | null;
}

interface AssignableUser {
  id: string;
  name: string | null;
  email: string | null;
  avatar?: string | null;
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

const CHANNELS = [
  "tiktok",
  "whatsapp",
  "telegram",
  "email",
  "sms",
  "facebook",
  "instagram",
  "vkontakte",
  "webchat",
] as const;
const QUEUE_STRATEGIES: QueueStrategy[] = [
  "least_loaded",
  "round_robin",
  "skill_match",
];
const FLOW_STATUSES: FlowStatus[] = ["draft", "active", "paused"];
const VISUAL_CANVAS_ACTION_TYPES = ["notify", "close"] as const;
const FLOW_TEMPLATE_IDS: FlowTemplateId[] = [
  "queue_route",
  "reply_then_queue",
  "ai_then_queue",
  "mark_vip_then_queue",
  "whatsapp_business_intake",
  "tiktok_chatwoot_triage",
  "atl_sms_callback",
  "social_dm_qualify",
];
const FEATURED_FLOW_TEMPLATE_IDS: FlowTemplateId[] = [
  "whatsapp_business_intake",
  "tiktok_chatwoot_triage",
  "atl_sms_callback",
  "social_dm_qualify",
];
const CONTACT_UPDATE_FIELDS = [
  "contact.category",
  "contact.source",
  "contact.lifecycleStage",
  "contact.tags",
] as const;
const CONTACT_LIFECYCLE_STAGE_OPTIONS = [
  "lead",
  "engaged",
  "mql",
  "sql",
  "opportunity",
  "customer",
  "churned",
] as const;
const sendReplyChannels = new Set<string>(SEND_REPLY_CHANNELS);
const aiReplyChannels = new Set<string>(AI_REPLY_CHANNELS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeTagsInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

async function readApi<T>(res: Response): Promise<T> {
  const payload = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
  return payload.data as T;
}

function createStepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultStepConfig(
  type: LinearFlowActionType,
  queueId: string,
  userId: string,
): NonNullable<LinearFlowStep["config"]> {
  switch (type) {
    case "business_hours_gate":
      return {};
    case "assign_to_queue":
      return { queueId };
    case "menu":
      return {
        prompt: "",
        optionsText: "Sales\nSupport\nTalk to a human",
      };
    case "send_reply":
      return { text: "" };
    case "ai_reply":
      return {};
    case "handoff_agent":
      return { toUserId: userId, reason: "" };
    case "update_field":
      return { field: "contact.lifecycleStage", value: "" };
  }
}

function actionIcon(type: LinearFlowActionType) {
  switch (type) {
    case "business_hours_gate":
      return Clock3;
    case "assign_to_queue":
      return Users;
    case "menu":
      return MousePointerClick;
    case "send_reply":
      return Send;
    case "ai_reply":
      return Sparkles;
    case "handoff_agent":
      return UserRound;
    case "update_field":
      return RefreshCw;
  }
}

function actionToneClass(type: LinearFlowActionType): string {
  switch (type) {
    case "assign_to_queue":
      return "bg-orange-50 text-orange-700 ring-orange-100";
    case "menu":
      return "bg-indigo-50 text-indigo-700 ring-indigo-100";
    case "send_reply":
      return "bg-sky-50 text-sky-700 ring-sky-100";
    case "ai_reply":
      return "bg-violet-50 text-violet-700 ring-violet-100";
    case "handoff_agent":
      return "bg-emerald-50 text-emerald-700 ring-emerald-100";
    case "business_hours_gate":
      return "bg-amber-50 text-amber-700 ring-amber-100";
    case "update_field":
      return "bg-teal-50 text-teal-700 ring-teal-100";
  }
}

function flowTemplateIcon(templateId: FlowTemplateId) {
  switch (templateId) {
    case "queue_route":
      return Users;
    case "reply_then_queue":
      return Send;
    case "ai_then_queue":
      return Sparkles;
    case "mark_vip_then_queue":
      return RefreshCw;
    case "whatsapp_business_intake":
      return Workflow;
    case "tiktok_chatwoot_triage":
      return Bot;
    case "atl_sms_callback":
      return Clock3;
    case "social_dm_qualify":
      return GitBranch;
  }
}

function textPreview(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return value.length > 48 ? `${value.slice(0, 45)}…` : value;
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function runStatusVariant(
  status: string,
): "success" | "warning" | "destructive" | "secondary" {
  if (status === "completed") return "success";
  if (status === "running") return "warning";
  if (status === "failed") return "destructive";
  return "secondary";
}

function withVisualGraphMetadata(baseGraph: unknown, graph: unknown) {
  const existingMetadata =
    isRecord(baseGraph) && isRecord(baseGraph.metadata)
      ? baseGraph.metadata
      : {};
  if (!isRecord(graph)) return graph;
  return {
    ...graph,
    metadata: {
      ...existingMetadata,
      builder: "inbox-automation-canvas-v1",
      visualEditor: true,
    },
  };
}

export default function InboxAutomationPage() {
  const { data: session } = useSession();
  const t = useTranslations("inboxAutomation");
  const orgId = session?.user?.organizationId;

  const [queues, setQueues] = useState<TeamQueue[]>([]);
  const [flows, setFlows] = useState<ConversationFlow[]>([]);
  const [flowRuns, setFlowRuns] = useState<ConversationFlowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AutomationTab>("overview");
  const [flowSearch, setFlowSearch] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);

  const [queueName, setQueueName] = useState("");
  const [queueSkills, setQueueSkills] = useState("");
  const [queueStrategy, setQueueStrategy] =
    useState<QueueStrategy>("least_loaded");
  const [queueIsActive, setQueueIsActive] = useState(true);

  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [flowName, setFlowName] = useState("");
  const [flowStatus, setFlowStatus] = useState<FlowStatus>("draft");
  const [flowChannels, setFlowChannels] = useState<string[]>(["tiktok"]);
  const [selectedVisualFlowId, setSelectedVisualFlowId] = useState<
    string | null
  >(null);
  const [flowSteps, setFlowSteps] = useState<LinearFlowStep[]>([
    {
      id: "step_initial_reply",
      type: "send_reply",
      config: { text: t("builder.replyPlaceholder") },
    },
  ]);

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(orgId ? { "x-organization-id": String(orgId) } : {}),
    }),
    [orgId],
  );

  const queueById = useMemo(
    () => new Map(queues.map((queue) => [queue.id, queue])),
    [queues],
  );
  const userById = useMemo(
    () => new Map(assignableUsers.map((user) => [user.id, user])),
    [assignableUsers],
  );
  const activeFlows = useMemo(
    () => flows.filter((flow) => flow.status === "active").length,
    [flows],
  );
  const activeQueues = useMemo(
    () => queues.filter((queue) => queue.isActive).length,
    [queues],
  );
  const selectedVisualFlow = useMemo(() => {
    if (flows.length === 0) return null;
    return flows.find((flow) => flow.id === selectedVisualFlowId) ?? flows[0];
  }, [flows, selectedVisualFlowId]);
  const selectedVisualFlowActions = useMemo(
    () =>
      selectedVisualFlow
        ? extractGraphActionSummaries(selectedVisualFlow.graph)
        : [],
    [selectedVisualFlow],
  );
  const filteredFlows = useMemo(() => {
    const query = flowSearch.trim().toLowerCase();
    if (!query) return flows;
    return flows.filter((flow) => {
      const haystack = [
        flow.name,
        flow.status,
        flow.trigger,
        ...flow.channelTypes,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [flows, flowSearch]);
  const flowStepIssues = useMemo(
    () => validateLinearFlowSteps(flowSteps),
    [flowSteps],
  );
  const flowStepIssueById = useMemo(
    () => new Map(flowStepIssues.map((issue) => [issue.stepId, issue.code])),
    [flowStepIssues],
  );
  const hasSendReplyStep = useMemo(
    () => flowSteps.some((step) => step.type === "send_reply"),
    [flowSteps],
  );
  const hasAiReplyStep = useMemo(
    () => flowSteps.some((step) => step.type === "ai_reply"),
    [flowSteps],
  );
  const flowRequiresQueue = useMemo(
    () => flowSteps.some((step) => step.type === "assign_to_queue"),
    [flowSteps],
  );
  const unsupportedSendReplyChannels = useMemo(
    () =>
      hasSendReplyStep
        ? flowChannels.filter((channel) => !sendReplyChannels.has(channel))
        : [],
    [flowChannels, hasSendReplyStep],
  );
  const unsupportedAiReplyChannels = useMemo(
    () =>
      hasAiReplyStep
        ? flowChannels.filter((channel) => !aiReplyChannels.has(channel))
        : [],
    [flowChannels, hasAiReplyStep],
  );
  const canCreateFlow =
    flowSteps.length > 0 &&
    flowStepIssues.length === 0 &&
    flowChannels.length > 0 &&
    unsupportedSendReplyChannels.length === 0 &&
    unsupportedAiReplyChannels.length === 0;
  const missingRequiredQueue = flowRequiresQueue && queues.length === 0;
  const builderSetupSteps = useMemo(
    () => [
      {
        step: 1,
        done: !flowRequiresQueue || queues.length > 0,
        title: flowRequiresQueue
          ? t("builderGuide.step1Title")
          : t("builderGuide.step1OptionalTitle"),
        desc: !flowRequiresQueue
          ? t("builderGuide.step1OptionalDesc")
          : queues.length > 0
            ? t("setup.queueReady", { count: queues.length })
            : t("builderGuide.step1Desc"),
      },
      {
        step: 2,
        done: true,
        title: t("builderGuide.step2Title"),
        desc: flowName.trim()
          ? t("setup.scenarioReady", { name: flowName.trim() })
          : t("setup.scenarioDefault", {
              name: t("defaultLinearFlowName"),
            }),
      },
      {
        step: 3,
        done: flowChannels.length > 0,
        title: t("builderGuide.step3Title"),
        desc:
          flowChannels.length > 0
            ? t("setup.channelsReady", { count: flowChannels.length })
            : t("builderGuide.step3Desc"),
      },
      {
        step: 4,
        done:
          flowSteps.length > 0 &&
          flowStepIssues.length === 0 &&
          unsupportedSendReplyChannels.length === 0 &&
          unsupportedAiReplyChannels.length === 0,
        title: t("builderGuide.step4Title"),
        desc:
          flowSteps.length > 0 && flowStepIssues.length === 0
            ? t("setup.actionsReady", { count: flowSteps.length })
            : t("builderGuide.step4Desc"),
      },
    ],
    [
      queues.length,
      flowRequiresQueue,
      flowName,
      flowChannels.length,
      flowSteps.length,
      flowStepIssues.length,
      unsupportedSendReplyChannels.length,
      unsupportedAiReplyChannels.length,
      t,
    ],
  );
  const firstIncompleteSetupStep = builderSetupSteps.findIndex(
    (step) => !step.done,
  );
  const currentSetupStep =
    firstIncompleteSetupStep >= 0
      ? builderSetupSteps[firstIncompleteSetupStep]
      : null;
  const draftFlowGraph = useMemo(
    () => buildLinearConversationFlowGraph(flowSteps),
    [flowSteps],
  );
  const flowVisualLabels = useMemo(
    () => ({
      trigger: t("builder.visualTrigger"),
      end: t("builder.visualEnd"),
      success: t("builder.visualSuccess"),
      failure: t("builder.visualFailure"),
      empty: t("builder.visualEmpty"),
      triggerSubtitle: t("builder.visualTriggerSubtitle"),
      actionSubtitle: t("builder.visualActionSubtitle"),
      endSubtitle: t("builder.visualEndSubtitle"),
      actionLabels: Object.fromEntries(
        [...LINEAR_FLOW_ACTION_TYPES, ...VISUAL_CANVAS_ACTION_TYPES].map(
          (type) => [type, t(`actions.${type}`)],
        ),
      ),
    }),
    [t],
  );
  const visualPaletteActions = useMemo(
    () =>
      VISUAL_CANVAS_ACTION_TYPES.map((type) => ({
        type,
        label: t(`actions.${type}`),
        config: {},
      })),
    [t],
  );
  const visualEditorLabels = useMemo(
    () => ({
      palette: t("visualEditor.palette"),
      save: t("visualEditor.save"),
      saving: t("visualEditor.saving"),
      reset: t("visualEditor.reset"),
      delete: t("visualEditor.delete"),
      dirty: t("visualEditor.dirty"),
      clean: t("visualEditor.clean"),
      hint: t("visualEditor.canvasHint"),
    }),
    [t],
  );
  const isRecoverableLoadError =
    error?.startsWith("HTTP ") || error === t("errors.loadFailed");
  const statusMessage = error
    ? isRecoverableLoadError
      ? t("errors.loadUnavailable")
      : error
    : notice;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [queueData, flowData, runData] = await Promise.all([
        fetch("/api/v1/team-queues", { headers }).then((res) =>
          readApi<TeamQueue[]>(res),
        ),
        fetch("/api/v1/conversation-flows", { headers }).then((res) =>
          readApi<ConversationFlow[]>(res),
        ),
        fetch("/api/v1/conversation-flows/runs?limit=8", { headers }).then(
          (res) => readApi<ConversationFlowRun[]>(res),
        ),
      ]);
      const userData = await fetch("/api/v1/users/assignable", { headers })
        .then((res) => readApi<AssignableUser[]>(res))
        .catch(() => []);
      const nextQueues = queueData ?? [];
      setQueues(nextQueues);
      setFlows(flowData ?? []);
      setFlowRuns(runData ?? []);
      setAssignableUsers(userData ?? []);
      setFlowSteps((current) =>
        current.map((step) => {
          if (step.type === "assign_to_queue") {
            const queueId = step.config?.queueId ?? "";
            const queueExists = nextQueues.some(
              (queue) => queue.id === queueId,
            );
            if (queueId && queueExists) return step;
            return {
              ...step,
              config: { ...step.config, queueId: nextQueues[0]?.id ?? "" },
            };
          }
          if (step.type === "handoff_agent" && userData.length > 0) {
            const toUserId = step.config?.toUserId ?? "";
            const userExists = userData.some((user) => user.id === toUserId);
            if (toUserId && userExists) return step;
            return {
              ...step,
              config: { ...step.config, toUserId: userData[0].id },
            };
          }
          return step;
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [headers, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createQueue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!queueName.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fetch("/api/v1/team-queues", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: queueName.trim(),
          skillTags: normalizeTagsInput(queueSkills),
          strategy: queueStrategy,
          isActive: queueIsActive,
        }),
      }).then((res) => readApi<TeamQueue>(res));
      setQueueName("");
      setQueueSkills("");
      setQueueStrategy("least_loaded");
      setQueueIsActive(true);
      setNotice(t("notices.queueCreated"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleQueue(queue: TeamQueue) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fetch(`/api/v1/team-queues/${queue.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ isActive: !queue.isActive }),
      }).then((res) => readApi<TeamQueue>(res));
      setNotice(
        queue.isActive ? t("notices.queuePaused") : t("notices.queueActivated"),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteQueue(queue: TeamQueue) {
    if (!window.confirm(t("queues.deleteConfirm", { name: queue.name })))
      return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fetch(`/api/v1/team-queues/${queue.id}`, {
        method: "DELETE",
        headers,
      }).then((res) => readApi<{ deleted: string }>(res));
      setNotice(t("notices.queueDeleted"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function createLinearFlow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateFlow) return;
    const firstQueueId = flowSteps.find(
      (step) => step.type === "assign_to_queue",
    )?.config?.queueId;
    const queue = firstQueueId ? queueById.get(firstQueueId) : null;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fetch("/api/v1/conversation-flows", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name:
            flowName.trim() ||
            (queue
              ? t("defaultFlowName", { queue: queue.name })
              : t("defaultLinearFlowName")),
          trigger: "message_inbound",
          status: flowStatus,
          channelTypes: flowChannels,
          graph: buildLinearConversationFlowGraph(flowSteps),
        }),
      }).then((res) => readApi<ConversationFlow>(res));
      setFlowName("");
      setFlowStatus("draft");
      setNotice(t("notices.flowCreated"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function applyFlowTemplate(templateId: FlowTemplateId) {
    const queue = queues.find((item) => item.isActive) ?? queues[0] ?? null;
    const queueId = queue?.id ?? "";
    const queueName = queue?.name ?? t("unknownQueue");
    const queueStep: LinearFlowStep = {
      id: createStepId(),
      type: "assign_to_queue",
      config: { queueId },
    };

    setActiveTab("builder");
    setFlowStatus("draft");
    setError(null);
    setNotice(t("templates.appliedNotice"));

    switch (templateId) {
      case "queue_route":
        setFlowName(t("templates.queue_route.name", { queue: queueName }));
        setFlowChannels(["tiktok"]);
        setFlowSteps([queueStep]);
        break;
      case "reply_then_queue":
        setFlowName(t("templates.reply_then_queue.name", { queue: queueName }));
        setFlowChannels(["telegram"]);
        setFlowSteps([
          {
            id: createStepId(),
            type: "send_reply",
            config: { text: t("templates.reply_then_queue.reply") },
          },
          queueStep,
        ]);
        break;
      case "ai_then_queue":
        setFlowName(t("templates.ai_then_queue.name", { queue: queueName }));
        setFlowChannels(["tiktok"]);
        setFlowSteps([
          {
            id: createStepId(),
            type: "ai_reply",
            config: { userMessage: t("templates.ai_then_queue.prompt") },
          },
          queueStep,
        ]);
        break;
      case "mark_vip_then_queue":
        setFlowName(
          t("templates.mark_vip_then_queue.name", { queue: queueName }),
        );
        setFlowChannels(["whatsapp", "telegram", "tiktok"]);
        setFlowSteps([
          {
            id: createStepId(),
            type: "update_field",
            config: { field: "contact.lifecycleStage", value: "mql" },
          },
          {
            id: createStepId(),
            type: "update_field",
            config: { field: "contact.tags", value: "vip, inbox" },
          },
          queueStep,
        ]);
        break;
      case "whatsapp_business_intake":
        setFlowName(
          t("templates.whatsapp_business_intake.name", { queue: queueName }),
        );
        setFlowChannels(["whatsapp"]);
        setFlowSteps([
          {
            id: createStepId(),
            type: "send_reply",
            config: { text: t("templates.whatsapp_business_intake.reply") },
          },
          {
            id: createStepId(),
            type: "update_field",
            config: { field: "contact.source", value: "whatsapp-business" },
          },
          queueStep,
        ]);
        break;
      case "tiktok_chatwoot_triage":
        setFlowName(
          t("templates.tiktok_chatwoot_triage.name", { queue: queueName }),
        );
        setFlowChannels(["tiktok"]);
        setFlowSteps([
          {
            id: createStepId(),
            type: "update_field",
            config: { field: "contact.source", value: "tiktok-chatwoot" },
          },
          {
            id: createStepId(),
            type: "ai_reply",
            config: {
              userMessage: t("templates.tiktok_chatwoot_triage.prompt"),
            },
          },
          queueStep,
        ]);
        break;
      case "atl_sms_callback":
        setFlowName(t("templates.atl_sms_callback.name", { queue: queueName }));
        setFlowChannels(["sms"]);
        setFlowSteps([
          {
            id: createStepId(),
            type: "send_reply",
            config: { text: t("templates.atl_sms_callback.reply") },
          },
          {
            id: createStepId(),
            type: "update_field",
            config: { field: "contact.tags", value: "atl-sms, callback" },
          },
          queueStep,
        ]);
        break;
      case "social_dm_qualify":
        setFlowName(
          t("templates.social_dm_qualify.name", { queue: queueName }),
        );
        setFlowChannels(["facebook", "instagram"]);
        setFlowSteps([
          {
            id: createStepId(),
            type: "ai_reply",
            config: { userMessage: t("templates.social_dm_qualify.prompt") },
          },
          {
            id: createStepId(),
            type: "update_field",
            config: {
              field: "contact.tags",
              value: "social-dm, needs-followup",
            },
          },
          queueStep,
        ]);
        break;
    }

    if (!queue) {
      window.setTimeout(focusQueueName, 0);
    }
  }

  async function updateFlowStatus(flow: ConversationFlow, status: FlowStatus) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fetch(`/api/v1/conversation-flows/${flow.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ status }),
      }).then((res) => readApi<ConversationFlow>(res));
      setNotice(t("notices.flowUpdated"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveVisualFlowGraph(flow: ConversationFlow, graph: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fetch(`/api/v1/conversation-flows/${flow.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          graph: withVisualGraphMetadata(flow.graph, graph),
        }),
      }).then((res) => readApi<ConversationFlow>(res));
      setNotice(t("notices.visualGraphSaved"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.saveFailed"));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function deleteFlow(flow: ConversationFlow) {
    if (!window.confirm(t("flows.deleteConfirm", { name: flow.name }))) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fetch(`/api/v1/conversation-flows/${flow.id}`, {
        method: "DELETE",
        headers,
      }).then((res) => readApi<{ deleted: string }>(res));
      setNotice(t("notices.flowDeleted"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  function toggleChannel(channel: string) {
    setFlowChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );
  }

  function addFlowStep(type: LinearFlowActionType) {
    setFlowSteps((current) => [
      ...current,
      {
        id: createStepId(),
        type,
        config: defaultStepConfig(
          type,
          queues[0]?.id ?? "",
          assignableUsers[0]?.id ?? "",
        ),
      },
    ]);
  }

  function updateFlowStepType(stepId: string, type: LinearFlowActionType) {
    setFlowSteps((current) =>
      current.map((step) =>
        step.id === stepId
          ? {
              ...step,
              type,
              config: defaultStepConfig(
                type,
                queues[0]?.id ?? "",
                assignableUsers[0]?.id ?? "",
              ),
            }
          : step,
      ),
    );
  }

  function updateFlowStepConfig(
    stepId: string,
    patch: NonNullable<LinearFlowStep["config"]>,
  ) {
    setFlowSteps((current) =>
      current.map((step) =>
        step.id === stepId
          ? { ...step, config: { ...step.config, ...patch } }
          : step,
      ),
    );
  }

  function removeFlowStep(stepId: string) {
    setFlowSteps((current) => current.filter((step) => step.id !== stepId));
  }

  function moveFlowStep(stepId: string, direction: -1 | 1) {
    setFlowSteps((current) => {
      const index = current.findIndex((step) => step.id === stepId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length)
        return current;
      const next = [...current];
      const [step] = next.splice(index, 1);
      next.splice(nextIndex, 0, step);
      return next;
    });
  }

  function strategyLabel(strategy: QueueStrategy) {
    return t(`strategies.${strategy}`);
  }

  function statusLabel(status: FlowStatus) {
    return t(`statuses.${status}`);
  }

  function actionLabel(type: LinearFlowActionType | string) {
    try {
      return t(`actions.${type}`);
    } catch {
      return type;
    }
  }

  function triggerLabel(trigger: string) {
    if (trigger === "message_inbound")
      return t("builder.visualTriggerSubtitle");
    if (trigger === "conversation_opened") return t("builder.visualTrigger");
    if (trigger === "conversation_idle") return t("builder.visualTriggerIdle");
    if (trigger === "ai_escalated")
      return t("builder.visualTriggerAiEscalated");
    return trigger;
  }

  function actionHelp(type: LinearFlowActionType) {
    return t(`builder.actionHelp.${type}`);
  }

  function contactFieldLabel(field: string) {
    switch (field) {
      case "contact.category":
        return t("builder.contactFields.category");
      case "contact.source":
        return t("builder.contactFields.source");
      case "contact.lifecycleStage":
        return t("builder.contactFields.lifecycleStage");
      case "contact.tags":
        return t("builder.contactFields.tags");
      default:
        return field;
    }
  }

  function lifecycleStageLabel(stage: string) {
    return t(`builder.lifecycleStages.${stage}`);
  }

  function stepConfigSummary(step: LinearFlowStep) {
    if (step.type === "assign_to_queue") {
      const queueId = step.config?.queueId;
      return queueId
        ? (queueById.get(queueId)?.name ?? queueId)
        : t("builder.noQueue");
    }
    if (step.type === "send_reply") {
      const text =
        typeof step.config?.text === "string" ? step.config.text : undefined;
      return textPreview(text, t("builder.replyPlaceholder"));
    }
    if (step.type === "menu") {
      const prompt =
        typeof step.config?.prompt === "string"
          ? step.config.prompt
          : undefined;
      const optionsText =
        typeof step.config?.optionsText === "string"
          ? step.config.optionsText
          : "";
      const optionCount = optionsText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length;
      return prompt
        ? `${textPreview(prompt, prompt)} · ${t("builder.menuOptionCount", { count: optionCount })}`
        : t("builder.menuPromptPlaceholder");
    }
    if (step.type === "ai_reply") {
      const prompt =
        typeof step.config?.userMessage === "string"
          ? step.config.userMessage
          : undefined;
      return textPreview(prompt, t("builder.actionHelp.ai_reply"));
    }
    if (step.type === "handoff_agent") {
      return userLabel(
        typeof step.config?.toUserId === "string"
          ? step.config.toUserId
          : undefined,
      );
    }
    if (step.type === "update_field") {
      const field =
        typeof step.config?.field === "string"
          ? step.config.field
          : "contact.lifecycleStage";
      const value =
        typeof step.config?.value === "string" ? step.config.value : undefined;
      return value
        ? `${contactFieldLabel(field)} → ${textPreview(value, value)}`
        : t("builder.updateFieldPlaceholder");
    }
    return actionHelp(step.type);
  }

  function stepIssueLabel(code: LinearFlowStepIssueCode) {
    return t(`builder.issues.${code}`);
  }

  function focusQueueName() {
    document.getElementById("queue-name")?.focus();
  }

  function focusNextSetupStep() {
    setActiveTab("builder");
    window.setTimeout(() => {
      focusSetupStep(currentSetupStep?.step ?? 1);
    }, 0);
  }

  function focusSetupStep(step: number) {
    if (step === 1) {
      focusQueueName();
      return;
    }
    const targetId =
      step === 2 ? "flow-name" : step === 3 ? "flow-channels" : "flow-actions";
    const target = document.getElementById(targetId);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement
    ) {
      target.focus();
    }
  }

  function userLabel(userId: string | undefined) {
    if (!userId) return t("builder.noUser");
    const user = userById.get(userId);
    return user?.name || user?.email || userId;
  }

  function actionSummary(action: GraphActionSummary) {
    const label = actionLabel(action.type);
    if (action.queueId) {
      return `${label} → ${queueById.get(action.queueId)?.name ?? action.queueId}`;
    }
    if (action.toUserId) {
      return `${label} → ${userLabel(action.toUserId)}`;
    }
    if (action.text) {
      return `${label}: ${textPreview(action.text, label)}`;
    }
    if (action.userMessage) {
      return `${label}: ${textPreview(action.userMessage, label)}`;
    }
    return label;
  }

  function actionSummaryDetail(action: GraphActionSummary) {
    if (action.queueId) {
      return queueById.get(action.queueId)?.name ?? action.queueId;
    }
    if (action.toUserId) {
      return userLabel(action.toUserId);
    }
    if (action.text) {
      return textPreview(action.text, actionLabel(action.type));
    }
    if (action.userMessage) {
      return textPreview(action.userMessage, actionLabel(action.type));
    }
    if (action.field) {
      return action.value
        ? `${contactFieldLabel(action.field)} → ${textPreview(
            action.value,
            action.value,
          )}`
        : contactFieldLabel(action.field);
    }
    if (action.channelType) {
      return action.channelType;
    }
    return t("visualEditor.stepRuns");
  }

  function graphActionToneClass(type: string) {
    return LINEAR_FLOW_ACTION_TYPES.includes(type as LinearFlowActionType)
      ? actionToneClass(type as LinearFlowActionType)
      : "bg-muted text-muted-foreground ring-border";
  }

  function graphActionIcon(type: string) {
    return LINEAR_FLOW_ACTION_TYPES.includes(type as LinearFlowActionType)
      ? actionIcon(type as LinearFlowActionType)
      : Activity;
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-28 animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between" data-tour-id="inbox-automation-header">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Workflow className="h-6 w-6 text-primary" />
            {t("title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HelpButton slug="inbox-automation" variant="label" />
          <Button
            variant="outline"
            onClick={() => setGuideOpen(true)}
            className="gap-2 self-start"
          >
            <BookOpen className="h-4 w-4" />
            {t("help.open")}
          </Button>
          <Button
            variant="outline"
            onClick={load}
            disabled={busy}
            className="gap-2 self-start"
          >
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            {t("refresh")}
          </Button>
        </div>
      </div>

      <Dialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        widthClassName="max-w-4xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <BookOpen className="h-5 w-5 text-primary" />
            {t("help.title")}
          </DialogTitle>
          <DialogDescription>{t("help.desc")}</DialogDescription>
        </DialogHeader>
        <DialogContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-2xl border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-3">
                <Badge variant="brand">{t("help.walkthroughBadge")}</Badge>
                <span className="text-xs text-muted-foreground">
                  {t("help.walkthroughNote")}
                </span>
              </div>
              <div className="mt-5 rounded-2xl border bg-background p-5">
                <div className="rounded-xl bg-gradient-to-br from-primary/10 via-background to-muted p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                      <BookOpen className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold">
                        {t("help.walkthroughTitle")}
                      </h3>
                      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                        {t("help.walkthroughDesc")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-2 sm:grid-cols-4">
                    {[1, 2, 3, 4].map((step) => (
                      <div
                        key={step}
                        className="rounded-xl bg-background/80 px-3 py-2 text-xs"
                      >
                        <span className="font-semibold text-primary">
                          {step}
                        </span>
                        <p className="mt-1 text-muted-foreground">
                          {t(`help.chapter${step}Title`)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className="rounded-xl border bg-background px-3 py-2"
                  >
                    <p className="text-xs font-semibold text-primary">
                      {t(`help.chapter${step}Title`)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(`help.chapter${step}Desc`)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border p-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">{t("help.quickTitle")}</h3>
                </div>
                <div className="mt-3 space-y-3 text-sm">
                  <div>
                    <p className="font-medium">{t("help.queueQuestion")}</p>
                    <p className="mt-1 text-muted-foreground">
                      {t("help.queueAnswer")}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium">{t("help.scenarioQuestion")}</p>
                    <p className="mt-1 text-muted-foreground">
                      {t("help.scenarioAnswer")}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium">{t("help.liveQuestion")}</p>
                    <p className="mt-1 text-muted-foreground">
                      {t("help.liveAnswer")}
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border bg-primary/5 p-4 text-sm">
                <p className="font-medium">{t("help.nextActionTitle")}</p>
                <p className="mt-1 text-muted-foreground">
                  {queues.length === 0
                    ? t("help.nextActionNoQueue")
                    : t("help.nextActionHasQueue")}
                </p>
                <Button
                  type="button"
                  className="mt-3 w-full gap-2"
                  onClick={() => {
                    setGuideOpen(false);
                    setActiveTab("builder");
                    if (queues.length === 0) {
                      window.setTimeout(focusQueueName, 0);
                    }
                  }}
                >
                  <MousePointerClick className="h-4 w-4" />
                  {queues.length === 0
                    ? t("builderGuide.createQueueCta")
                    : t("help.goToBuilder")}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setGuideOpen(false)}>
            {t("help.close")}
          </Button>
        </DialogFooter>
      </Dialog>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-tour-id="inbox-automation-safe-mode">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{t("safeModeTitle")}</p>
            <p className="mt-1 text-amber-800/90">{t("safeModeDesc")}</p>
          </div>
        </div>
      </div>

      {(error || notice) && (
        <div
          className={cn(
            "rounded-xl border p-3 text-sm",
            error
              ? isRecoverableLoadError
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700",
          )}
        >
          {statusMessage}
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as AutomationTab)}
        className="space-y-4"
      >
        <div className="flex flex-col gap-3 rounded-2xl border bg-card/80 p-2 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/40 p-1 sm:grid-cols-4 lg:w-auto" data-tour-id="inbox-automation-tabs">
            <TabsTrigger value="overview" className="gap-2 py-2" data-video-target="inbox-automation-tab-overview">
              <Workflow className="h-4 w-4" />
              {t("tabs.overview")}
            </TabsTrigger>
            <TabsTrigger value="builder" className="gap-2 py-2" data-video-target="inbox-automation-tab-builder">
              <Route className="h-4 w-4" />
              {t("tabs.builder")}
            </TabsTrigger>
            <TabsTrigger value="flows" className="gap-2 py-2" data-video-target="inbox-automation-tab-flows">
              <GitBranch className="h-4 w-4" />
              {t("tabs.flows")}
            </TabsTrigger>
            <TabsTrigger value="runs" className="gap-2 py-2" data-video-target="inbox-automation-tab-runs">
              <Activity className="h-4 w-4" />
              {t("tabs.runs")}
            </TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-2 px-2 text-xs text-muted-foreground">
            <Badge variant="outline">
              {t("builder.visualTriggerSubtitle")}
            </Badge>
            <Badge variant="secondary">{t("stats.flagOff")}</Badge>
            <span>{t("tabs.navHint")}</span>
          </div>
        </div>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]" data-tour-id="inbox-automation-stats">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("stats.queues")}</CardDescription>
                <CardTitle className="text-3xl">{queues.length}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {t("stats.activeQueues", { count: activeQueues })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("stats.flows")}</CardDescription>
                <CardTitle className="text-3xl">{flows.length}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {t("stats.activeFlows", { count: activeFlows })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("stats.liveFlag")}</CardDescription>
                <CardTitle className="text-lg text-amber-600">
                  {t("stats.flagOff")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {t("stats.flagDesc")}
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.06] via-card to-background" data-tour-id="inbox-automation-quickstart">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <Badge variant="brand">
                    {t("overview.quickStartEyebrow")}
                  </Badge>
                  <CardTitle className="mt-3 text-base">
                    {t("overview.quickStartTitle")}
                  </CardTitle>
                  <CardDescription className="mt-1 max-w-3xl">
                    {t("overview.quickStartDesc")}
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setGuideOpen(true)}
                  className="gap-2 self-start bg-background/80"
                >
                  <BookOpen className="h-4 w-4" />
                  {t("templates.videoCta")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
                {FEATURED_FLOW_TEMPLATE_IDS.map((templateId) => {
                  const Icon = flowTemplateIcon(templateId);
                  return (
                    <button
                      key={templateId}
                      type="button"
                      onClick={() => applyFlowTemplate(templateId)}
                      className="group rounded-2xl border bg-background/90 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-sm font-semibold leading-snug">
                            {t(`templates.${templateId}.title`)}
                          </p>
                          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                            {t(`templates.${templateId}.desc`)}
                          </p>
                        </div>
                      </div>
                      <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                        {t("templates.quickUse")}
                        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
              {queues.length === 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                  {t("overview.quickStartNoQueue")}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GitBranch className="h-4 w-4 text-primary" />
                {t("overview.flowSnapshot")}
              </CardTitle>
              <CardDescription>
                {t("overview.flowSnapshotDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {flows.length === 0 ? (
                <div className="rounded-2xl border border-dashed bg-muted/20 p-5 text-sm">
                  <p className="font-semibold text-foreground">
                    {t("overview.emptySnapshotTitle")}
                  </p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    {t("overview.emptySnapshotDesc")}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTab("builder")}
                    className="mt-4 gap-2 bg-background"
                  >
                    <Plus className="h-4 w-4" />
                    {t("flows.startFromScratch")}
                  </Button>
                </div>
              ) : (
                flows.slice(0, 3).map((flow) => (
                  <button
                    key={flow.id}
                    type="button"
                    onClick={() => {
                      setSelectedVisualFlowId(flow.id);
                      setActiveTab("flows");
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition hover:border-primary/40 hover:bg-muted/30"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="line-clamp-2 break-words font-medium">
                          {flow.name}
                        </span>
                        <Badge
                          variant={
                            flow.status === "active"
                              ? "success"
                              : flow.status === "paused"
                                ? "warning"
                                : "secondary"
                          }
                        >
                          {statusLabel(flow.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
                        {flow.channelTypes.length
                          ? flow.channelTypes.join(", ")
                          : t("flows.allChannels")}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="builder" className="space-y-4">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border bg-card p-3 shadow-sm sm:p-4" data-tour-id="inbox-automation-builder">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <Badge variant="brand">{t("builderGuide.eyebrow")}</Badge>
                <h2 className="mt-3 text-lg font-semibold">
                  {t("builderGuide.title")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("builderGuide.desc")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setGuideOpen(true)}
                className="gap-2 self-start"
              >
                <BookOpen className="h-4 w-4" />
                {t("builderGuide.helpCta")}
              </Button>
            </div>
            <div className="mt-4 rounded-2xl border border-primary/15 bg-primary/[0.03] p-3 sm:p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl">
                  <p className="text-sm font-semibold">
                    {t("templates.quickPickTitle")}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("templates.quickPickDesc")}
                  </p>
                </div>
                {queues.length === 0 ? (
                  <Badge variant="warning" className="w-fit">
                    {t("templates.quickPickQueueMissing")}
                  </Badge>
                ) : (
                  <Badge variant="success" className="w-fit">
                    {t("templates.quickPickReady")}
                  </Badge>
                )}
              </div>
              <div className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]">
                {FLOW_TEMPLATE_IDS.map((templateId) => {
                  const Icon = flowTemplateIcon(templateId);
                  return (
                    <button
                      key={templateId}
                      type="button"
                      onClick={() => applyFlowTemplate(templateId)}
                      className="group flex min-w-0 items-center gap-2 rounded-xl border bg-background px-3 py-2 text-left text-sm transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="line-clamp-1 font-medium">
                          {t(`templates.${templateId}.title`)}
                        </span>
                        <span className="mt-0.5 block line-clamp-1 text-xs text-muted-foreground">
                          {t(`templates.${templateId}.cta`)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-4 rounded-2xl border bg-background/80 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{t("setup.title")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("setup.desc")}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit">
                  {t("setup.safe")}
                </Badge>
              </div>
              <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {currentSetupStep
                        ? t("setup.currentActionTitle", {
                            step: currentSetupStep.step,
                            title: currentSetupStep.title,
                          })
                        : t("setup.completeTitle")}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {currentSetupStep
                        ? currentSetupStep.desc
                        : t("setup.completeDesc")}
                    </p>
                  </div>
                  {currentSetupStep && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={focusNextSetupStep}
                      className="w-full gap-2 sm:w-auto"
                    >
                      <MousePointerClick className="h-4 w-4" />
                      {t("setup.currentActionCta")}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {missingRequiredQueue && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {t("builderGuide.queueFirstTitle")}
                    </p>
                    <p className="mt-1 text-amber-800/90">
                      {t("builderGuide.queueFirstDesc")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={focusQueueName}
                    className="gap-2 self-start"
                  >
                    <MousePointerClick className="h-4 w-4" />
                    {t("builderGuide.createQueueCta")}
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-6">
              <Card className="min-w-0 overflow-hidden" data-tour-id="inbox-automation-queue">
                <CardHeader className="px-3 pt-4 sm:p-6">
                  <CardTitle className="flex items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      1
                    </span>
                    <Users className="h-5 w-5 text-primary" />
                    {t("queues.title")}
                  </CardTitle>
                  <CardDescription>{t("queues.desc")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 px-3 pb-4 pt-0 sm:px-6 sm:pb-6">
                  <form
                    onSubmit={createQueue}
                    className="grid min-w-0 gap-4 rounded-xl border bg-muted/20 p-3 sm:p-4"
                    data-video-target="inbox-automation-queue-form"
                  >
                    <div className="min-w-0 space-y-1.5">
                      <Label htmlFor="queue-name">{t("queues.name")}</Label>
                      <Input
                        id="queue-name"
                        value={queueName}
                        onChange={(e) => setQueueName(e.target.value)}
                        placeholder={t("queues.namePlaceholder")}
                        className="w-full"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("queues.nameHelp")}
                      </p>
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <Label htmlFor="queue-skills">{t("queues.skills")}</Label>
                      <Input
                        id="queue-skills"
                        value={queueSkills}
                        onChange={(e) => setQueueSkills(e.target.value)}
                        placeholder={t("queues.skillsPlaceholder")}
                        className="w-full"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("queues.skillsHelp")}
                      </p>
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <Label htmlFor="queue-strategy">
                        {t("queues.strategy")}
                      </Label>
                      <select
                        id="queue-strategy"
                        value={queueStrategy}
                        onChange={(e) =>
                          setQueueStrategy(e.target.value as QueueStrategy)
                        }
                        className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {QUEUE_STRATEGIES.map((strategy) => (
                          <option key={strategy} value={strategy}>
                            {strategyLabel(strategy)}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        {t("queues.strategyHelp")}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 rounded-lg bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-h-10 items-center gap-2">
                        <Switch
                          checked={queueIsActive}
                          onCheckedChange={setQueueIsActive}
                        />
                        <span className="text-sm">{t("queues.active")}</span>
                      </div>
                      <Button
                        type="submit"
                        disabled={busy || !queueName.trim()}
                        className="w-full gap-2 sm:w-auto"
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        {t("queues.create")}
                      </Button>
                    </div>
                  </form>

                  <div className="space-y-3">
                    {queues.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                        <p>{t("queues.empty")}</p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={focusQueueName}
                          className="mt-4 gap-2"
                        >
                          <MousePointerClick className="h-4 w-4" />
                          {t("builderGuide.createQueueCta")}
                        </Button>
                      </div>
                    ) : (
                      queues.map((queue) => (
                        <div
                          key={queue.id}
                          className="min-w-0 rounded-lg border p-4"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-semibold">{queue.name}</h3>
                                <Badge
                                  variant={
                                    queue.isActive ? "success" : "secondary"
                                  }
                                >
                                  {queue.isActive
                                    ? t("queues.active")
                                    : t("queues.paused")}
                                </Badge>
                                <Badge variant="outline">
                                  {strategyLabel(queue.strategy)}
                                </Badge>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {queue.skillTags.length === 0 ? (
                                  <Badge variant="secondary">
                                    {t("queues.anySkill")}
                                  </Badge>
                                ) : (
                                  queue.skillTags.map((tag) => (
                                    <Badge key={tag} variant="outline">
                                      {tag}
                                    </Badge>
                                  ))
                                )}
                              </div>
                              {queue.lastAssignedTo && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  {t("queues.lastAssigned", {
                                    id: queue.lastAssignedTo,
                                  })}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => toggleQueue(queue)}
                              >
                                {queue.isActive
                                  ? t("queues.pause")
                                  : t("queues.activate")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => deleteQueue(queue)}
                                className="text-red-600 hover:text-red-700"
                                aria-label={t("queues.deleteAria", {
                                  name: queue.name,
                                })}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="min-w-0 overflow-hidden">
                <CardHeader className="px-3 pt-4 sm:p-6">
                  <CardTitle className="flex items-center gap-2">
                    <Route className="h-5 w-5 text-primary" />
                    {t("builder.title")}
                  </CardTitle>
                  <CardDescription>{t("builder.desc")}</CardDescription>
                </CardHeader>
                <CardContent className="px-3 pb-4 pt-0 sm:px-6 sm:pb-6">
                  {missingRequiredQueue && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <p className="font-medium">
                        {t("builderGuide.builderBlockedTitle")}
                      </p>
                      <p className="mt-1 text-amber-800/90">
                        {t("builderGuide.builderBlockedDesc")}
                      </p>
                    </div>
                  )}
                  <form onSubmit={createLinearFlow} className="space-y-5">
                    <section
                      id="flow-scenario"
                      className="rounded-2xl border bg-muted/10 p-4 sm:p-5"
                      data-tour-id="inbox-automation-scenario"
                    >
                      <div className="mb-4 flex items-start gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                          2
                        </span>
                        <div>
                          <p className="font-semibold">
                            {t("builderGuide.step2Title")}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t("builderGuide.step2Desc")}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="flow-name">{t("builder.name")}</Label>
                          <Input
                            id="flow-name"
                            value={flowName}
                            onChange={(e) => setFlowName(e.target.value)}
                            placeholder={t("builder.namePlaceholder")}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="flow-status">
                            {t("builder.status")}
                          </Label>
                          <select
                            id="flow-status"
                            value={flowStatus}
                            onChange={(e) =>
                              setFlowStatus(e.target.value as FlowStatus)
                            }
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            {FLOW_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {statusLabel(status)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="rounded-lg border bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                          <p className="font-medium text-foreground">
                            {t("builder.runtime")}
                          </p>
                          <p className="mt-1 leading-relaxed">
                            {t("builder.runtimeDesc")}
                          </p>
                        </div>
                      </div>
                    </section>

                    <section
                      id="flow-channels"
                      className="rounded-2xl border bg-muted/10 p-4 sm:p-5"
                    >
                      <div className="mb-4 flex items-start gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                          3
                        </span>
                        <div>
                          <p className="font-semibold">
                            {t("builderGuide.step3Title")}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t("builder.channelHint")}
                          </p>
                        </div>
                      </div>
                      <Label>{t("builder.channels")}</Label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {CHANNELS.map((channel) => {
                          const selected = flowChannels.includes(channel);
                          return (
                            <button
                              key={channel}
                              type="button"
                              onClick={() => toggleChannel(channel)}
                              className={cn(
                                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                                selected
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground",
                              )}
                            >
                              {channel}
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    <section
                      id="flow-actions"
                      className="rounded-2xl border bg-muted/10 p-4 sm:p-5"
                      data-tour-id="inbox-automation-actions"
                    >
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                            4
                          </span>
                          <div>
                            <p className="font-semibold">
                              {t("builderGuide.step4Title")}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {t("builder.stepsHint")}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mb-4 grid gap-2">
                        {LINEAR_FLOW_ACTION_TYPES.map((type) => {
                          const ActionIcon = actionIcon(type);
                          return (
                            <button
                              key={type}
                              type="button"
                              onClick={() => addFlowStep(type)}
                              className="group flex min-h-24 items-start gap-3 rounded-2xl border bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            >
                              <span
                                className={cn(
                                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 transition group-hover:scale-105",
                                  actionToneClass(type),
                                )}
                              >
                                <ActionIcon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold text-foreground">
                                  {actionLabel(type)}
                                </span>
                                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                                  {actionHelp(type)}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="space-y-3">
                        {flowSteps.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                            {t("builder.noSteps")}
                          </div>
                        ) : (
                          flowSteps.map((step, index) => {
                            const Icon = actionIcon(step.type);
                            const issue = flowStepIssueById.get(step.id);
                            return (
                              <div
                                key={step.id}
                                className={cn(
                                  "overflow-hidden rounded-2xl border bg-card shadow-sm",
                                  issue &&
                                    "border-destructive/30 bg-destructive/5",
                                )}
                              >
                                <div className="border-b bg-muted/40 p-3">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="flex min-w-0 gap-3">
                                      <div
                                        className={cn(
                                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ring-1",
                                          actionToneClass(step.type),
                                        )}
                                      >
                                        {index + 1}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                          <Icon className="h-4 w-4 text-primary" />
                                          <span>{actionLabel(step.type)}</span>
                                        </div>
                                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                          {actionHelp(step.type)}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={index === 0}
                                        onClick={() =>
                                          moveFlowStep(step.id, -1)
                                        }
                                        aria-label={t("builder.moveUp")}
                                      >
                                        <ArrowUp className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={
                                          index === flowSteps.length - 1
                                        }
                                        onClick={() => moveFlowStep(step.id, 1)}
                                        aria-label={t("builder.moveDown")}
                                      >
                                        <ArrowDown className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeFlowStep(step.id)}
                                        className="text-red-600 hover:text-red-700"
                                        aria-label={t("builder.removeStep")}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-4 p-3 sm:p-4">
                                  <div className="space-y-1.5">
                                    <Label>{t("builder.actionType")}</Label>
                                    <select
                                      value={step.type}
                                      onChange={(e) =>
                                        updateFlowStepType(
                                          step.id,
                                          e.target
                                            .value as LinearFlowActionType,
                                        )
                                      }
                                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                      {LINEAR_FLOW_ACTION_TYPES.map((type) => (
                                        <option key={type} value={type}>
                                          {actionLabel(type)}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {step.type === "assign_to_queue" && (
                                    <div className="space-y-1.5">
                                      <Label>{t("builder.queue")}</Label>
                                      <select
                                        value={step.config?.queueId ?? ""}
                                        onChange={(e) =>
                                          updateFlowStepConfig(step.id, {
                                            queueId: e.target.value,
                                          })
                                        }
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                      >
                                        <option value="">
                                          {t("builder.selectQueue")}
                                        </option>
                                        {queues.map((queue) => (
                                          <option
                                            key={queue.id}
                                            value={queue.id}
                                          >
                                            {queue.name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  )}

                                  {step.type === "send_reply" && (
                                    <div className="space-y-1.5">
                                      <Label>{t("builder.replyText")}</Label>
                                      <Textarea
                                        value={step.config?.text ?? ""}
                                        onChange={(e) =>
                                          updateFlowStepConfig(step.id, {
                                            text: e.target.value,
                                          })
                                        }
                                        placeholder={t(
                                          "builder.replyPlaceholder",
                                        )}
                                        rows={3}
                                      />
                                    </div>
                                  )}

                                  {step.type === "menu" && (
                                    <div className="space-y-3">
                                      <div className="space-y-1.5">
                                        <Label>{t("builder.menuPrompt")}</Label>
                                        <Textarea
                                          value={step.config?.prompt ?? ""}
                                          onChange={(e) =>
                                            updateFlowStepConfig(step.id, {
                                              prompt: e.target.value,
                                            })
                                          }
                                          placeholder={t(
                                            "builder.menuPromptPlaceholder",
                                          )}
                                          rows={3}
                                        />
                                      </div>
                                      <div className="space-y-1.5">
                                        <Label>{t("builder.menuOptions")}</Label>
                                        <Textarea
                                          value={step.config?.optionsText ?? ""}
                                          onChange={(e) =>
                                            updateFlowStepConfig(step.id, {
                                              optionsText: e.target.value,
                                            })
                                          }
                                          placeholder={t(
                                            "builder.menuOptionsPlaceholder",
                                          )}
                                          rows={4}
                                        />
                                        <p className="text-xs leading-relaxed text-muted-foreground">
                                          {t("builder.menuOptionsHint")}
                                        </p>
                                      </div>
                                    </div>
                                  )}

                                  {step.type === "ai_reply" && (
                                    <div className="space-y-1.5">
                                      <Label>{t("builder.aiMessage")}</Label>
                                      <Textarea
                                        value={step.config?.userMessage ?? ""}
                                        onChange={(e) =>
                                          updateFlowStepConfig(step.id, {
                                            userMessage: e.target.value,
                                          })
                                        }
                                        placeholder={t(
                                          "builder.aiMessagePlaceholder",
                                        )}
                                        rows={2}
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        {t("builder.aiMessageHint")}
                                      </p>
                                    </div>
                                  )}

                                  {step.type === "handoff_agent" && (
                                    <div className="space-y-3">
                                      <div className="space-y-1.5">
                                        <Label>{t("builder.agent")}</Label>
                                        {assignableUsers.length === 0 ? (
                                          <Input
                                            value={step.config?.toUserId ?? ""}
                                            onChange={(e) =>
                                              updateFlowStepConfig(step.id, {
                                                toUserId: e.target.value,
                                              })
                                            }
                                            placeholder={t(
                                              "builder.userIdPlaceholder",
                                            )}
                                          />
                                        ) : (
                                          <select
                                            value={step.config?.toUserId ?? ""}
                                            onChange={(e) =>
                                              updateFlowStepConfig(step.id, {
                                                toUserId: e.target.value,
                                              })
                                            }
                                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                          >
                                            <option value="">
                                              {t("builder.selectAgent")}
                                            </option>
                                            {assignableUsers.map((user) => (
                                              <option
                                                key={user.id}
                                                value={user.id}
                                              >
                                                {user.name ||
                                                  user.email ||
                                                  user.id}
                                              </option>
                                            ))}
                                          </select>
                                        )}
                                      </div>
                                      <div className="space-y-1.5">
                                        <Label>
                                          {t("builder.handoffReason")}
                                        </Label>
                                        <Textarea
                                          value={step.config?.reason ?? ""}
                                          onChange={(e) =>
                                            updateFlowStepConfig(step.id, {
                                              reason: e.target.value,
                                            })
                                          }
                                          placeholder={t(
                                            "builder.handoffReasonPlaceholder",
                                          )}
                                          rows={2}
                                        />
                                      </div>
                                    </div>
                                  )}

                                  {step.type === "update_field" && (
                                    <div className="space-y-3">
                                      <div className="rounded-xl border border-teal-100 bg-teal-50/50 px-3 py-2 text-xs leading-relaxed text-teal-800">
                                        {t("builder.updateFieldHint")}
                                      </div>
                                      <div className="grid gap-3">
                                        <div className="space-y-1.5">
                                          <Label>
                                            {t("builder.updateFieldTarget")}
                                          </Label>
                                          <select
                                            value={
                                              step.config?.field ??
                                              "contact.lifecycleStage"
                                            }
                                            onChange={(e) =>
                                              updateFlowStepConfig(step.id, {
                                                field: e.target.value,
                                                value: "",
                                              })
                                            }
                                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                          >
                                            {CONTACT_UPDATE_FIELDS.map(
                                              (field) => (
                                                <option
                                                  key={field}
                                                  value={field}
                                                >
                                                  {contactFieldLabel(field)}
                                                </option>
                                              ),
                                            )}
                                          </select>
                                        </div>
                                        <div className="space-y-1.5">
                                          <Label>
                                            {t("builder.updateFieldValue")}
                                          </Label>
                                          {step.config?.field ===
                                          "contact.lifecycleStage" ? (
                                            <select
                                              value={step.config?.value ?? ""}
                                              onChange={(e) =>
                                                updateFlowStepConfig(step.id, {
                                                  value: e.target.value,
                                                })
                                              }
                                              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                            >
                                              <option value="">
                                                {t(
                                                  "builder.selectLifecycleStage",
                                                )}
                                              </option>
                                              {CONTACT_LIFECYCLE_STAGE_OPTIONS.map(
                                                (stage) => (
                                                  <option
                                                    key={stage}
                                                    value={stage}
                                                  >
                                                    {lifecycleStageLabel(stage)}
                                                  </option>
                                                ),
                                              )}
                                            </select>
                                          ) : (
                                            <Input
                                              value={step.config?.value ?? ""}
                                              onChange={(e) =>
                                                updateFlowStepConfig(step.id, {
                                                  value: e.target.value,
                                                })
                                              }
                                              placeholder={
                                                step.config?.field ===
                                                "contact.tags"
                                                  ? t(
                                                      "builder.updateFieldTagsPlaceholder",
                                                    )
                                                  : t(
                                                      "builder.updateFieldValuePlaceholder",
                                                    )
                                              }
                                            />
                                          )}
                                          <p className="text-xs text-muted-foreground">
                                            {step.config?.field ===
                                            "contact.tags"
                                              ? t("builder.updateFieldTagsHelp")
                                              : t(
                                                  "builder.updateFieldValueHelp",
                                                )}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {issue && (
                                    <p className="rounded-lg border border-destructive/20 bg-background px-3 py-2 text-xs font-medium text-destructive">
                                      {issue === "missing_queue" &&
                                      queues.length === 0
                                        ? t(
                                            "builder.issues.missing_queue_create_first",
                                          )
                                        : stepIssueLabel(issue)}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </section>
                    {(unsupportedSendReplyChannels.length > 0 ||
                      unsupportedAiReplyChannels.length > 0) && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                        {unsupportedSendReplyChannels.length > 0 && (
                          <p>
                            {t("builder.unsupportedSendReplyChannels", {
                              channels: unsupportedSendReplyChannels.join(", "),
                            })}
                          </p>
                        )}
                        {unsupportedAiReplyChannels.length > 0 && (
                          <p>
                            {t("builder.unsupportedAiReplyChannels", {
                              channels: unsupportedAiReplyChannels.join(", "),
                            })}
                          </p>
                        )}
                      </div>
                    )}
                    <section className="rounded-2xl border bg-card p-4 text-sm shadow-sm" data-tour-id="inbox-automation-preview">
                      <div className="flex items-center gap-2 text-foreground">
                        <Bot className="h-4 w-4 text-primary" />
                        <span className="font-medium">
                          {t("builder.preview")}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold text-muted-foreground ring-1 ring-border">
                            0
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">
                              {t("builder.visualTrigger")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("builder.visualTriggerSubtitle")}
                            </p>
                          </div>
                        </div>
                        {flowSteps.map((step, index) => {
                          const PreviewIcon = actionIcon(step.type);
                          return (
                            <div
                              key={`preview-${step.id}`}
                              className="flex items-start gap-3 rounded-xl border bg-muted/30 px-3 py-2"
                            >
                              <span
                                className={cn(
                                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1",
                                  actionToneClass(step.type),
                                )}
                              >
                                {index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 font-medium text-foreground">
                                  <PreviewIcon className="h-3.5 w-3.5 text-primary" />
                                  <span>{actionLabel(step.type)}</span>
                                </div>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {stepConfigSummary(step)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                        <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-emerald-900">
                              {t("builder.visualEnd")}
                            </p>
                            <p className="text-xs text-emerald-700">
                              {t("builder.visualEndSubtitle")}
                            </p>
                          </div>
                        </div>
                      </div>
                    </section>
                    <section className="rounded-2xl border bg-muted/20 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <GitBranch className="h-4 w-4 text-primary" />
                        <span>{t("builder.visualTitle")}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("builder.visualDesc")}
                      </p>
                      <ConversationFlowCanvas
                        graph={draftFlowGraph}
                        labels={flowVisualLabels}
                        className="mt-3"
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t("builder.visualHint")}
                      </p>
                    </section>
                    <Button
                      type="submit"
                      disabled={busy || !canCreateFlow}
                      className="w-full gap-2"
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <GitBranch className="h-4 w-4" />
                      )}
                      {t("builder.create")}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="flows" className="space-y-4">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
            <div className="rounded-2xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  1
                </div>
                <div>
                  <p className="font-medium">{t("flows.guide.pickTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("flows.guide.pickDesc")}
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  2
                </div>
                <div>
                  <p className="font-medium">{t("flows.guide.editTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("flows.guide.editDesc")}
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                  3
                </div>
                <div>
                  <p className="font-medium">{t("flows.guide.testTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("flows.guide.testDesc")}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-6">
            <Card>
              <CardHeader className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <GitBranch className="h-5 w-5 text-primary" />
                      {t("flows.title")}
                    </CardTitle>
                    <CardDescription>{t("flows.desc")}</CardDescription>
                  </div>
                  <Button
                    type="button"
                    onClick={() => setActiveTab("builder")}
                    className="gap-2 self-start"
                  >
                    <Plus className="h-4 w-4" />
                    {t("flows.addFlow")}
                  </Button>
                </div>
                <Input
                  value={flowSearch}
                  onChange={(event) => setFlowSearch(event.target.value)}
                  placeholder={t("flows.searchPlaceholder")}
                  aria-label={t("flows.searchAria")}
                />
              </CardHeader>
              <CardContent className="space-y-3">
                {flows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm">
                    <div className="mx-auto flex max-w-xl flex-col items-center text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <GitBranch className="h-6 w-6" />
                      </div>
                      <p className="mt-4 text-base font-semibold text-foreground">
                        {t("flows.emptyTitle")}
                      </p>
                      <p className="mt-2 leading-relaxed text-muted-foreground">
                        {t("flows.emptyDesc")}
                      </p>
                      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          onClick={() =>
                            applyFlowTemplate("whatsapp_business_intake")
                          }
                          className="gap-2"
                        >
                          <Workflow className="h-4 w-4" />
                          {t("flows.useSuggested")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setActiveTab("builder")}
                          className="gap-2 bg-background"
                        >
                          <Plus className="h-4 w-4" />
                          {t("flows.startFromScratch")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : filteredFlows.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {t("flows.noSearchResults")}
                  </div>
                ) : (
                  filteredFlows.map((flow) => {
                    const actions = extractGraphActionSummaries(flow.graph);
                    const isSelected = selectedVisualFlow?.id === flow.id;
                    return (
                      <article
                        key={flow.id}
                        className={cn(
                          "group relative overflow-hidden rounded-[1.35rem] border bg-background p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md",
                          isSelected
                            ? "border-primary/45 bg-gradient-to-br from-primary/10 via-background to-primary/5 ring-1 ring-primary/15"
                            : "border-border/70 hover:bg-muted/20",
                        )}
                      >
                        <div className="pointer-events-none absolute -right-16 -top-16 h-32 w-32 rounded-full bg-primary/10 blur-3xl opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                        <div className="relative grid gap-4 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-start">
                          <div className="min-w-0 space-y-4">
                            <div className="flex min-w-0 items-start gap-3">
                              <div
                                className={cn(
                                  "mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-colors",
                                  isSelected
                                    ? "border-primary/30 bg-primary text-primary-foreground shadow-sm"
                                    : "border-border bg-muted/50 text-muted-foreground",
                                )}
                              >
                                <GitBranch className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  {isSelected && (
                                    <Badge
                                      variant="brand"
                                      className="rounded-full px-2.5 py-0.5"
                                    >
                                      {t("flows.selected")}
                                    </Badge>
                                  )}
                                  <Badge
                                    variant={
                                      flow.status === "active"
                                        ? "success"
                                        : flow.status === "paused"
                                          ? "warning"
                                          : "secondary"
                                    }
                                    className="rounded-full px-2.5 py-0.5"
                                  >
                                    {statusLabel(flow.status)}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className="rounded-full px-2.5 py-0.5 font-mono text-[11px] tabular-nums"
                                  >
                                    v{flow.version}
                                  </Badge>
                                </div>
                                <h3 className="mt-2 line-clamp-2 break-words text-base font-semibold leading-snug tracking-tight text-foreground sm:text-lg">
                                  {flow.name}
                                </h3>
                                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Clock3 className="h-3.5 w-3.5 shrink-0" />
                                  {t("flows.updatedAt", {
                                    date: formatDateTime(flow.updatedAt),
                                  })}
                                </p>
                              </div>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                              <div className="min-w-0 rounded-2xl border border-border/70 bg-muted/35 px-3 py-2.5">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {t("visualEditor.triggerLabel")}
                                </p>
                                <p className="mt-1 line-clamp-2 break-words text-sm font-medium text-foreground">
                                  {triggerLabel(flow.trigger)}
                                </p>
                              </div>
                              <div className="hidden h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary sm:flex">
                                <ArrowRight className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 rounded-2xl border border-border/70 bg-muted/35 px-3 py-2.5">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {t("visualEditor.channelsLabel")}
                                </p>
                                <p className="mt-1 line-clamp-2 break-words text-sm font-medium text-foreground">
                                  {flow.channelTypes.length
                                    ? flow.channelTypes.join(", ")
                                    : t("flows.allChannels")}
                                </p>
                              </div>
                            </div>

                            <div className="rounded-2xl border border-border/70 bg-background/70 px-3 py-3">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                {t("flows.actionsTitle")}
                              </p>
                              <div className="mt-3 space-y-2">
                                {actions.length === 0 ? (
                                  <span className="inline-flex max-w-full items-center rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                    {t("flows.noActions")}
                                  </span>
                                ) : (
                                  actions.map((action, index) => {
                                    const summary = actionSummary(action);
                                    const ActionIcon = graphActionIcon(
                                      action.type,
                                    );
                                    return (
                                      <div
                                        key={`${flow.id}-${action.type}-${index}`}
                                        title={summary}
                                        className="grid gap-2 rounded-xl border bg-muted/20 p-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start"
                                      >
                                        <span
                                          className={cn(
                                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1",
                                            graphActionToneClass(action.type),
                                          )}
                                        >
                                          {index + 1}
                                        </span>
                                        <span className="min-w-0">
                                          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                                            <ActionIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                                            <span className="line-clamp-2 break-words">
                                              {actionLabel(action.type)}
                                            </span>
                                          </span>
                                          <span className="mt-1 block line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">
                                            {actionSummaryDetail(action)}
                                          </span>
                                        </span>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2 2xl:justify-end">
                            <select
                              value={flow.status}
                              onChange={(e) =>
                                updateFlowStatus(
                                  flow,
                                  e.target.value as FlowStatus,
                                )
                              }
                              disabled={busy}
                              aria-label={t("flows.statusAria", {
                                name: flow.name,
                              })}
                              className="h-10 min-w-[9rem] rounded-xl border border-input bg-background/90 px-3 text-sm shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {FLOW_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {statusLabel(status)}
                                </option>
                              ))}
                            </select>
                            <Button
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                setSelectedVisualFlowId(flow.id);
                                setActiveTab("flows");
                              }}
                              className={cn(
                                "h-10 gap-2 rounded-xl px-4 shadow-sm transition active:scale-[0.98]",
                                !isSelected &&
                                  "border-primary/20 bg-background hover:bg-primary/10",
                              )}
                            >
                              <GitBranch className="h-4 w-4" />
                              {t("visualEditor.open")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => deleteFlow(flow)}
                              className="h-10 w-10 rounded-xl border border-transparent p-0 text-muted-foreground hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                              aria-label={t("flows.deleteAria", {
                                name: flow.name,
                              })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </CardContent>
            </Card>
            <Card className="overflow-hidden border-primary/10 bg-gradient-to-br from-background via-card to-primary/5 shadow-sm">
              <CardHeader className="border-b bg-background/75">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <GitBranch className="h-5 w-5 text-primary" />
                      {t("visualEditor.title")}
                    </CardTitle>
                    <CardDescription className="mt-1 max-w-2xl">
                      {t("visualEditor.desc")}
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className="w-fit rounded-full bg-background px-3 py-1 text-xs"
                  >
                    {t("stats.liveFlag")}: {t("stats.flagOff")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {flows.length === 0 || !selectedVisualFlow ? (
                  <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    <p>{t("visualEditor.empty")}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setActiveTab("builder")}
                      className="mt-4"
                    >
                      {t("flows.startFromScratch")}
                    </Button>
                  </div>
                ) : (
                  <>
                    <section className="overflow-hidden rounded-[1.35rem] border bg-background shadow-sm">
                      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
                        <div className="space-y-5 p-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                                {t("visualEditor.nowEditing")}
                              </p>
                              <h3 className="mt-2 line-clamp-2 text-xl font-semibold leading-tight tracking-tight">
                                {selectedVisualFlow.name}
                              </h3>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              <Badge
                                variant={
                                  selectedVisualFlow.status === "active"
                                    ? "success"
                                    : selectedVisualFlow.status === "paused"
                                      ? "warning"
                                      : "secondary"
                                }
                                className="rounded-full px-3 py-1"
                              >
                                {statusLabel(selectedVisualFlow.status)}
                              </Badge>
                              <Badge
                                variant="outline"
                                className="rounded-full px-3 py-1 font-mono text-[11px] tabular-nums"
                              >
                                v{selectedVisualFlow.version}
                              </Badge>
                            </div>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                            <div className="min-w-0 rounded-2xl bg-muted/45 px-3 py-3">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                {t("visualEditor.triggerLabel")}
                              </p>
                              <p className="mt-1 line-clamp-2 break-words text-sm font-semibold">
                                {triggerLabel(selectedVisualFlow.trigger)}
                              </p>
                            </div>
                            <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm sm:flex">
                              <ArrowRight className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 rounded-2xl bg-muted/45 px-3 py-3">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                {t("visualEditor.actionsLabel")}
                              </p>
                              <div className="mt-2 space-y-2">
                                {selectedVisualFlowActions.length === 0 ? (
                                  <p className="text-sm font-semibold text-muted-foreground">
                                    {t("visualEditor.noActionsHint")}
                                  </p>
                                ) : (
                                  selectedVisualFlowActions
                                    .slice(0, 3)
                                    .map((action, index) => {
                                      const ActionIcon = graphActionIcon(
                                        action.type,
                                      );
                                      return (
                                        <div
                                          key={`${selectedVisualFlow.id}-${action.type}-${index}`}
                                          className="grid gap-2 rounded-xl bg-background/75 p-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start"
                                        >
                                          <span
                                            className={cn(
                                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1",
                                              graphActionToneClass(action.type),
                                            )}
                                          >
                                            {index + 1}
                                          </span>
                                          <span className="min-w-0">
                                            <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                                              <ActionIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                                              <span className="line-clamp-2 break-words">
                                                {actionLabel(action.type)}
                                              </span>
                                            </span>
                                            <span className="mt-1 block line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">
                                              {actionSummaryDetail(action)}
                                            </span>
                                          </span>
                                        </div>
                                      );
                                    })
                                )}
                                {selectedVisualFlowActions.length > 3 && (
                                  <p className="text-xs font-medium text-muted-foreground">
                                    {t("visualEditor.moreActions", {
                                      count:
                                        selectedVisualFlowActions.length - 3,
                                    })}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Badge
                              variant="outline"
                              className="max-w-full whitespace-normal rounded-full text-left leading-relaxed"
                            >
                              {t("visualEditor.channelsLabel")}:{" "}
                              {selectedVisualFlow.channelTypes.length
                                ? selectedVisualFlow.channelTypes.join(", ")
                                : t("flows.allChannels")}
                            </Badge>
                            <Badge variant="outline" className="rounded-full">
                              {t("visualEditor.actionCount", {
                                count: selectedVisualFlowActions.length,
                              })}
                            </Badge>
                          </div>
                        </div>

                        <aside className="border-t bg-primary/5 p-5 lg:border-l lg:border-t-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                            {t("visualEditor.nextStepTitle")}
                          </p>
                          <h4 className="mt-2 font-semibold">
                            {selectedVisualFlow.status === "active"
                              ? t("visualEditor.nextStepActiveTitle")
                              : t("visualEditor.nextStepDraftTitle")}
                          </h4>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {selectedVisualFlow.status === "active"
                              ? t("visualEditor.nextStepActiveDesc")
                              : t("visualEditor.nextStepDraftDesc")}
                          </p>
                          {selectedVisualFlow.status === "active" ? (
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                updateFlowStatus(selectedVisualFlow, "paused")
                              }
                              className="mt-4 w-full gap-2 rounded-xl bg-background"
                            >
                              <AlertTriangle className="h-4 w-4" />
                              {t("visualEditor.pauseToEdit")}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setGuideOpen(true)}
                              className="mt-4 w-full gap-2 rounded-xl"
                            >
                              <BookOpen className="h-4 w-4" />
                              {t("visualEditor.openGuide")}
                            </Button>
                          )}
                        </aside>
                      </div>
                    </section>

                    <div className="rounded-2xl border bg-background/80 p-4">
                      <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.45fr)_minmax(0,1fr)] lg:items-end">
                        <div className="space-y-1.5">
                          <Label htmlFor="visual-flow-select">
                            {t("visualEditor.changeScenario")}
                          </Label>
                          <select
                            id="visual-flow-select"
                            value={selectedVisualFlow.id}
                            onChange={(event) =>
                              setSelectedVisualFlowId(event.target.value)
                            }
                            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {flows.map((flow) => (
                              <option key={flow.id} value={flow.id}>
                                {flow.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="rounded-xl bg-muted/45 px-3 py-3">
                          <p className="text-xs font-semibold text-foreground">
                            {selectedVisualFlow.status === "active"
                              ? t("visualEditor.pauseHintTitle")
                              : t("visualEditor.readyHintTitle")}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {selectedVisualFlow.status === "active"
                              ? t("visualEditor.pauseHint")
                              : t("visualEditor.readyHint")}
                          </p>
                        </div>
                      </div>
                    </div>

                    {selectedVisualFlow.status === "active" && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        {t("visualEditor.activeLock")}
                      </div>
                    )}
                    <ConversationFlowCanvas
                      graph={selectedVisualFlow.graph}
                      labels={flowVisualLabels}
                      className="shadow-sm"
                      editable
                      disabled={busy || selectedVisualFlow.status === "active"}
                      paletteActions={visualPaletteActions}
                      editorLabels={visualEditorLabels}
                      onSaveGraph={(graph) =>
                        saveVisualFlowGraph(selectedVisualFlow, graph)
                      }
                    />
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="runs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                {t("runs.title")}
              </CardTitle>
              <CardDescription>{t("runs.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3" data-tour-id="inbox-automation-runs">
              {flowRuns.length === 0 ? (
                <div className="rounded-2xl border border-dashed bg-muted/20 p-6 text-sm">
                  <div className="mx-auto max-w-2xl text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Activity className="h-6 w-6" />
                    </div>
                    <p className="mt-4 text-base font-semibold text-foreground">
                      {t("runs.emptyTitle")}
                    </p>
                    <p className="mt-2 leading-relaxed text-muted-foreground">
                      {t("runs.empty")}
                    </p>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {[
                      t("runs.emptyStep1"),
                      t("runs.emptyStep2"),
                      t("runs.emptyStep3"),
                    ].map((item, index) => (
                      <div
                        key={item}
                        className="rounded-xl border bg-background px-3 py-3 text-left"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {index + 1}
                        </span>
                        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                          {item}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setActiveTab("builder")}
                      className="gap-2 bg-background"
                    >
                      <Route className="h-4 w-4" />
                      {t("runs.prepareFlow")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setActiveTab("flows")}
                      className="gap-2"
                    >
                      <GitBranch className="h-4 w-4" />
                      {t("runs.reviewFlows")}
                    </Button>
                  </div>
                </div>
              ) : (
                flowRuns.map((run) => (
                  <div key={run.id} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">
                            {run.flow?.name ?? t("runs.unknownFlow")}
                          </h3>
                          <Badge variant={runStatusVariant(run.status)}>
                            {run.status}
                          </Badge>
                          {run.flow?.trigger && (
                            <Badge variant="outline">{run.flow.trigger}</Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {run.conversation?.contactName ||
                              t("runs.unknownConversation")}
                          </span>
                          <span>·</span>
                          <Badge variant="secondary">
                            {run.conversation?.platform ??
                              shortId(run.conversationId)}
                          </Badge>
                          {run.conversation?.status && (
                            <Badge variant="outline">
                              {run.conversation.status}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatDateTime(run.startedAt)}
                          </span>
                          <span>
                            {t("runs.steps", { count: run.summary.stepCount })}
                          </span>
                          {run.summary.stop && (
                            <span>
                              {t("runs.stop", { stop: run.summary.stop })}
                            </span>
                          )}
                          {run.currentNodeId && (
                            <span>
                              {t("runs.node", {
                                node: shortId(run.currentNodeId),
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline">#{shortId(run.id)}</Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            <div className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p>{t("footerNote")}</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
