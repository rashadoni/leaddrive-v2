"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  GitBranch,
  Loader2,
  MessageSquareReply,
  Moon,
  Save,
  ShieldCheck,
} from "lucide-react";

type ChannelType =
  | "all"
  | "voice"
  | "email"
  | "telegram"
  | "sms"
  | "whatsapp"
  | "tiktok"
  | "facebook"
  | "instagram"
  | "vkontakte";

type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

type ScheduleInterval = {
  start: string;
  end: string;
};

type ScheduleDay = {
  enabled: boolean;
  intervals: ScheduleInterval[];
};

type Schedule = Record<WeekdayKey, ScheduleDay>;

type BusinessHoursConfig = {
  id?: string;
  channelType: ChannelType;
  timezone: string;
  schedule: Schedule;
  holidays: unknown[];
  isActive: boolean;
  welcomeMessage: string;
  awayMessage: string;
};

type BusinessHoursApiRow = {
  id: string;
  channelType: string;
  timezone: string;
  schedule: unknown;
  holidays: unknown;
  isActive: boolean;
  welcomeMessage: string | null;
  awayMessage: string | null;
};

type BusinessHoursApiResponse = {
  success?: boolean;
  data?: BusinessHoursApiRow[] | BusinessHoursApiRow;
  error?: string;
};

const CHANNELS: ChannelType[] = [
  "all",
  "voice",
  "whatsapp",
  "telegram",
  "sms",
  "email",
  "tiktok",
  "facebook",
  "instagram",
  "vkontakte",
];

const WEEKDAYS: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const DEFAULT_SCHEDULE: Schedule = {
  mon: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  tue: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  wed: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  thu: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  fri: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
  sat: { enabled: false, intervals: [] },
  sun: { enabled: false, intervals: [] },
};

function cloneDefaultSchedule(): Schedule {
  return WEEKDAYS.reduce((schedule, day) => {
    schedule[day] = {
      enabled: DEFAULT_SCHEDULE[day].enabled,
      intervals: DEFAULT_SCHEDULE[day].intervals.map((interval) => ({ ...interval })),
    };
    return schedule;
  }, {} as Schedule);
}

function defaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function createDefaultConfig(channelType: ChannelType): BusinessHoursConfig {
  return {
    channelType,
    timezone: defaultTimezone(),
    schedule: cloneDefaultSchedule(),
    holidays: [],
    isActive: true,
    welcomeMessage: "",
    awayMessage: "",
  };
}

function isWeekdayKey(value: string): value is WeekdayKey {
  return (WEEKDAYS as readonly string[]).includes(value);
}

function isChannelType(value: string): value is ChannelType {
  return (CHANNELS as readonly string[]).includes(value);
}

function normalizeSchedule(value: unknown): Schedule {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const schedule = cloneDefaultSchedule();

  for (const key of Object.keys(source)) {
    if (!isWeekdayKey(key)) continue;
    const rawDay = source[key];
    if (!rawDay || typeof rawDay !== "object" || Array.isArray(rawDay)) continue;
    const day = rawDay as Record<string, unknown>;
    const rawIntervals = Array.isArray(day.intervals) ? day.intervals : [];
    const intervals = rawIntervals.flatMap((interval) => {
      if (!interval || typeof interval !== "object" || Array.isArray(interval)) return [];
      const raw = interval as Record<string, unknown>;
      const start = typeof raw.start === "string" ? raw.start : "";
      const end = typeof raw.end === "string" ? raw.end : "";
      return /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end)
        ? [{ start, end }]
        : [];
    });
    schedule[key] = {
      enabled: day.enabled === true,
      intervals,
    };
  }

  return schedule;
}

function normalizeApiRow(row: BusinessHoursApiRow, fallbackChannel: ChannelType): BusinessHoursConfig {
  return {
    id: row.id,
    channelType: isChannelType(row.channelType) ? row.channelType : fallbackChannel,
    timezone: row.timezone || defaultTimezone(),
    schedule: normalizeSchedule(row.schedule),
    holidays: Array.isArray(row.holidays) ? row.holidays : [],
    isActive: row.isActive,
    welcomeMessage: row.welcomeMessage || "",
    awayMessage: row.awayMessage || "",
  };
}

export default function InboxBusinessHoursPage() {
  const t = useTranslations("forms");
  const [selectedChannel, setSelectedChannel] = useState<ChannelType>("all");
  const [config, setConfig] = useState<BusinessHoursConfig>(() => createDefaultConfig("all"));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const enabledDaysCount = useMemo(
    () => WEEKDAYS.filter((day) => config.schedule[day]?.enabled).length,
    [config.schedule],
  );

  const loadConfig = useCallback(async (channelType: ChannelType) => {
    setLoading(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch(`/api/v1/business-hours?channelType=${channelType}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as BusinessHoursApiResponse;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const rows = Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
      setConfig(rows[0] ? normalizeApiRow(rows[0], channelType) : createDefaultConfig(channelType));
    } catch (err) {
      setConfig(createDefaultConfig(channelType));
      setError((err as Error)?.message || t("businessHoursLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadConfig(selectedChannel);
  }, [loadConfig, selectedChannel]);

  function updateScheduleDay(day: WeekdayKey, patch: Partial<ScheduleDay>) {
    setConfig((current) => ({
      ...current,
      schedule: {
        ...current.schedule,
        [day]: {
          ...current.schedule[day],
          ...patch,
        },
      },
    }));
  }

  function updateInterval(day: WeekdayKey, field: keyof ScheduleInterval, value: string) {
    setConfig((current) => {
      const currentDay = current.schedule[day];
      const intervals = currentDay.intervals.length > 0
        ? currentDay.intervals
        : [{ start: "09:00", end: "18:00" }];
      return {
        ...current,
        schedule: {
          ...current.schedule,
          [day]: {
            ...currentDay,
            intervals: intervals.map((interval, index) =>
              index === 0 ? { ...interval, [field]: value } : interval,
            ),
          },
        },
      };
    });
  }

  async function saveConfig() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch("/api/v1/business-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelType: selectedChannel,
          timezone: config.timezone,
          schedule: config.schedule,
          holidays: config.holidays,
          isActive: config.isActive,
          welcomeMessage: selectedChannel === "voice" ? null : config.welcomeMessage,
          awayMessage: selectedChannel === "voice" ? null : config.awayMessage,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as BusinessHoursApiResponse;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const row = Array.isArray(json.data) ? json.data[0] : json.data;
      if (row) setConfig(normalizeApiRow(row, selectedChannel));
      setSavedAt(new Date());
    } catch (err) {
      setError((err as Error)?.message || t("businessHoursSaveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-slate-50 p-5 shadow-sm sm:p-6 dark:border-orange-950/50 dark:from-orange-950/20 dark:via-zinc-950 dark:to-slate-950">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-semibold text-orange-700 shadow-sm dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300">
              <CalendarClock className="h-3.5 w-3.5" />
              {t("businessHoursBadge")}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">
                {t("businessHoursTitle")}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {t("businessHoursDesc")}
              </p>
            </div>
          </div>
          <div className="grid gap-2 rounded-2xl border border-orange-100 bg-white p-4 text-sm shadow-sm sm:min-w-64 dark:border-orange-950/50 dark:bg-zinc-950">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("businessHoursStatus")}</span>
              <span className={config.isActive ? "font-semibold text-emerald-600" : "font-semibold text-slate-500"}>
                {config.isActive ? t("businessHoursStatusActive") : t("businessHoursStatusPaused")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("businessHoursOpenDays")}</span>
              <span className="font-semibold">{enabledDaysCount}/7</span>
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">{t("businessHoursSafetyTitle")}</p>
            <p>{t("businessHoursSafetyDesc")}</p>
          </div>
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-950/60 dark:bg-red-950/30 dark:text-red-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </section>
      ) : null}

      {savedAt ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-950/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("businessHoursSaved")}</span>
          </div>
        </section>
      ) : null}

      <main className="grid gap-6">
        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Clock className="h-5 w-5 text-orange-600" />
                {t("businessHoursScheduleTitle")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("businessHoursScheduleDesc")}
              </p>
            </div>
            <button
              type="button"
              onClick={saveConfig}
              disabled={loading || saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? t("businessHoursSaving") : t("businessHoursSave")}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(16rem,auto)]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">{t("businessHoursChannel")}</span>
              <select
                value={selectedChannel}
                onChange={(event) => setSelectedChannel(event.target.value as ChannelType)}
                className="h-11 rounded-xl border bg-background px-3 text-sm"
                disabled={loading || saving}
              >
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {t(`businessHoursChannel_${channel}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">{t("businessHoursTimezone")}</span>
              <input
                value={config.timezone}
                onChange={(event) => setConfig((current) => ({ ...current, timezone: event.target.value }))}
                className="h-11 rounded-xl border bg-background px-3 text-sm"
                placeholder="Asia/Baku"
                disabled={loading || saving}
              />
            </label>

            <label className="flex min-h-20 items-center gap-3 rounded-xl border bg-muted/30 p-3">
              <input
                type="checkbox"
                checked={config.isActive}
                onChange={(event) => setConfig((current) => ({ ...current, isActive: event.target.checked }))}
                className="h-5 w-5 shrink-0 accent-orange-600"
                disabled={loading || saving}
              />
              <span className="text-sm font-medium leading-5">{t("businessHoursActiveToggle")}</span>
            </label>
          </div>

          <div className="mt-6 overflow-x-auto rounded-2xl border">
            <div className="grid min-w-[760px] grid-cols-[minmax(11rem,1fr)_minmax(10rem,0.8fr)_minmax(20rem,1.2fr)] bg-muted/60 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span>{t("businessHoursDay")}</span>
              <span>{t("businessHoursOpen")}</span>
              <span>{t("businessHoursInterval")}</span>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("businessHoursLoading")}
              </div>
            ) : (
              WEEKDAYS.map((day) => {
                const dayConfig = config.schedule[day];
                const interval = dayConfig.intervals[0] || { start: "09:00", end: "18:00" };
                return (
                  <div
                    key={day}
                    className="grid min-w-[760px] grid-cols-[minmax(11rem,1fr)_minmax(10rem,0.8fr)_minmax(20rem,1.2fr)] items-center gap-4 border-t px-4 py-4"
                  >
                    <div className="min-w-0 font-medium">{t(`businessHoursDay_${day}`)}</div>
                    <label className="flex w-fit items-center gap-3 rounded-xl border bg-background px-3 py-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={dayConfig.enabled}
                        onChange={(event) =>
                          updateScheduleDay(day, {
                            enabled: event.target.checked,
                            intervals: event.target.checked && dayConfig.intervals.length === 0
                              ? [{ start: "09:00", end: "18:00" }]
                              : dayConfig.intervals,
                          })
                        }
                        className="h-5 w-5 accent-orange-600"
                        disabled={saving}
                      />
                      {dayConfig.enabled ? t("businessHoursDayOpen") : t("businessHoursDayClosed")}
                    </label>
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                      <input
                        type="time"
                        value={interval.start}
                        onChange={(event) => updateInterval(day, "start", event.target.value)}
                        className="h-10 min-w-0 rounded-xl border bg-background px-3 text-sm disabled:bg-muted disabled:text-muted-foreground"
                        disabled={!dayConfig.enabled || saving}
                      />
                      <span className="text-muted-foreground">—</span>
                      <input
                        type="time"
                        value={interval.end}
                        onChange={(event) => updateInterval(day, "end", event.target.value)}
                        className="h-10 min-w-0 rounded-xl border bg-background px-3 text-sm disabled:bg-muted disabled:text-muted-foreground"
                        disabled={!dayConfig.enabled || saving}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {selectedChannel === "voice" ? (
          <section className="rounded-3xl border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck className="h-5 w-5 text-orange-600" />
              {t("businessHoursVoiceTitle")}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              {t("businessHoursVoiceDesc")}
            </p>
          </section>
        ) : (
          <section className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
            <div className="rounded-3xl border bg-card p-5 shadow-sm sm:p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <MessageSquareReply className="h-5 w-5 text-orange-600" />
                {t("businessHoursMessagesTitle")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("businessHoursMessagesDesc")}
              </p>

              <div className="mt-5 grid gap-4">
                <label className="grid gap-2">
                  <span className="text-sm font-medium">{t("businessHoursWelcomeMessage")}</span>
                  <textarea
                    value={config.welcomeMessage}
                    onChange={(event) => setConfig((current) => ({ ...current, welcomeMessage: event.target.value }))}
                    className="min-h-28 rounded-2xl border bg-background p-3 text-sm leading-6"
                    placeholder={t("businessHoursWelcomePlaceholder")}
                    maxLength={2000}
                    disabled={loading || saving}
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">{t("businessHoursAwayMessage")}</span>
                  <textarea
                    value={config.awayMessage}
                    onChange={(event) => setConfig((current) => ({ ...current, awayMessage: event.target.value }))}
                    className="min-h-28 rounded-2xl border bg-background p-3 text-sm leading-6"
                    placeholder={t("businessHoursAwayPlaceholder")}
                    maxLength={2000}
                    disabled={loading || saving}
                  />
                </label>
              </div>
            </div>

            <aside className="rounded-3xl border bg-card p-5 shadow-sm sm:p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <GitBranch className="h-5 w-5 text-orange-600" />
                {t("businessHoursPreviewTitle")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("businessHoursPreviewDesc")}
              </p>

              <div className="mt-5 space-y-3">
                <div className="rounded-2xl border bg-muted/30 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    message_inbound
                  </div>
                  <div className="mt-1 text-sm font-medium">{t("businessHoursPreviewInbound")}</div>
                </div>
                <div className="mx-5 h-6 border-l" />
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-950/60 dark:bg-orange-950/30">
                  <div className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300">
                    business_hours_gate
                  </div>
                  <div className="mt-1 text-sm font-medium">{t("businessHoursPreviewGate")}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-950/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                    <CheckCircle2 className="mb-2 h-4 w-4" />
                    <div className="text-xs font-semibold uppercase tracking-wide">open</div>
                    <div className="mt-1 text-sm">{t("businessHoursPreviewOpen")}</div>
                  </div>
                  <div className="rounded-2xl border bg-slate-50 p-4 text-slate-900 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200">
                    <Moon className="mb-2 h-4 w-4" />
                    <div className="text-xs font-semibold uppercase tracking-wide">away</div>
                    <div className="mt-1 text-sm">{t("businessHoursPreviewAway")}</div>
                  </div>
                </div>
              </div>

              <Link
                href="/inbox/automation"
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-orange-700 hover:text-orange-800 dark:text-orange-300"
              >
                {t("businessHoursOpenAutomation")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </aside>
          </section>
        )}
      </main>
    </div>
  );
}
