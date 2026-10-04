
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
const e = process.env
if (e.CI !== "true" || e.GITHUB_ACTIONS !== "true" || e.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"
  || e.SUPPORT_AUDIT_ACCEPTANCE !== "ephemeral-audit-20261004-v1"
  || !/^[a-f0-9]{40}$/.test(e.GITHUB_SHA || "")) process.exit(1)
const [stage, status, harnessStatus, captureStatus] = process.argv.slice(2)
if (!["APP_STARTING", "APP_READY", "HARNESS_RUNNING", "HARNESS_FINISHED", "CAPTURE_RUNNING", "CAPTURE_FINISHED"].includes(stage)
  || ![status, harnessStatus, captureStatus].every(value => /^\d{1,3}$/.test(value || ""))) process.exit(1)
const read = file => { try { return readFileSync(file, "utf8").slice(0, 16 * 1024 * 1024) } catch { return "" } }
const log = read("/tmp/support-ux-evidence-app.log") + read(path.join(e.RUNNER_TEMP, "support-audit-harness.log"))
const signals = ["SUPPORT_BACKEND_OUTBOUND_BLOCKED", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND",
  "ECONNREFUSED", "EADDRINUSE", "ERR_SOCKET_BAD_PORT", "ERR_INVALID_ARG_TYPE", "STARTUP_GUARD_FAILED",
  "TypeError", "ReferenceError", "SyntaxError", "PrismaClientInitializationError", "heap out of memory"].filter(code => log.includes(code))
const network = e.SUPPORT_BACKEND_NETWORK_LOG ? read(e.SUPPORT_BACKEND_NETWORK_LOG) : ""
const report = { schemaVersion: 1, candidateHead: e.GITHUB_SHA, stage, exitStatus: Number(status), harnessExitStatus: Number(harnessStatus), captureExitStatus: Number(captureStatus), signals,
  outboundBlocked: network.split("\n").filter(line => line === "OUTBOUND_BLOCKED").length,
  guardChecks: { commitMatches: e.SUPPORT_EVIDENCE_COMMIT === e.GITHUB_SHA,
    demoNameMatches: e.SCREENSHOT_DEMO_ORG === "Northstar Support Lab",
    organizationPresent: Boolean(e.SUPPORT_EVIDENCE_ORGANIZATION_ID) } }
const target = path.resolve("artifacts", "support-ux", e.GITHUB_SHA)
mkdirSync(target, { recursive: true })
writeFileSync(path.join(target, "audit-stage-evidence.json"), JSON.stringify(report, null, 2) + "\n")
