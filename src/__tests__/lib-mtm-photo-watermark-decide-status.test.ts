import { describe, it, expect } from "vitest"
import { decidePhotoStatus } from "@/lib/mtm/photo-watermark"

// Orchestrator on top of validateExif — it merges validation result with
// time-drift handling and produces the final DB row scaffold.
describe("decidePhotoStatus", () => {
  const validExif: Record<string, unknown> = {
    DateTimeOriginal: "2026:05:21 10:42:00",
    GPSLatitude: 40.4093,
    GPSLongitude: 49.8671,
    GPSLatitudeRef: "N",
    GPSLongitudeRef: "E",
    Make: "LeadDrive MTM",
    Model: "v1.1.2",
    Software: "LeadDrive MTM Mobile",
    ImageDescription: JSON.stringify({
      agentId: "agent-1",
      visitId: "visit-1",
      customerId: "customer-1",
    }),
  }
  const validClaim = { latitude: 40.4093, longitude: 49.8671, agentId: "agent-1" }
  const serverNow = new Date("2026-05-21T10:42:30Z") // 30s after capture, well inside drift

  it("APPROVED with full watermark flags when EXIF is valid", () => {
    const decision = decidePhotoStatus({
      exif: validExif,
      claim: validClaim,
      serverNow,
    })
    expect(decision.status).toBe("APPROVED")
    expect(decision.hasWatermark).toBe(true)
    expect(decision.tamperingDetected).toBe(false)
    expect(decision.reviewNote).toBeNull()
    expect(decision.gpsMatchedAt).toBeInstanceOf(Date)
    expect(decision.watermarkedAt).toBeInstanceOf(Date)
    expect(decision.timeDriftCorrected).toBe(false)
  })

  it("PENDING + tamperingDetected when GPS mismatches by >50 m", () => {
    const decision = decidePhotoStatus({
      exif: { ...validExif, GPSLatitude: 41.0 },
      claim: validClaim,
      serverNow,
    })
    expect(decision.status).toBe("PENDING")
    expect(decision.tamperingDetected).toBe(true)
    // Spec §4 says reviewNote='EXIF mismatch'; we additionally require the
    // failure reason to be embedded (regex, format-agnostic) so review UI
    // can show actionable info without parsing a free-form string.
    expect(decision.reviewNote).toMatch(/gps_mismatch/i)
  })

  it("APPROVED with gpsMatchedAt=null when EXIF legitimately has no GPS (spec §5 edge case)", () => {
    const noGpsExif: Record<string, unknown> = { ...validExif }
    delete noGpsExif.GPSLatitude
    delete noGpsExif.GPSLongitude
    delete noGpsExif.GPSLatitudeRef
    delete noGpsExif.GPSLongitudeRef
    const decision = decidePhotoStatus({
      exif: noGpsExif,
      claim: { latitude: null, longitude: null, agentId: "agent-1" },
      serverNow,
    })
    expect(decision.status).toBe("APPROVED")
    expect(decision.hasWatermark).toBe(true)
    expect(decision.gpsMatchedAt).toBeNull()
    expect(decision.tamperingDetected).toBe(false)
  })

  it("PENDING + hasWatermark=false + reviewNote='EXIF missing' when exif is null", () => {
    const decision = decidePhotoStatus({
      exif: null,
      claim: validClaim,
      serverNow,
    })
    expect(decision.status).toBe("PENDING")
    expect(decision.hasWatermark).toBe(false)
    expect(decision.reviewNote).toBe("EXIF missing")
  })

  it("sets timeDriftCorrected=true and correctedDateTimeOriginal=serverNow when device clock drifts >5 min", () => {
    // Device EXIF claims 10:42; server is at 10:50 → 8min drift > 5min threshold.
    const decision = decidePhotoStatus({
      exif: validExif,
      claim: validClaim,
      serverNow: new Date("2026-05-21T10:50:00Z"),
    })
    expect(decision.timeDriftCorrected).toBe(true)
    expect(decision.correctedDateTimeOriginal).toBeInstanceOf(Date)
    expect(decision.correctedDateTimeOriginal!.getTime()).toBe(
      new Date("2026-05-21T10:50:00Z").getTime(),
    )
  })

  it("does NOT correct DateTimeOriginal when drift is exactly at or under the 5-min threshold (boundary case)", () => {
    // Device EXIF claims 10:42:00; server at 10:46:59 → 4m59s drift, below threshold.
    const decision = decidePhotoStatus({
      exif: validExif,
      claim: validClaim,
      serverNow: new Date("2026-05-21T10:46:59Z"),
    })
    expect(decision.timeDriftCorrected).toBe(false)
    expect(decision.correctedDateTimeOriginal).toBeNull()
  })
})
