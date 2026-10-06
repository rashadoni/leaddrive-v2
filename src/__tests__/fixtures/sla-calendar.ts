export const syntheticSlaCalendar = {
  version: 1 as const, sourceId: "calendar-synthetic", capturedAt: "2026-10-04T00:00:00.000Z",
  sourceUpdatedAt: "2026-10-03T00:00:00.000Z", timezone: "Asia/Baku",
  boundaryPolicy: "reject_ambiguous_or_missing" as const,
  schedule: Object.fromEntries(["mon", "tue", "wed", "thu", "fri"].map(day => [day, { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] }])),
  holidays: [],
}
