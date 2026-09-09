"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, CheckCircle2, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type ScheduleDay = { enabled: boolean; intervals: Array<{ start: string; end: string }> };
export type VoiceHoursSchedule = Record<WeekdayKey, ScheduleDay>;

type VoiceHoursRow = {
  timezone?: string;
  schedule?: unknown;
  holidays?: unknown;
  isActive?: boolean;
};

type VoiceHoursResponse = {
  success?: boolean;
  data?: VoiceHoursRow | null;
  error?: string;
};

const WEEKDAYS: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function defaultSchedule(): VoiceHoursSchedule {
  return WEEKDAYS.reduce((schedule, day, index) => {
    schedule[day] = {
      enabled: index < 5,
      intervals: index < 5 ? [{ start: "09:00", end: "18:00" }] : [],
    };
    return schedule;
  }, {} as VoiceHoursSchedule);
}

function defaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function normalizeVoiceHoursSchedule(value: unknown): VoiceHoursSchedule {
  const schedule = defaultSchedule();
  if (!value || typeof value !== "object" || Array.isArray(value)) return schedule;
  const source = value as Record<string, unknown>;
  for (const day of WEEKDAYS) {
    const rawDay = source[day];
    if (!rawDay || typeof rawDay !== "object" || Array.isArray(rawDay)) continue;
    const record = rawDay as Record<string, unknown>;
    const intervals = Array.isArray(record.intervals)
      ? record.intervals.flatMap((rawInterval) => {
          if (!rawInterval || typeof rawInterval !== "object" || Array.isArray(rawInterval)) return [];
          const interval = rawInterval as Record<string, unknown>;
          const start = typeof interval.start === "string" ? interval.start : null;
          const end = typeof interval.end === "string" ? interval.end : null;
          return start && end ? [{ start, end }] : [];
        })
      : [];
    schedule[day] = {
      enabled: record.enabled === true,
      intervals: record.enabled === true && intervals.length === 0
        ? [{ start: "09:00", end: "18:00" }]
        : intervals,
    };
  }
  return schedule;
}

export function VoiceCallingHours() {
  const t = useTranslations("forms");
  // Deterministic SSR value avoids a server/client timezone hydration drift.
  // The browser timezone is applied after the API returns no saved row.
  const [timezone, setTimezone] = useState("UTC");
  const [schedule, setSchedule] = useState<VoiceHoursSchedule>(defaultSchedule);
  const [isActive, setIsActive] = useState(true);
  const [holidays, setHolidays] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/voip/business-hours", { cache: "no-store", signal });
      const body = await response.json().catch(() => ({})) as VoiceHoursResponse;
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (body.data) {
        setTimezone(body.data.timezone || defaultTimezone());
        setSchedule(normalizeVoiceHoursSchedule(body.data.schedule));
        setHolidays(Array.isArray(body.data.holidays) ? body.data.holidays : []);
        setIsActive(body.data.isActive !== false);
      } else setTimezone(defaultTimezone());
    } catch (loadError) {
      if ((loadError as Error).name !== "AbortError") {
        setError((loadError as Error).message || t("businessHoursLoadError"));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function updateDay(day: WeekdayKey, enabled: boolean) {
    setSchedule((current) => ({
      ...current,
      [day]: {
        enabled,
        // Keep all stored intervals when toggling a day so a UI that currently
        // edits only the first interval never destroys the untouched remainder.
        intervals: enabled && current[day].intervals.length === 0
          ? [{ start: "09:00", end: "18:00" }]
          : current[day].intervals,
      },
    }));
    setSaved(false);
  }

  function updateTime(day: WeekdayKey, field: "start" | "end", value: string) {
    setSchedule((current) => {
      const interval = current[day].intervals[0] || { start: "09:00", end: "18:00" };
      return {
        ...current,
        [day]: {
          ...current[day],
          intervals: [{ ...interval, [field]: value }, ...current[day].intervals.slice(1)],
        },
      };
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/v1/voip/business-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelType: "voice",
          timezone,
          schedule,
          holidays,
          isActive,
          welcomeMessage: null,
          awayMessage: null,
        }),
      });
      const body = await response.json().catch(() => ({})) as VoiceHoursResponse;
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setSaved(true);
    } catch (saveError) {
      setError((saveError as Error).message || t("businessHoursSaveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="voice-calling-hours">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          {t("businessHoursVoiceTitle")}
        </CardTitle>
        <CardDescription>{t("businessHoursVoiceDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor="voice-hours-timezone">{t("businessHoursTimezone")}</Label>
            <Input
              id="voice-hours-timezone"
              value={timezone}
              onChange={(event) => { setTimezone(event.target.value); setSaved(false); }}
              placeholder="Asia/Baku"
              disabled={loading || saving}
            />
          </div>
          <div className="flex min-h-10 items-center gap-3 rounded-lg border px-3 py-2">
            <Switch
              id="voice-hours-active"
              checked={isActive}
              onCheckedChange={(checked) => { setIsActive(checked); setSaved(false); }}
              disabled={loading || saving}
            />
            <Label htmlFor="voice-hours-active">{t("businessHoursActiveToggle")}</Label>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("businessHoursLoading")}
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {WEEKDAYS.map((day) => {
              const dayConfig = schedule[day];
              const interval = dayConfig.intervals[0] || { start: "09:00", end: "18:00" };
              return (
                <div key={day} className="grid gap-3 p-3 sm:grid-cols-[minmax(8rem,1fr)_auto_minmax(13rem,1fr)] sm:items-center">
                  <span className="text-sm font-medium">{t(`businessHoursDay_${day}`)}</span>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={dayConfig.enabled}
                      onCheckedChange={(checked) => updateDay(day, checked)}
                      disabled={saving}
                      aria-label={`${t(`businessHoursDay_${day}`)} ${t("businessHoursOpen")}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {dayConfig.enabled ? t("businessHoursDayOpen") : t("businessHoursDayClosed")}
                    </span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <Input
                      type="time"
                      value={interval.start}
                      onChange={(event) => updateTime(day, "start", event.target.value)}
                      disabled={!dayConfig.enabled || saving}
                      aria-label={`${t(`businessHoursDay_${day}`)} start`}
                    />
                    <span className="text-muted-foreground">—</span>
                    <Input
                      type="time"
                      value={interval.end}
                      onChange={(event) => updateTime(day, "end", event.target.value)}
                      disabled={!dayConfig.enabled || saving}
                      aria-label={`${t(`businessHoursDay_${day}`)} end`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {saved ? (
          <p role="status" className="flex items-center gap-2 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
            {t("businessHoursSaved")}
          </p>
        ) : null}

        <Button type="button" onClick={save} disabled={loading || saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {saving ? t("businessHoursSaving") : t("businessHoursSave")}
        </Button>
      </CardContent>
    </Card>
  );
}
