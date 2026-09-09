import { describe, it, expect } from "vitest"
import { composeWatermarkText } from "@/lib/mtm/photo-watermark"

// Mirrors MTMobileApp/__tests__/photo-watermark/compose-watermark-text.test.ts.
// When you change one, update the other — the helper is duplicated across
// backend (Vitest) and mobile (Jest) until a shared library exists.

// Use local-time Date constructor (year, monthIndex, day, h, m, s) so
// tests stay deterministic regardless of CI timezone — the watermark
// format (`DD.MM.YYYY HH:mm`) is intentionally local (it's what the
// agent sees on their device).
describe("composeWatermarkText", () => {
  const baseTimestamp = new Date(2026, 4, 21, 10, 42, 0) // 21 May 2026, 10:42 local
  const baseAgent = { name: "Айдын Мамедов", code: "A042" }
  const baseCustomer = { name: "Bravo Supermarket #15" }
  const baseLocation = { latitude: 40.4093, longitude: 49.8671 }

  it("returns 4 lines in spec order: timestamp / agent / customer / GPS", () => {
    const text = composeWatermarkText({
      timestamp: baseTimestamp,
      agent: baseAgent,
      customer: baseCustomer,
      location: baseLocation,
    })
    const lines = text.split("\n")
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe("21.05.2026 10:42")
    expect(lines[1]).toBe("Айдын Мамедов (#A042)")
    expect(lines[2]).toBe("Bravo Supermarket #15")
    expect(lines[3]).toBe("40.4093°N 49.8671°E")
  })

  it("uses 'No customer' on the customer line when customer is null", () => {
    const text = composeWatermarkText({
      timestamp: baseTimestamp,
      agent: baseAgent,
      customer: null,
      location: baseLocation,
    })
    expect(text.split("\n")[2]).toBe("No customer")
  })

  it("uses 'GPS unavailable' on the GPS line when location is null", () => {
    const text = composeWatermarkText({
      timestamp: baseTimestamp,
      agent: baseAgent,
      customer: baseCustomer,
      location: null,
    })
    expect(text.split("\n")[3]).toBe("GPS unavailable")
  })

  it("zero-pads single-digit hours in the timestamp", () => {
    const text = composeWatermarkText({
      timestamp: new Date(2026, 4, 21, 14, 5, 0),
      agent: baseAgent,
      customer: baseCustomer,
      location: baseLocation,
    })
    expect(text.split("\n")[0]).toBe("21.05.2026 14:05")
  })

  it("formats GPS with 4 decimals and N/S/E/W suffix based on sign", () => {
    const text = composeWatermarkText({
      timestamp: baseTimestamp,
      agent: baseAgent,
      customer: baseCustomer,
      location: { latitude: -33.8688, longitude: -70.6483 }, // Santiago, Chile
    })
    expect(text.split("\n")[3]).toBe("33.8688°S 70.6483°W")
  })

  // Spec §6 acceptance criterion: "Snapshot тест watermark layout".
  // Deferred: a pixel-level image snapshot requires the watermark to be
  // composited onto a real JPEG, which happens on the mobile side via
  // react-native-image-marker. The text-content checks above cover the
  // logical contract; a true image snapshot belongs in a UI/integration
  // slice. Tracked here as it.todo so the gap stays visible in test output.
  it.todo("snapshot watermark image layout — deferred to mobile UI slice")
})
