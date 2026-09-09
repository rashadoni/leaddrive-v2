import path from "node:path"
import { existsSync, realpathSync } from "node:fs"

/**
 * Canonical paths for mutable application data.
 *
 * A production artifact may run from an ignored `.next/standalone` tree, but
 * the checkout at `/opt/leaddrive-v2` is source only. Runtime writes must not
 * fall back to either tree: a replacement deploy would otherwise create hidden
 * persistence and make the checkout dirty again.
 *
 * Development keeps the historical local layout so contributors do not need
 * root-owned `/var/lib` directories. Production defaults are deliberately
 * absolute and are created by `scripts/server-deploy.sh` before PM2 starts.
 */
export const DEFAULT_PRODUCTION_RUNTIME_DIR = "/var/lib/leaddrive-v2"
export const DEFAULT_PRODUCTION_LOG_DIR = "/var/lib/leaddrive-v2-logs"
const DEFAULT_PRODUCTION_CHECKOUT_ROOT = "/opt/leaddrive-v2"
const TRANSIENT_RUNTIME_ROOTS = ["/tmp", "/var/tmp", "/run", "/dev", "/proc", "/sys"]
const HOST_ROOTS = new Set(["/", "/var", "/var/lib", "/var/log", "/etc", "/usr", "/usr/local", "/opt"])

type RuntimePathEnv = Partial<Pick<NodeJS.ProcessEnv,
  "LEADDRIVE_RUNTIME_DIR" | "LEADDRIVE_LOG_DIR" | "HELP_VIDEO_ASSET_DIR" | "MTM_DOCUMENT_STORAGE_DIR" | "APP_DIR" | "NODE_ENV"
>>

export type RuntimePaths = {
  runtimeRoot: string
  publicUploadsRoot: string
  privateUploadsRoot: string
  logRoot: string
  helpVideoAssetsRoot: string
}

function configuredAbsolutePath(name: string, value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`${name} must be an absolute path`)
  }
  return path.resolve(trimmed)
}

function resolvedPathThroughExistingParents(value: string): string {
  let existing = path.resolve(value)
  const missingSegments: string[] = []

  while (!existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) return path.resolve(value)
    missingSegments.unshift(path.basename(existing))
    existing = parent
  }

  return path.join(realpathSync.native(existing), ...missingSegments)
}

function isWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left)
}

function inferredCheckoutRoot(cwd: string): string {
  const resolved = resolvedPathThroughExistingParents(cwd)
  const standaloneMarker = `${path.sep}.next${path.sep}standalone`
  const markerIndex = resolved.indexOf(standaloneMarker)
  return markerIndex >= 0 ? resolved.slice(0, markerIndex) : resolved
}

function assertDedicatedExternalRuntimePath(
  name: string,
  candidate: string,
  checkoutRoots: readonly string[],
): void {
  if (HOST_ROOTS.has(candidate)) {
    throw new Error(`${name} must name a dedicated runtime directory, not a host root`)
  }
  if (TRANSIENT_RUNTIME_ROOTS.some((root) => isWithin(candidate, root))) {
    throw new Error(`${name} must not use an ephemeral or kernel-managed path`)
  }
  if (checkoutRoots.some((root) => isWithin(candidate, root))) {
    throw new Error(`${name} must stay outside the application checkout`)
  }
}

function safeRuntimeSubdir(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error("Runtime upload subdirectory is invalid")
  }
  return name
}

/**
 * Resolve all mutable paths from an explicit environment for testability. Do
 * not pass request-derived values here: path configuration is operator-owned.
 */
export function resolveRuntimePaths(
  env: RuntimePathEnv = process.env,
  cwd = process.cwd(),
): RuntimePaths {
  const configuredRuntimeRoot = configuredAbsolutePath("LEADDRIVE_RUNTIME_DIR", env.LEADDRIVE_RUNTIME_DIR)
  const production = env.NODE_ENV === "production"
  const runtimeRoot = resolvedPathThroughExistingParents(configuredRuntimeRoot
    ?? (production ? DEFAULT_PRODUCTION_RUNTIME_DIR : path.resolve(cwd, ".runtime", "leaddrive-v2")))
  const externalRuntime = Boolean(configuredRuntimeRoot) || production

  const configuredLogRoot = configuredAbsolutePath("LEADDRIVE_LOG_DIR", env.LEADDRIVE_LOG_DIR)
  const configuredHelpVideos = configuredAbsolutePath("HELP_VIDEO_ASSET_DIR", env.HELP_VIDEO_ASSET_DIR)
  const logRoot = resolvedPathThroughExistingParents(
    configuredLogRoot ?? (production ? DEFAULT_PRODUCTION_LOG_DIR : path.resolve(cwd, "logs")),
  )
  const helpVideoAssetsRoot = resolvedPathThroughExistingParents(
    configuredHelpVideos
      ?? (externalRuntime ? path.join(runtimeRoot, "help-videos", "player") : path.resolve(cwd, "video", "player")),
  )
  const uploadsRoot = path.join(runtimeRoot, "uploads")
  const stateRoot = path.join(runtimeRoot, "state")

  if (externalRuntime) {
    const configuredAppRoot = configuredAbsolutePath("APP_DIR", env.APP_DIR)
    const checkoutRoots = [
      resolvedPathThroughExistingParents(DEFAULT_PRODUCTION_CHECKOUT_ROOT),
      inferredCheckoutRoot(cwd),
      ...(configuredAppRoot ? [resolvedPathThroughExistingParents(configuredAppRoot)] : []),
    ]

    assertDedicatedExternalRuntimePath("LEADDRIVE_RUNTIME_DIR", runtimeRoot, checkoutRoots)
    assertDedicatedExternalRuntimePath("LEADDRIVE_LOG_DIR", logRoot, checkoutRoots)
    assertDedicatedExternalRuntimePath("HELP_VIDEO_ASSET_DIR", helpVideoAssetsRoot, checkoutRoots)
    if (pathsOverlap(logRoot, runtimeRoot)) {
      throw new Error("LEADDRIVE_LOG_DIR must not overlap LEADDRIVE_RUNTIME_DIR")
    }
    if (pathsOverlap(helpVideoAssetsRoot, uploadsRoot) || pathsOverlap(helpVideoAssetsRoot, stateRoot)) {
      throw new Error("HELP_VIDEO_ASSET_DIR must not overlap runtime uploads or state")
    }
  }

  return {
    runtimeRoot,
    // Existing development/test fixtures still live below public/. In every
    // production configuration, both classes land in one external root.
    publicUploadsRoot: externalRuntime
      ? uploadsRoot
      : path.resolve(cwd, "public", "uploads"),
    privateUploadsRoot: externalRuntime
      ? uploadsRoot
      : path.resolve(cwd, "uploads"),
    logRoot,
    helpVideoAssetsRoot,
  }
}

export function runtimePublicUploadsRoot(): string {
  return resolveRuntimePaths().publicUploadsRoot
}

export function runtimePrivateUploadsRoot(): string {
  return resolveRuntimePaths().privateUploadsRoot
}

export function runtimePublicUploadDirectory(subdir: string): string {
  return path.join(runtimePublicUploadsRoot(), safeRuntimeSubdir(subdir))
}

export function runtimePrivateUploadDirectory(subdir: string): string {
  return path.join(runtimePrivateUploadsRoot(), safeRuntimeSubdir(subdir))
}

export function runtimeHelpVideoAssetsRoot(): string {
  return resolveRuntimePaths().helpVideoAssetsRoot
}
