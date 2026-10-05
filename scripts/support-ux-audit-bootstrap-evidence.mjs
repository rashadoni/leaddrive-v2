import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
const e = process.env
const scripts = new Map([
  ["support-ux-audit-functional-evidence.mjs", "functional"],
  ["support-ux-browser-evidence.mjs", "capture"],
])
const suite = scripts.get(path.basename(process.argv[1] || ""))
if (e.CI !== "true" || e.GITHUB_ACTIONS !== "true" || e.SUPPORT_EVIDENCE_TARGET_MODE !== "ephemeral"
  || e.SUPPORT_AUDIT_ACCEPTANCE !== "ephemeral-audit-20261004-v1"
  || !/^[a-f0-9]{40}$/.test(e.GITHUB_SHA || "") || e.SUPPORT_EVIDENCE_COMMIT !== e.GITHUB_SHA || !suite) process.exit(1)
const directory = path.resolve("artifacts", "support-ux", e.GITHUB_SHA)
mkdirSync(directory, { recursive: true })
const report = { schemaVersion: 1, candidateHead: e.GITHUB_SHA, suite, phase: "BOOTSTRAP_ENTERED", passed: false }
const save = () => writeFileSync(path.join(directory, "audit-bootstrap-" + suite + ".json"), JSON.stringify(report, null, 2) + "\n")
save()
const names = new Set(["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "TimeoutError", "TargetClosedError", "PrismaClientInitializationError"])
const codes = new Set(["ENOENT", "EACCES", "ENOSPC", "EMFILE", "ENFILE", "ENOMEM", "EPIPE", "EAGAIN", "ERR_DLOPEN_FAILED", "ERR_REQUIRE_ESM", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_INVALID_ARG_TYPE"])
process.on("uncaughtExceptionMonitor", error => {
  report.phase = "UNCAUGHT_EXCEPTION"
  report.errorName = names.has(error?.name) ? error.name : "OTHER"
  report.errorCode = codes.has(error?.code) ? error.code : "OTHER"
  try { save() } catch { /* Preserve the original process failure if diagnostic storage fails. */ }
})
process.on("exit", code => {
  report.exitStatus = code
  try { save() } catch { /* Preserve the original process failure if diagnostic storage fails. */ }
})
