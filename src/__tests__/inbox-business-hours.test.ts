import { beforeEach, describe, expect, it, vi } from "vitest";

const businessHoursFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    businessHours: {
      findMany: businessHoursFindMany,
    },
  },
}));

import {
  DEFAULT_BUSINESS_HOURS_SCHEDULE,
  buildBusinessHoursReplyFlowGraph,
  evaluateBusinessHours,
  getBusinessHoursDecision,
} from "@/lib/inbox/business-hours";

beforeEach(() => {
  vi.clearAllMocks();
  businessHoursFindMany.mockResolvedValue([]);
});

describe("evaluateBusinessHours", () => {
  it("uses the configured timezone when checking the weekly schedule", () => {
    const config = {
      timezone: "Asia/Baku",
      schedule: DEFAULT_BUSINESS_HOURS_SCHEDULE,
      holidays: [],
      isActive: true,
    };

    expect(evaluateBusinessHours(config, new Date("2026-06-22T06:00:00Z"))).toMatchObject({
      open: true,
      reason: "inside_hours",
      localDate: "2026-06-22",
      localTime: "10:00",
      weekday: "mon",
    });

    expect(evaluateBusinessHours(config, new Date("2026-06-22T15:30:00Z"))).toMatchObject({
      open: false,
      reason: "outside_hours",
      localTime: "19:30",
    });
  });

  it("closes for a configured holiday even when the weekday would be open", () => {
    const result = evaluateBusinessHours(
      {
        timezone: "Asia/Baku",
        schedule: DEFAULT_BUSINESS_HOURS_SCHEDULE,
        holidays: [{ date: "2026-06-22", name: "Public holiday" }],
        isActive: true,
      },
      new Date("2026-06-22T06:00:00Z"),
    );

    expect(result).toMatchObject({ open: false, reason: "holiday_closed" });
  });

  it("fails open for an invalid timezone to preserve live inbox behavior", () => {
    expect(evaluateBusinessHours({ timezone: "Mars/Olympus", isActive: true })).toMatchObject({
      open: true,
      reason: "invalid_timezone",
    });
  });
});

describe("getBusinessHoursDecision", () => {
  it("uses a voice-specific schedule for AI calling hours", async () => {
    businessHoursFindMany.mockResolvedValue([
      {
        id: "bh_voice",
        channelType: "voice",
        timezone: "Asia/Baku",
        schedule: DEFAULT_BUSINESS_HOURS_SCHEDULE,
        holidays: [],
        isActive: true,
        welcomeMessage: null,
        awayMessage: null,
      },
    ]);

    const decision = await getBusinessHoursDecision({
      organizationId: "org_1",
      channelType: "voice",
      now: new Date("2026-06-22T06:00:00Z"),
    });

    expect(businessHoursFindMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", channelType: { in: ["voice", "all"] } },
    });
    expect(decision).toMatchObject({
      open: true,
      configId: "bh_voice",
      matchedChannelType: "voice",
      replyMessage: null,
    });
  });

  it("uses an exact channel row before the org-wide fallback", async () => {
    businessHoursFindMany.mockResolvedValue([
      {
        id: "bh_all",
        channelType: "all",
        timezone: "Asia/Baku",
        schedule: {
          mon: { enabled: false, intervals: [] },
        },
        holidays: [],
        isActive: true,
        welcomeMessage: "All welcome",
        awayMessage: "All away",
      },
      {
        id: "bh_tg",
        channelType: "telegram",
        timezone: "Asia/Baku",
        schedule: DEFAULT_BUSINESS_HOURS_SCHEDULE,
        holidays: [],
        isActive: true,
        welcomeMessage: "Telegram welcome",
        awayMessage: "Telegram away",
      },
    ]);

    const decision = await getBusinessHoursDecision({
      organizationId: "org_1",
      channelType: "telegram",
      now: new Date("2026-06-22T06:00:00Z"),
    });

    expect(businessHoursFindMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", channelType: { in: ["telegram", "all"] } },
    });
    expect(decision).toMatchObject({
      open: true,
      configId: "bh_tg",
      matchedChannelType: "telegram",
      replyMessage: "Telegram welcome",
    });
  });

  it("lets a disabled exact channel row override an active org-wide fallback", async () => {
    businessHoursFindMany.mockResolvedValue([
      {
        id: "bh_all",
        channelType: "all",
        timezone: "Asia/Baku",
        schedule: { mon: { enabled: false, intervals: [] } },
        holidays: [],
        isActive: true,
        welcomeMessage: null,
        awayMessage: "All away",
      },
      {
        id: "bh_sms",
        channelType: "sms",
        timezone: "Asia/Baku",
        schedule: DEFAULT_BUSINESS_HOURS_SCHEDULE,
        holidays: [],
        isActive: false,
        welcomeMessage: null,
        awayMessage: "SMS away",
      },
    ]);

    const decision = await getBusinessHoursDecision({
      organizationId: "org_1",
      channelType: "sms",
      now: new Date("2026-06-22T20:00:00Z"),
    });

    expect(decision).toMatchObject({
      open: true,
      reason: "disabled",
      configId: "bh_sms",
      replyMessage: null,
    });
  });
});

describe("buildBusinessHoursReplyFlowGraph", () => {
  it("builds a branchable ConversationFlow template graph for welcome and away replies", () => {
    const graph = buildBusinessHoursReplyFlowGraph({
      welcomeText: "Welcome, we are online.",
      awayText: "We are closed now.",
    });

    expect(graph.metadata).toMatchObject({
      builder: "business-hours-template-v1",
      actions: ["business_hours_gate", "send_reply:welcome", "send_reply:away"],
    });
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "trigger",
      "business_hours_gate",
      "end",
      "welcome_reply",
      "away_reply",
    ]);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { source: "business_hours_gate", target: "welcome_reply", sourceHandle: "success" },
        { source: "business_hours_gate", target: "away_reply", sourceHandle: "failure" },
      ]),
    );
  });
});
