
import { readFileSync, mkdirSync, writeFileSync, statSync, statfsSync } from "node:fs"
import path from "node:path"
const e = process.env
if (e.CI !== "true" || e.GITHUB_ACTIONS !== "true" || e.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"
  || e.SUPPORT_AUDIT_ACCEPTANCE !== "ephemeral-audit-20261004-v1"
  || !/^[a-f0-9]{40}$/.test(e.GITHUB_SHA || "")) process.exit(1)
const [stage, status, harnessStatus, captureStatus] = process.argv.slice(2)
if (!["APP_STARTING", "APP_READY", "HARNESS_RUNNING", "HARNESS_FINISHED", "CAPTURE_RUNNING", "CAPTURE_FINISHED"].includes(stage)
  || ![status, harnessStatus, captureStatus].every(value => /^\d{1,3}$/.test(value || ""))) process.exit(1)
const fileMetadata = {}
const safeIoCodes = new Set(["ENOENT", "ENOSPC", "EACCES", "EPERM", "EMFILE", "ENFILE", "EIO"])
const read = (file, key) => {
  try {
    const stat = statSync(file)
    fileMetadata[key] = { exists: true, bytes: stat.size, readable: false }
    const result = readFileSync(file, "utf8").slice(0, 16 * 1024 * 1024)
    fileMetadata[key].readable = true
    return result
  } catch (error) {
    fileMetadata[key] = { ...fileMetadata[key], readError: safeIoCodes.has(error.code) ? error.code : "OTHER" }
    return ""
  }
}
const log = read("/tmp/support-ux-evidence-app.log", "app")
  + read(path.join(e.RUNNER_TEMP, "support-audit-harness.log"), "harness")
  + read(path.join(e.RUNNER_TEMP, "support-audit-capture.log"), "capture")
let capacity
try {
  const stat = statfsSync(process.cwd())
  capacity = { availableBytes: stat.bavail * stat.bsize, availableInodes: stat.ffree }
} catch { capacity = { unavailable: true } }
const signals = ["SUPPORT_BACKEND_OUTBOUND_BLOCKED", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND",
  "ECONNREFUSED", "EADDRINUSE", "ERR_SOCKET_BAD_PORT", "ERR_INVALID_ARG_TYPE", "STARTUP_GUARD_FAILED",
  "TypeError", "ReferenceError", "SyntaxError", "PrismaClientInitializationError", "heap out of memory", "ENOSPC", "EACCES", "EMFILE", "ERR_REQUIRE_ESM", "TimeoutError", "TargetClosedError", "Executable doesn\'t exist"].filter(code => log.includes(code))
const network = e.SUPPORT_BACKEND_NETWORK_LOG ? read(e.SUPPORT_BACKEND_NETWORK_LOG, "network") : ""
const report = { schemaVersion: 1, candidateHead: e.GITHUB_SHA, stage, exitStatus: Number(status), harnessExitStatus: Number(harnessStatus), captureExitStatus: Number(captureStatus), signals, fileMetadata, capacity,
  outboundBlocked: network.split("\n").filter(line => line === "OUTBOUND_BLOCKED").length,
  guardChecks: { commitMatches: e.SUPPORT_EVIDENCE_COMMIT === e.GITHUB_SHA,
    demoNameMatches: e.SCREENSHOT_DEMO_ORG === "Northstar Support Lab",
    organizationPresent: Boolean(e.SUPPORT_EVIDENCE_ORGANIZATION_ID) } }
const target = path.resolve("artifacts", "support-ux", e.GITHUB_SHA)
mkdirSync(target, { recursive: true })
writeFileSync(path.join(target, "audit-stage-evidence.json"), JSON.stringify(report, null, 2) + "\n")
