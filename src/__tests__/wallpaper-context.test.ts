import { describe, it, expect } from "vitest"
import { resolveInitialWallpaper, DEFAULT_WALLPAPER, WALLPAPERS } from "@/contexts/wallpaper-context"

describe("resolveInitialWallpaper — default-on wallpaper for all users/tenants", () => {
  it("defaults to the alpine wallpaper when nothing is saved", () => {
    expect(resolveInitialWallpaper(null)).toBe(DEFAULT_WALLPAPER)
    expect(DEFAULT_WALLPAPER).toBe("alpine")
    expect(WALLPAPERS.some((w) => w.id === DEFAULT_WALLPAPER)).toBe(true)
  })

  it("defaults to alpine for an unknown/stale saved id", () => {
    expect(resolveInitialWallpaper("deleted-wallpaper")).toBe(DEFAULT_WALLPAPER)
  })

  it("keeps an explicit user choice", () => {
    expect(resolveInitialWallpaper("ocean")).toBe("ocean")
    expect(resolveInitialWallpaper("night-city")).toBe("night-city")
  })

  it("stays OFF when the user explicitly disabled the wallpaper (sentinel)", () => {
    // setWallpaper(null) persists "none"; it must NOT re-apply the default.
    expect(resolveInitialWallpaper("none")).toBeNull()
  })
})
