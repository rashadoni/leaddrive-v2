import { prisma } from "@/lib/prisma";

export const BUSINESS_HOURS_CHANNEL_TYPES = [
  "all",
  "voice",
  "email",
  "telegram",
  "sms",
  "whatsapp",
  "tiktok",
  "facebook",
  "instagram",
  "vkontakte",
] as const;

export type BusinessHoursChannelType =
  (typeof BUSINESS_HOURS_CHANNEL_TYPES)[number];

export const WEEKDAY_KEYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export interface BusinessHoursInterval {
  start: string;
  end: string;
}

export interface BusinessHoursDay {
  enabled?: boolean;
  intervals?: BusinessHoursInterval[];
}

export type BusinessHoursSchedule = Partial<Record<WeekdayKey, BusinessHoursDay>>;

export interface BusinessHoursHoliday {
  date: string; // YYYY-MM-DD in the configured timezone
  name?: string;
  closed?: boolean;
  intervals?: BusinessHoursInterval[];
}

export interface BusinessHoursConfig {
  id?: string | null;
  channelType?: string | null;
  timezone?: string | null;
  schedule?: unknown;
  holidays?: unknown;
  isActive?: boolean | null;
  welcomeMessage?: string | null;
  awayMessage?: string | null;
}

interface BusinessHoursRow extends BusinessHoursConfig {
  id: string;
  channelType: string;
  timezone: string;
  schedule: unknown;
  holidays: unknown;
  isActive: boolean;
  welcomeMessage: string | null;
  awayMessage: string | null;
}

export type BusinessHoursReason =
  | "inside_hours"
  | "outside_hours"
  | "holiday_closed"
  | "holiday_hours"
  | "disabled"
  | "invalid_timezone"
  | "no_config";

export interface BusinessHoursEvaluation {
  open: boolean;
  reason: BusinessHoursReason;
  timezone: string;
  localDate?: string;
  localTime?: string;
  weekday?: WeekdayKey;
}

export interface BusinessHoursDecision extends BusinessHoursEvaluation {
  configId?: string | null;
  channelType: BusinessHoursChannelType;
  matchedChannelType?: string | null;
  replyMessage: string | null;
  welcomeMessage: string | null;
  awayMessage: string | null;
}

export const DEFAULT_BUSINESS_HOURS_SCHEDULE: BusinessHoursSchedule = {
  mon: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  tue: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  wed: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  thu: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  fri: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  sat: { enabled: false, intervals: [] },
  sun: { enabled: false, intervals: [] },
};

const WEEKDAY_FROM_INTL: Record<string, WeekdayKey> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

export function normalizeBusinessHoursChannelType(
  value: unknown,
): BusinessHoursChannelType {
  const normalized = String(value ?? "all").trim().toLowerCase();
  return (BUSINESS_HOURS_CHANNEL_TYPES as readonly string[]).includes(normalized)
    ? (normalized as BusinessHoursChannelType)
    : "all";
}

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function cleanMessage(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function parseMinute(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isValidBusinessHoursInterval(
  interval: unknown,
): interval is BusinessHoursInterval {
  if (!interval || typeof interval !== "object" || Array.isArray(interval)) {
    return false;
  }
  const raw = interval as Record<string, unknown>;
  const start = parseMinute(raw.start);
  const end = parseMinute(raw.end);
  return start !== null && end !== null && start < end;
}

function normalizeIntervals(value: unknown): BusinessHoursInterval[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((interval) =>
    isValidBusinessHoursInterval(interval)
      ? [{ start: interval.start.trim(), end: interval.end.trim() }]
      : [],
  );
}

export function normalizeBusinessHoursSchedule(
  value: unknown,
): BusinessHoursSchedule {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const hasAnyWeekday = WEEKDAY_KEYS.some((day) => day in source);
  if (!hasAnyWeekday) return DEFAULT_BUSINESS_HOURS_SCHEDULE;

  const schedule: BusinessHoursSchedule = {};
  for (const day of WEEKDAY_KEYS) {
    const rawDay =
      source[day] && typeof source[day] === "object" && !Array.isArray(source[day])
        ? (source[day] as Record<string, unknown>)
        : {};
    const intervals = normalizeIntervals(rawDay.intervals);
    schedule[day] = {
      enabled: rawDay.enabled === true,
      intervals,
    };
  }
  return schedule;
}

export function normalizeBusinessHoursHolidays(
  value: unknown,
): BusinessHoursHoliday[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((holiday) => {
    if (!holiday || typeof holiday !== "object" || Array.isArray(holiday)) {
      return [];
    }
    const raw = holiday as Record<string, unknown>;
    const date = typeof raw.date === "string" ? raw.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const intervals = normalizeIntervals(raw.intervals);
    return [{
      date,
      name: typeof raw.name === "string" ? raw.name.trim() : undefined,
      closed: raw.closed === undefined ? true : raw.closed === true,
      intervals,
    }];
  });
}

function localParts(now: Date, timezone: string): {
  localDate: string;
  localTime: string;
  weekday: WeekdayKey;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_FROM_INTL[byType.get("weekday") ?? ""] ?? "mon";
  const hour = byType.get("hour") ?? "00";
  const minute = byType.get("minute") ?? "00";
  return {
    localDate: `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`,
    localTime: `${hour}:${minute}`,
    weekday,
    minute: Number(hour) * 60 + Number(minute),
  };
}

function minuteInIntervals(minute: number, intervals: BusinessHoursInterval[]): boolean {
  return intervals.some((interval) => {
    const start = parseMinute(interval.start);
    const end = parseMinute(interval.end);
    return start !== null && end !== null && start <= minute && minute < end;
  });
}

export function evaluateBusinessHours(
  config: BusinessHoursConfig | null | undefined,
  now = new Date(),
): BusinessHoursEvaluation {
  if (!config) {
    return { open: true, reason: "no_config", timezone: "UTC" };
  }
  const timezone = String(config.timezone || "UTC");
  if (config.isActive === false) {
    return { open: true, reason: "disabled", timezone };
  }
  if (!isValidTimeZone(timezone)) {
    // Fail open: a typo in settings must not unexpectedly auto-away every live inbox.
    return { open: true, reason: "invalid_timezone", timezone };
  }

  const schedule = normalizeBusinessHoursSchedule(config.schedule);
  const holidays = normalizeBusinessHoursHolidays(config.holidays);
  const local = localParts(now, timezone);
  const holiday = holidays.find((item) => item.date === local.localDate);
  if (holiday) {
    if (holiday.intervals && holiday.intervals.length > 0) {
      return {
        open: minuteInIntervals(local.minute, holiday.intervals),
        reason: "holiday_hours",
        timezone,
        localDate: local.localDate,
        localTime: local.localTime,
        weekday: local.weekday,
      };
    }
    if (holiday.closed !== false) {
      return {
        open: false,
        reason: "holiday_closed",
        timezone,
        localDate: local.localDate,
        localTime: local.localTime,
        weekday: local.weekday,
      };
    }
  }

  const day = schedule[local.weekday];
  const intervals = day?.intervals ?? [];
  const open = day?.enabled === true && minuteInIntervals(local.minute, intervals);
  return {
    open,
    reason: open ? "inside_hours" : "outside_hours",
    timezone,
    localDate: local.localDate,
    localTime: local.localTime,
    weekday: local.weekday,
  };
}

export async function getBusinessHoursDecision(params: {
  organizationId: string;
  channelType?: string | null;
  now?: Date;
}): Promise<BusinessHoursDecision> {
  const channelType = normalizeBusinessHoursChannelType(params.channelType);
  const candidates = channelType === "all" ? ["all"] : [channelType, "all"];
  const rows = await prisma.businessHours.findMany({
    where: { organizationId: params.organizationId, channelType: { in: candidates } },
  }) as BusinessHoursRow[];
  const matched = rows.find((row) => row.channelType === channelType)
    ?? rows.find((row) => row.channelType === "all")
    ?? null;

  const evaluation = evaluateBusinessHours(matched, params.now);
  const welcomeMessage = cleanMessage(matched?.welcomeMessage);
  const awayMessage = cleanMessage(matched?.awayMessage);
  return {
    ...evaluation,
    configId: matched?.id ?? null,
    channelType,
    matchedChannelType: matched?.channelType ?? null,
    welcomeMessage,
    awayMessage,
    replyMessage: evaluation.open ? welcomeMessage : awayMessage,
  };
}

export function buildBusinessHoursReplyFlowGraph(input: {
  welcomeText?: string | null;
  awayText?: string | null;
}) {
  const welcomeText = cleanMessage(input.welcomeText);
  const awayText = cleanMessage(input.awayText);
  const nodes: Array<Record<string, unknown>> = [
    { id: "trigger", type: "trigger", data: { event: "message_inbound" } },
    {
      id: "business_hours_gate",
      type: "action",
      data: { action: { type: "business_hours_gate", config: {} } },
    },
    { id: "end", type: "end" },
  ];
  const edges: Array<Record<string, unknown>> = [
    { source: "trigger", target: "business_hours_gate" },
  ];

  if (welcomeText) {
    nodes.push({
      id: "welcome_reply",
      type: "action",
      data: { action: { type: "send_reply", config: { text: welcomeText } } },
    });
    edges.push(
      { source: "business_hours_gate", target: "welcome_reply", sourceHandle: "success" },
      { source: "welcome_reply", target: "end" },
    );
  } else {
    edges.push({ source: "business_hours_gate", target: "end", sourceHandle: "success" });
  }

  if (awayText) {
    nodes.push({
      id: "away_reply",
      type: "action",
      data: { action: { type: "send_reply", config: { text: awayText } } },
    });
    edges.push(
      { source: "business_hours_gate", target: "away_reply", sourceHandle: "failure" },
      { source: "away_reply", target: "end" },
    );
  } else {
    edges.push({ source: "business_hours_gate", target: "end", sourceHandle: "failure" });
  }

  return {
    nodes,
    edges,
    metadata: {
      builder: "business-hours-template-v1",
      actions: [
        "business_hours_gate",
        ...(welcomeText ? ["send_reply:welcome"] : []),
        ...(awayText ? ["send_reply:away"] : []),
      ],
    },
  };
}
