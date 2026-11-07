import { describe, it, expect } from "vitest"
import { bookingPhotoPath } from "@/lib/booking/service-photo"

/**
 * The column names a file this CRM wrote into its own public directory, and
 * nothing else. A service that could carry any address would put a third
 * party's URL on a page customers open without signing in, and their browsers
 * would fetch it on every visit.
 */
describe("the picture a service may carry", () => {
  it("takes a file this server wrote", () => {
    expect(bookingPhotoPath("/uploads/booking-photos/service-0a1b2c3d.jpg")).toBe("/uploads/booking-photos/service-0a1b2c3d.jpg")
    expect(bookingPhotoPath("/uploads/booking-photos/service-0a1b.png")).toBe("/uploads/booking-photos/service-0a1b.png")
    expect(bookingPhotoPath("/uploads/booking-photos/service-0a1b.webp")).toBe("/uploads/booking-photos/service-0a1b.webp")
    expect(bookingPhotoPath("  /uploads/booking-photos/service-0a1b.jpeg  ")).toBe("/uploads/booking-photos/service-0a1b.jpeg")
  })

  it("refuses an address somewhere else", () => {
    expect(bookingPhotoPath("https://tracker.example/pixel.png")).toBeNull()
    expect(bookingPhotoPath("//tracker.example/pixel.png")).toBeNull()
    expect(bookingPhotoPath("data:image/png;base64,iVBORw0KGgo=")).toBeNull()
    expect(bookingPhotoPath("javascript:alert(1)")).toBeNull()
  })

  it("refuses a path that climbs out of the directory", () => {
    expect(bookingPhotoPath("/uploads/booking-photos/../contracts/secret.pdf")).toBeNull()
    expect(bookingPhotoPath("/uploads/booking-photos/..%2Fsecret.png")).toBeNull()
    expect(bookingPhotoPath("/uploads/contracts/secret.png")).toBeNull()
    expect(bookingPhotoPath("/uploads/booking-photos/sub/dir.png")).toBeNull()
  })

  it("refuses what is not a picture at all", () => {
    expect(bookingPhotoPath("/uploads/booking-photos/service.svg")).toBeNull()
    expect(bookingPhotoPath("/uploads/booking-photos/service.html")).toBeNull()
    expect(bookingPhotoPath("/uploads/booking-photos/.png")).toBeNull()
    expect(bookingPhotoPath("")).toBeNull()
    expect(bookingPhotoPath(null)).toBeNull()
    expect(bookingPhotoPath(42)).toBeNull()
  })
})
