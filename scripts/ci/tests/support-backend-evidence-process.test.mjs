import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, stat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { runLoggedCommand } from "../../support-backend-evidence-process.mjs"

async function fixture(fn) {
  const cwd = await mkdtemp(path.join(tmpdir(), "support-backend-process-unit-"))
  try { await fn({ cwd, env: { PATH: process.env.PATH }, logPath: path.join(cwd, "private.log") }) }
  finally { await rm(cwd, { recursive: true, force: true }) }
}

test("opened log fd captures both streams in a private file", async () => fixture(async options => {
  const result = await runLoggedCommand(process.execPath, ["-e", 'console.log("synthetic stdout"); console.error("synthetic stderr")'], options)
  assert.deepEqual(result, { code: 0, signal: null })
  const output = await readFile(options.logPath, "utf8")
  assert.match(output, /synthetic stdout/)
  assert.match(output, /synthetic stderr/)
  assert.equal((await stat(options.logPath)).mode & 0o777, 0o600)
}))

test("nonzero child exit is returned without inventing success", async () => fixture(async options => {
  assert.deepEqual(await runLoggedCommand(process.execPath, ["-e", "process.exit(17)"], options), { code: 17, signal: null })
}))

test("spawn error is sanitized and the log is closed", async () => fixture(async options => {
  await assert.rejects(runLoggedCommand(path.join(options.cwd, "missing-executable"), [], options), /CHILD_SPAWN_FAILED/)
  assert.equal(await readFile(options.logPath, "utf8"), "")
}))

test("deadline stops a hanging child and reports timeout", { timeout: 15_000 }, async () => fixture(async options => {
  const pidFile = path.join(options.cwd, "pid")
  await assert.rejects(runLoggedCommand(process.execPath, ["-e", 'require("node:fs").writeFileSync(process.argv[1],String(process.pid)); setInterval(()=>{},1000)', pidFile], { ...options, timeoutMs: 1000 }), /CHILD_COMMAND_TIMEOUT/)
  const pid = Number(await readFile(pidFile, "utf8"))
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
}))

test("deadline escalates when an owned child ignores TERM", { timeout: 15_000 }, async () => fixture(async options => {
  const pidFile = path.join(options.cwd, "pid")
  await assert.rejects(runLoggedCommand(process.execPath, ["-e", 'require("node:fs").writeFileSync(process.argv[1],String(process.pid)); process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)', pidFile], { ...options, timeoutMs: 1000 }), /CHILD_COMMAND_TIMEOUT/)
  const pid = Number(await readFile(pidFile, "utf8"))
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
}))
