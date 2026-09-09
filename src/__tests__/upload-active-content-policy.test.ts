import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"

describe("runtime upload active-content policy", () => {
  it.each([
    "src/app/api/v1/email-templates/upload-image/route.ts",
    "src/app/api/v1/admin/upload-logo/route.ts",
  ])("does not accept SVG in %s", (relativePath) => {
    const source = readFileSync(path.join(process.cwd(), relativePath), "utf8")
    expect(source).toContain("decodeAndReencodeSafeRaster")
    expect(source).not.toMatch(/await\s+req\.formData\(/)
    expect(source).not.toContain('"image/svg+xml"')
  })

  it("keeps the shared public raster decoder limited to static PNG/JPEG/WebP", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/safe-raster-upload.ts"),
      "utf8",
    )
    expect(source).toContain('["image/png"')
    expect(source).toContain('["image/jpeg"')
    expect(source).toContain('["image/webp"')
    expect(source).not.toContain('["image/svg+xml"')
    expect(source).not.toContain('["image/gif"')
  })

  it.each([
    "src/components/email-template-form.tsx",
    "src/app/admin/tenants/new/page.tsx",
    "src/app/admin/tenants/[id]/edit/page.tsx",
  ])("does not offer active or animated public-image formats in %s", (relativePath) => {
    const source = readFileSync(path.join(process.cwd(), relativePath), "utf8")
    expect(source).not.toMatch(/accept\s*=?.*image\/svg\+xml/)
    expect(source).not.toMatch(/accept\s*=?.*image\/gif/)
  })
})
