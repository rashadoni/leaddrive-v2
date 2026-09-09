import { describe, expect, it } from "vitest";
import {
  buildLinearConversationFlowGraph,
  extractGraphActionSummaries,
  validateLinearFlowSteps,
  type LinearFlowStep,
} from "@/lib/inbox/automation-builder";

describe("inbox automation linear builder", () => {
  it("builds a success chain and failure exits for configured actions", () => {
    const steps: LinearFlowStep[] = [
      { id: "s1", type: "send_reply", config: { text: "Hi there" } },
      { id: "s2", type: "ai_reply" },
      { id: "s3", type: "assign_to_queue", config: { queueId: "queue_1" } },
    ];

    const graph = buildLinearConversationFlowGraph(steps);

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "trigger",
      "action_1",
      "action_2",
      "action_3",
      "end",
    ]);
    expect(graph.edges).toEqual([
      { source: "trigger", target: "action_1" },
      { source: "action_1", target: "action_2", sourceHandle: "success" },
      { source: "action_1", target: "end", sourceHandle: "failure" },
      { source: "action_2", target: "action_3", sourceHandle: "success" },
      { source: "action_2", target: "end", sourceHandle: "failure" },
      { source: "action_3", target: "end", sourceHandle: "success" },
      { source: "action_3", target: "end", sourceHandle: "failure" },
    ]);
    expect(graph.metadata).toMatchObject({
      builder: "inbox-automation-linear-v1",
      actionCount: 3,
      actions: ["send_reply", "ai_reply", "assign_to_queue"],
    });
  });

  it("validates required action configuration before POST", () => {
    const issues = validateLinearFlowSteps([
      { id: "queue", type: "assign_to_queue", config: {} },
      { id: "menu", type: "menu", config: { prompt: "", optionsText: "" } },
      { id: "reply", type: "send_reply", config: { text: "   " } },
      { id: "ai", type: "ai_reply", config: {} },
      { id: "handoff", type: "handoff_agent", config: { reason: "help" } },
    ]);

    expect(issues).toEqual([
      { stepId: "queue", code: "missing_queue" },
      { stepId: "menu", code: "missing_prompt" },
      { stepId: "menu", code: "missing_options" },
      { stepId: "reply", code: "missing_text" },
      { stepId: "handoff", code: "missing_user" },
    ]);
  });

  it("extracts legacy and linear action summaries from stored graphs", () => {
    const graph = buildLinearConversationFlowGraph([
      { id: "s1", type: "send_reply", config: { text: " Welcome! " } },
      {
        id: "s2",
        type: "handoff_agent",
        config: { toUserId: "u_1", reason: "VIP" },
      },
    ]);

    expect(extractGraphActionSummaries(graph)).toEqual([
      {
        type: "send_reply",
        prompt: undefined,
        optionsText: undefined,
        text: "Welcome!",
        queueId: undefined,
        toUserId: undefined,
        reason: undefined,
        userMessage: undefined,
        channelType: undefined,
        field: undefined,
        value: undefined,
      },
      {
        type: "handoff_agent",
        prompt: undefined,
        optionsText: undefined,
        toUserId: "u_1",
        reason: "VIP",
        queueId: undefined,
        text: undefined,
        userMessage: undefined,
        channelType: undefined,
        field: undefined,
        value: undefined,
      },
    ]);
  });

  it("supports the N2 business-hours gate as a branchable action", () => {
    const graph = buildLinearConversationFlowGraph([
      { id: "gate", type: "business_hours_gate", config: { channelType: "telegram" } },
    ]);

    expect(graph.metadata).toMatchObject({
      actionCount: 1,
      actions: ["business_hours_gate"],
    });
    expect(extractGraphActionSummaries(graph)).toEqual([
      {
        type: "business_hours_gate",
        prompt: undefined,
        optionsText: undefined,
        channelType: "telegram",
        queueId: undefined,
        text: undefined,
        toUserId: undefined,
        reason: undefined,
        userMessage: undefined,
        field: undefined,
        value: undefined,
      },
    ]);
  });

  it("builds menu actions from one-option-per-line UI input", () => {
    const graph = buildLinearConversationFlowGraph([
      {
        id: "menu",
        type: "menu",
        config: {
          prompt: "How can we help?",
          optionsText: "Sales\n2. Support\n• Talk to a human",
        },
      },
    ]);

    expect(validateLinearFlowSteps([
      {
        id: "menu",
        type: "menu",
        config: {
          prompt: "How can we help?",
          optionsText: "Sales\nSupport",
        },
      },
    ])).toEqual([]);
    expect(graph.nodes[1]).toMatchObject({
      data: {
        action: {
          type: "menu",
          config: {
            prompt: "How can we help?",
            options: [
              { id: "option_1", label: "Sales", match: ["1", "Sales"] },
              { id: "option_2", label: "Support", match: ["2", "Support"] },
              { id: "option_3", label: "Talk to a human", match: ["3", "Talk to a human"] },
            ],
          },
        },
      },
    });
    expect(extractGraphActionSummaries(graph)).toEqual([
      {
        type: "menu",
        prompt: "How can we help?",
        optionsText: "Sales\nSupport\nTalk to a human",
        channelType: undefined,
        queueId: undefined,
        text: undefined,
        toUserId: undefined,
        reason: undefined,
        userMessage: undefined,
        field: undefined,
        value: undefined,
      },
    ]);
  });

  it("builds and validates safe contact field updates", () => {
    const issues = validateLinearFlowSteps([
      { id: "empty", type: "update_field", config: { field: "", value: "" } },
    ]);

    expect(issues).toEqual([
      { stepId: "empty", code: "missing_field" },
      { stepId: "empty", code: "missing_value" },
    ]);

    const graph = buildLinearConversationFlowGraph([
      {
        id: "update",
        type: "update_field",
        config: { field: "contact.lifecycleStage", value: "mql" },
      },
    ]);

    expect(graph.metadata).toMatchObject({
      actionCount: 1,
      actions: ["update_field"],
    });
    expect(extractGraphActionSummaries(graph)).toEqual([
      {
        type: "update_field",
        prompt: undefined,
        optionsText: undefined,
        field: "contact.lifecycleStage",
        value: "mql",
        channelType: undefined,
        queueId: undefined,
        text: undefined,
        toUserId: undefined,
        reason: undefined,
        userMessage: undefined,
      },
    ]);
  });
});
