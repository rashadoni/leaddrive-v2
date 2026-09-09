import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"

describe("persistent runtime upload directory parity", () => {
  it("moves all legacy upload roots into one external authority without a fallback", () => {
    const deploy = readFileSync(
      path.join(process.cwd(), "scripts", "server-deploy.sh"),
      "utf8",
    )
    const proxy = readFileSync(
      path.join(process.cwd(), "src/app/api/v1/uploads/[...path]/route.ts"),
      "utf8",
    )

    expect(deploy).toContain('RUNTIME_UPLOADS_DIR="$(canonical_external_path "LEADDRIVE_RUNTIME_DIR/uploads"')
    expect(deploy).toContain('move_runtime_directory_and_link "$APP_DIR/uploads" "$RUNTIME_UPLOADS_DIR" "uploads"')
    expect(deploy).toContain("merge_legacy_public_uploads_into_canonical_root")
    expect(deploy).toContain("legacy_public_uploads_merge_preflight")
    expect(deploy).toContain('No legacy public upload directory; a compatibility symlink will be created after cutover')
    expect(deploy).toContain('legacy-public-merge status=linked-empty')
    expect(deploy).toContain('LEADDRIVE_RUNTIME_DIR/uploads must not resolve through a symlink')
    expect(deploy).toContain('MTM_DOCUMENT_STORAGE_DIR must stay inside the canonical runtime uploads root')
    expect(deploy).not.toContain("LEADDRIVE_LEGACY_PUBLIC_UPLOADS_DIR")
    expect(proxy).toContain("runtimePublicUploadsRoot")
    expect(proxy).not.toContain("runtimeLegacyPublicUploadsRoot")
  })

  it("routes uploads through the API before Next.js can serve public files", () => {
    const config = readFileSync(
      path.join(process.cwd(), "next.config.ts"),
      "utf8",
    )

    // Next.js array-form rewrites run after filesystem/public lookup. Keep this
    // security boundary in beforeFiles so a real file cannot bypass GET's
    // canonical-public or session/RBAC decision.
    expect(config).toMatch(
      /async rewrites\(\)\s*\{\s*return\s*\{[\s\S]*?beforeFiles:\s*\[\s*\{\s*source:\s*["']\/uploads\/:path\*["'],\s*destination:\s*["']\/api\/v1\/uploads\/:path\*["']\s*\},?\s*\]/,
    )
    expect(config).toMatch(/afterFiles:\s*\[\s*\]/)
    expect(config).toMatch(/fallback:\s*\[\s*\]/)
    expect(config).not.toMatch(
      /async rewrites\(\)\s*\{\s*return\s*\[\s*\{\s*source:\s*["']\/uploads\//,
    )
  })
})
