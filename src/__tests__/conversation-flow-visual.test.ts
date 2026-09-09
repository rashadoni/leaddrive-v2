import { describe, expect, it } from "vitest";
import { buildLinearConversationFlowGraph } from "@/lib/inbox/automation-builder";
import {
  canvasToConversationGraph,
  conversationGraphToCanvas,
} from "@/lib/inbox/conversation-flow-visual";

describe("conversation flow visual converters", () => {
  it("converts a saved runtime graph into canvas nodes and labeled branch edges", () => {
    const graph = buildLinearConversationFlowGraph([
      { id: "s1", type: "send_reply", config: { text: "Welcome to LeadDrive" } },
      { id: "s2", type: "ai_reply", config: { userMessage: "Use the latest message" } },
    ]);

    const canvas = conversationGraphToCanvas(graph, {
      trigger: "Inbound",
      end: "Done",
      success: "OK",
      failure: "Fail",
      actionLabels: {
        send_reply: "Send reply",
        ai_reply: "AI reply",
      },
    });

    expect(canvas.nodes.map((node) => [node.id, node.data.label])).toEqual([
      ["trigger", "Inbound"],
      ["action_1", "Send reply"],
      ["action_2", "AI reply"],
      ["end", "Done"],
    ]);
    expect(canvas.nodes.find((node) => node.id === "action_1")?.data.configPreview).toBe(
      "Welcome to LeadDrive",
    );
    expect(canvas.edges).toEqual([
      {
        id: "e-trigger-default-action_1-0",
        source: "trigger",
        target: "action_1",
        label: undefined,
        tone: "neutral",
      },
      {
        id: "e-action_1-success-action_2-1",
        source: "action_1",
        target: "action_2",
        sourceHandle: "success",
        label: "OK",
        tone: "success",
      },
      {
        id: "e-action_1-failure-end-2",
        source: "action_1",
        target: "end",
        sourceHandle: "failure",
        label: "Fail",
        tone: "failure",
      },
      {
        id: "e-action_2-success-end-3",
        source: "action_2",
        target: "end",
        sourceHandle: "success",
        label: "OK",
        tone: "success",
      },
      {
        id: "e-action_2-failure-end-4",
        source: "action_2",
        target: "end",
        sourceHandle: "failure",
        label: "Fail",
        tone: "failure",
      },
    ]);
  });

  it("round-trips canvas nodes back to the runner graph shape without dropping action config", () => {
    const graph = buildLinearConversationFlowGraph([
      {
        id: "s1",
        type: "handoff_agent",
        config: { toUserId: "user_1", reason: "VIP escalation" },
      },
    ]);
    const canvas = conversationGraphToCanvas(graph);

    expect(canvasToConversationGraph(canvas)).toEqual({
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          position: { x: 260, y: 48 },
          data: { event: "message_inbound" },
        },
        {
          id: "action_1",
          type: "action",
          position: { x: 260, y: 180 },
          data: {
            action: {
              type: "handoff_agent",
              config: { toUserId: "user_1", reason: "VIP escalation" },
            },
          },
        },
        { id: "end", type: "end", position: { x: 260, y: 312 } },
      ],
      edges: [
        { source: "trigger", target: "action_1" },
        { source: "action_1", target: "end", sourceHandle: "success" },
        { source: "action_1", target: "end", sourceHandle: "failure" },
      ],
    });
  });

  it("preserves saved node positions when converting to canvas and back", () => {
    const graph = {
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          position: { x: 10, y: 20 },
          data: { event: "message_inbound" },
        },
        {
          id: "action_1",
          type: "action",
          position: { x: 340, y: 260 },
          data: { action: { type: "notify", config: {} } },
        },
        { id: "end", type: "end", position: { x: 640, y: 420 } },
      ],
      edges: [
        { source: "trigger", target: "action_1" },
        { source: "action_1", target: "end", sourceHandle: "success" },
      ],
    };

    const canvas = conversationGraphToCanvas(graph);

    expect(canvas.nodes.map((node) => [node.id, node.position])).toEqual([
      ["trigger", { x: 10, y: 20 }],
      ["action_1", { x: 340, y: 260 }],
      ["end", { x: 640, y: 420 }],
    ]);
    expect(canvasToConversationGraph(canvas).nodes).toEqual(graph.nodes);
  });

  it("tolerates invalid graph input with an empty canvas instead of throwing", () => {
    expect(conversationGraphToCanvas(null)).toEqual({ nodes: [], edges: [] });
    expect(conversationGraphToCanvas({ nodes: [], edges: "bad" })).toEqual({
      nodes: [],
      edges: [],
    });
  });
});
