import { describe, it, expect } from "vitest"
import { validateExif } from "@/lib/mtm/photo-watermark"

// The 5 cases listed verbatim in mtm-photo-watermark-spec.md §6:
//   1. valid
//   2. invalid GPS
//   3. invalid software
//   4. tampered (agentId mismatch)
//   5. missing required tag
// + one extra: null EXIF entirely.
describe("validateExif", () => {
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
      watermarked: true,
    }),
  }

  const validClaim = {
    latitude: 40.4093,
    longitude: 49.8671,
    agentId: "agent-1",
  }

  it("(1) ok=true gpsMatched=true when all required tags present and GPS within 50 m", () => {
    expect(validateExif({ exif: validExif, claim: validClaim })).toEqual({
      ok: true,
      gpsMatched: true,
    })
  })

  it("(2) ok=false reason=gps_mismatch when EXIF GPS is >50 m from claim", () => {
    const tamperedExif = { ...validExif, GPSLatitude: 40.5093 } // ~11 km N
    expect(validateExif({ exif: tamperedExif, claim: validClaim })).toEqual({
      ok: false,
      reason: "gps_mismatch",
    })
  })

  it("(3) ok=false reason=invalid_software when Software tag is not 'LeadDrive MTM Mobile'", () => {
    const tamperedExif = { ...validExif, Software: "Camera2 API" }
    expect(validateExif({ exif: tamperedExif, claim: validClaim })).toEqual({
      ok: false,
      reason: "invalid_software",
    })
  })

  it("(4) ok=false reason=agent_mismatch when ImageDescription.agentId ≠ claim.agentId", () => {
    const tamperedExif = {
      ...validExif,
      ImageDescription: JSON.stringify({
        agentId: "agent-OTHER",
        visitId: "visit-1",
        customerId: "customer-1",
      }),
    }
    expect(validateExif({ exif: tamperedExif, claim: validClaim })).toEqual({
      ok: false,
      reason: "agent_mismatch",
    })
  })

  it("(5) ok=false reason=missing_required_tag when DateTimeOriginal is absent", () => {
    const incompleteExif: Record<string, unknown> = { ...validExif }
    delete incompleteExif.DateTimeOriginal
    expect(validateExif({ exif: incompleteExif, claim: validClaim })).toEqual({
      ok: false,
      reason: "missing_required_tag",
    })
  })

  it("(6) ok=false reason=invalid_make when EXIF.Make is not 'LeadDrive MTM' (anti-tampering)", () => {
    // Spec §2 lists Make=`LeadDrive MTM` alongside Software as a required
    // identity tag; an attacker who only spoofs Software but forgets Make
    // (or vice versa) must still be rejected.
    const tamperedExif = { ...validExif, Make: "Apple" }
    expect(validateExif({ exif: tamperedExif, claim: validClaim })).toEqual({
      ok: false,
      reason: "invalid_make",
    })
  })

  it("(7) ok=false reason=invalid_model when EXIF.Model is not the app version (anti-tampering)", () => {
    // Spec §2 lists Model=`v1.1.2` (the app version) as a required identity
    // tag. Symmetric to Make: must be checked or attackers spoof half.
    const tamperedExif = { ...validExif, Model: "iPhone 15" }
    expect(validateExif({ exif: tamperedExif, claim: validClaim })).toEqual({
      ok: false,
      reason: "invalid_model",
    })
  })

  it("(extra) ok=false reason=missing_required_tag when exif is null entirely", () => {
    expect(validateExif({ exif: null, claim: validClaim })).toEqual({
      ok: false,
      reason: "missing_required_tag",
    })
  })
})
