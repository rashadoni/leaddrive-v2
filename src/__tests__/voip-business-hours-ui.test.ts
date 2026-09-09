import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { normalizeVoiceHoursSchedule } from "@/components/voip/voice-calling-hours";

const root = process.cwd();

describe("VoIP calling-hours settings UI", () => {
  it("is mounted in VoIP settings and uses the VoIP-scoped endpoint", () => {
    const page = fs.readFileSync(path.join(root, "src/app/(dashboard)/settings/voip/page.tsx"), "utf8");
    const editor = fs.readFileSync(path.join(root, "src/components/voip/voice-calling-hours.tsx"), "utf8");

    expect(page).toContain("<VoiceCallingHours />");
    expect(page).toContain("/api/v1/voip/config");
    expect(page).not.toContain("/api/v1/channels?type=voip");
    expect(editor).toContain("/api/v1/voip/business-hours");
    expect(editor).toContain('channelType: "voice"');
    expect(editor).not.toContain("/api/v1/business-hours");
    expect(editor).toContain('useState("UTC")');
  });

  it("preserves every stored interval even though the MVP editor shows the first one", () => {
    const schedule = normalizeVoiceHoursSchedule({
      mon: {
        enabled: true,
        intervals: [
          { start: "09:00", end: "12:00" },
          { start: "13:00", end: "18:00" },
        ],
      },
    });

    expect(schedule.mon.intervals).toEqual([
      { start: "09:00", end: "12:00" },
      { start: "13:00", end: "18:00" },
    ]);
  });
});
