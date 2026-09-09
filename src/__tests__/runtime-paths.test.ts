import path from "node:path"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_PRODUCTION_LOG_DIR,
  DEFAULT_PRODUCTION_RUNTIME_DIR,
  resolveRuntimePaths,
  runtimePublicUploadDirectory,
} from "@/lib/runtime-paths"

describe("runtime data paths", () => {
  it("keeps development fixtures in their historical local roots", () => {
    const paths = resolveRuntimePaths({ NODE_ENV: "test" }, "/workspace/leaddrive")

    expect(paths.runtimeRoot).toBe("/workspace/leaddrive/.runtime/leaddrive-v2")
    expect(paths.publicUploadsRoot).toBe("/workspace/leaddrive/public/uploads")
    expect(paths.privateUploadsRoot).toBe("/workspace/leaddrive/uploads")
    expect(paths.helpVideoAssetsRoot).toBe("/workspace/leaddrive/video/player")
  })

  it("uses external production roots without a checkout fallback", () => {
    const paths = resolveRuntimePaths({ NODE_ENV: "production" }, "/opt/leaddrive-v2/.next/standalone")

    expect(DEFAULT_PRODUCTION_RUNTIME_DIR).toBe("/var/lib/leaddrive-v2")
    expect(DEFAULT_PRODUCTION_LOG_DIR).toBe("/var/lib/leaddrive-v2-logs")
    expect(paths.runtimeRoot).toBe(DEFAULT_PRODUCTION_RUNTIME_DIR)
    expect(paths.publicUploadsRoot).toBe(`${DEFAULT_PRODUCTION_RUNTIME_DIR}/uploads`)
    expect(paths.privateUploadsRoot).toBe(`${DEFAULT_PRODUCTION_RUNTIME_DIR}/uploads`)
    expect(paths.logRoot).toBe(DEFAULT_PRODUCTION_LOG_DIR)
    expect(paths.helpVideoAssetsRoot).toBe(`${DEFAULT_PRODUCTION_RUNTIME_DIR}/help-videos/player`)
  })

  it("honours an operator-owned external runtime root consistently", () => {
    const paths = resolveRuntimePaths({
      NODE_ENV: "test",
      LEADDRIVE_RUNTIME_DIR: "/srv/leaddrive-runtime/../runtime",
      LEADDRIVE_LOG_DIR: "/srv/leaddrive-logs",
      HELP_VIDEO_ASSET_DIR: "/srv/leaddrive-help/player",
    }, "/workspace/leaddrive")

    expect(paths.runtimeRoot).toBe("/srv/runtime")
    expect(paths.publicUploadsRoot).toBe("/srv/runtime/uploads")
    expect(paths.privateUploadsRoot).toBe("/srv/runtime/uploads")
    expect(paths.logRoot).toBe("/srv/leaddrive-logs")
    expect(paths.helpVideoAssetsRoot).toBe("/srv/leaddrive-help/player")
  })

  it("rejects relative operator paths rather than resolving them through the checkout", () => {
    expect(() => resolveRuntimePaths({ LEADDRIVE_RUNTIME_DIR: "runtime" }, "/workspace/leaddrive"))
      .toThrow("LEADDRIVE_RUNTIME_DIR must be an absolute path")
    expect(() => resolveRuntimePaths({ LEADDRIVE_LOG_DIR: "logs" }, "/workspace/leaddrive"))
      .toThrow("LEADDRIVE_LOG_DIR must be an absolute path")
  })

  it("rejects checkout, transient, and overlapping external runtime roots", () => {
    expect(() => resolveRuntimePaths({
      NODE_ENV: "production",
      LEADDRIVE_RUNTIME_DIR: "/opt/leaddrive-v2/uploads",
    }, "/opt/leaddrive-v2/.next/standalone"))
      .toThrow("LEADDRIVE_RUNTIME_DIR must stay outside the application checkout")

    expect(() => resolveRuntimePaths({
      NODE_ENV: "production",
      LEADDRIVE_RUNTIME_DIR: "/var/lib/leaddrive-v2",
      LEADDRIVE_LOG_DIR: "/run/leaddrive-logs",
    }, "/opt/leaddrive-v2/.next/standalone"))
      .toThrow("LEADDRIVE_LOG_DIR must not use an ephemeral or kernel-managed path")

    expect(() => resolveRuntimePaths({
      NODE_ENV: "production",
      LEADDRIVE_RUNTIME_DIR: "/srv/leaddrive-runtime",
      LEADDRIVE_LOG_DIR: "/srv/leaddrive-runtime/logs",
    }, "/opt/leaddrive-v2/.next/standalone"))
      .toThrow("LEADDRIVE_LOG_DIR must not overlap LEADDRIVE_RUNTIME_DIR")

    expect(() => resolveRuntimePaths({
      NODE_ENV: "production",
      LEADDRIVE_RUNTIME_DIR: "/srv/leaddrive-runtime",
      HELP_VIDEO_ASSET_DIR: "/srv/leaddrive-runtime/uploads/help-videos",
    }, "/opt/leaddrive-v2/.next/standalone"))
      .toThrow("HELP_VIDEO_ASSET_DIR must not overlap runtime uploads or state")
  })

  it("does not accept a request-shaped upload subdirectory", () => {
    expect(() => runtimePublicUploadDirectory(`avatars${path.sep}other`))
      .toThrow("Runtime upload subdirectory is invalid")
  })

  it("keeps former dual-writers out of the checkout and standalone trees", () => {
    const writers = [
      "src/app/api/v1/contracts/upload-image/route.ts",
      "src/app/api/v1/inbox/upload/route.ts",
      "src/app/api/v1/public/web-chat/upload/route.ts",
      "src/lib/telegram-media.ts",
      "src/lib/whatsapp-media.ts",
    ]

    for (const relativePath of writers) {
      const source = readFileSync(path.join(process.cwd(), relativePath), "utf8")
      expect(source, relativePath).toContain("@/lib/runtime-paths")
      expect(source, relativePath).not.toContain("process.env.APP_DIR")
      expect(source, relativePath).not.toContain("process.cwd()")
    }
  })
})
