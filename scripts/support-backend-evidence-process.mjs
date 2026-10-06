import { spawn } from "node:child_process"
import { open } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"

function groupAlive(child) {
  if (!Number.isInteger(child?.pid) || child.pid <= 1) return false
  try { process.kill(-child.pid, 0); return true }
  catch (error) { if (error.code === "ESRCH") return false; throw error }
}

export async function stopOwnedProcess(child, graceMs = 5000) {
  if (!groupAlive(child)) return
  process.kill(-child.pid, "SIGTERM")
  const deadline = Date.now() + graceMs
  while (groupAlive(child) && Date.now() < deadline) await delay(50)
  if (groupAlive(child)) {
    process.kill(-child.pid, "SIGKILL")
    const killDeadline = Date.now() + 3000
    while (groupAlive(child) && Date.now() < killDeadline) await delay(50)
  }
  if (groupAlive(child)) throw new Error("OWNED_PROCESS_GROUP_DID_NOT_STOP")
}

export async function runLoggedCommand(executable, args, { cwd, env, logPath, timeoutMs = 600_000 }) {
  // spawn requires an already opened numeric fd, not a pending WriteStream.
  const log = await open(logPath, "wx", 0o600)
  let child, timer
  try {
    child = spawn(executable, args, { cwd, env, detached: true, stdio: ["ignore", log.fd, log.fd] })
    const completion = new Promise((resolve, reject) => {
      child.once("error", () => reject(new Error("CHILD_SPAWN_FAILED")))
      child.once("exit", (code, signal) => resolve({ code, signal }))
    })
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("CHILD_COMMAND_TIMEOUT")), timeoutMs)
    })
    return await Promise.race([completion, deadline])
  } finally {
    clearTimeout(timer)
    try { await stopOwnedProcess(child) } finally { await log.close() }
  }
}
