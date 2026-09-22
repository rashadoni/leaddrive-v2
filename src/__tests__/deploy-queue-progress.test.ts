/**
 * A burst of merges must not starve production.
 *
 * On 2026-09-21 the owner's parallel sessions merged into main every 5–15
 * minutes, while a production build takes ~18. deploy.yml let every push
 * cancel the checks and build in flight, so 31 of the 39 runs that day ended
 * «cancelled» and a merge waited up to 90 minutes to go live (#366: merged
 * 20:22 UTC, live 21:53). Nothing reaches users until the merging stops.
 *
 * These tests read the queue settings deploy.yml really has, evaluate them the
 * way GitHub does for a push, a manual re-deploy and a bootstrap resume, and
 * replay bursts of merges through GitHub's documented concurrency rules: the
 * 39 real pushes of 2026-09-21 and a steady merge every five minutes. They
 * check behaviour — how long a merge waits to go live — not the spelling of
 * the YAML.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Read as text: js-yaml is only present transitively here (see
// ci-static-checks-skipped-on-main.test.ts), and the concurrency blocks are
// flat enough to read directly.
const workflow = readFileSync(join(process.cwd(), ".github/workflows/deploy.yml"), "utf8")

function jobBlock(jobName: string): string {
  const lines = workflow.split("\n")
  const start = lines.findIndex((line) => line === `  ${jobName}:`)
  expect(start, `deploy.yml has no job "${jobName}"`).toBeGreaterThan(-1)
  const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line))
  return lines.slice(start, end === -1 ? lines.length : end).join("\n")
}

/** The raw `group:` and `cancel-in-progress:` values of a job's own concurrency block. */
function concurrencyOf(jobName: string): { group: string; cancel: string } {
  const block = jobBlock(jobName)
  const at = block.indexOf("\n    concurrency:\n")
  expect(at, `${jobName} has no job-level concurrency`).toBeGreaterThan(-1)
  const body: string[] = []
  for (const line of block.slice(at + "\n    concurrency:\n".length).split("\n")) {
    if (!/^ {6}/.test(line)) break
    body.push(line.trim())
  }
  const value = (key: string) => {
    const line = body.find((l) => l.startsWith(`${key}: `))
    expect(line, `${jobName} concurrency has no ${key}`).toBeDefined()
    return line!.slice(key.length + 2).trim()
  }
  return { group: value("group"), cancel: value("cancel-in-progress") }
}

type Context = { github: Record<string, string>; inputs: Record<string, string> }

function format(template: string, ...args: unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (_, n: string) => String(args[Number(n)]))
}

/**
 * Evaluate a workflow value the way GitHub would. Only the constructs these
 * expressions use are accepted — context lookups, single-quoted strings,
 * format(), == and !=, !, && and || with JavaScript's short-circuit values —
 * and anything else fails the test rather than being guessed at. (GitHub
 * compares strings case-insensitively; every literal here is lower-case.)
 */
function evaluate(value: string, ctx: Context): string | boolean {
  const wrapped = value.match(/^\$\{\{\s*([\s\S]+?)\s*\}\}$/)
  if (!wrapped) return value === "true" ? true : value === "false" ? false : value
  const expr = wrapped[1]
  const token = /\s+|'[^']*'|(?:github|inputs)\.[a-z_]+|format|==|!=|&&|\|\||!|\(|\)|,/y
  let js = ""
  for (let i = 0; i < expr.length; ) {
    token.lastIndex = i
    const t = token.exec(expr)?.[0]
    if (!t) throw new Error(`unsupported workflow expression near: ${expr.slice(i)}`)
    js += /^(?:github|inputs)\./.test(t) ? `ctx.${t}` : t === "==" ? "===" : t === "!=" ? "!==" : t
    i += t.length
  }
  return new Function("ctx", "format", `return (${js})`)(ctx, format) as string | boolean
}

type Queue = { group: string; cancel: boolean }
type Kind = "checks" | "build" | "deploy"

function queueOf(jobName: Kind, ctx: Context): Queue {
  const { group, cancel } = concurrencyOf(jobName)
  return { group: String(evaluate(group, ctx)), cancel: evaluate(cancel, ctx) === true }
}

const RESUME_SHA = "0123456789abcdef0123456789abcdef01234567"
const push = (runId: number): Context => ({
  github: { event_name: "push", ref: "refs/heads/main", run_id: String(runId) },
  inputs: {},
})
const dispatch = (mode: string): Context => ({
  github: { event_name: "workflow_dispatch", ref: "refs/heads/main", run_id: "900" },
  inputs: { deployment_mode: mode, bootstrap_resume_sha: mode === "recovery-bootstrap-resume" ? RESUME_SHA : "" },
})

// Median durations of the successful jobs on 2026-09-21, in minutes.
const MINUTES: Record<Kind, number> = { checks: 10.5, build: 17.9, deploy: 7.3 }

// Every push to main that started «Deploy to Production» on 2026-09-21, UTC.
const PUSHES_2026_09_21 = (
  "14:55:59 14:58:13 15:03:41 15:25:34 15:25:46 15:32:43 15:43:11 15:57:19 16:09:10 16:36:02 " +
  "16:44:08 16:52:04 16:56:19 17:00:16 17:24:47 17:25:55 17:45:03 17:54:59 18:09:23 18:10:20 " +
  "18:29:06 18:36:33 18:38:32 18:39:48 18:42:03 18:52:54 19:19:16 19:22:19 19:34:35 19:51:34 " +
  "19:52:29 20:22:52 20:30:13 20:38:12 20:53:50 20:58:10 21:08:26 21:11:53 21:26:17"
)
  .split(" ")
  .map((hms) => {
    const [h, m, s] = hms.split(":").map(Number)
    return h * 60 + m + s / 60
  })
// Two hours of a merge every five minutes.
const STEADY_BURST = Array.from({ length: 25 }, (_, i) => i * 5)

type Job = { run: number; kind: Kind; cancelled: boolean }

/**
 * GitHub's concurrency rule, per its documentation: a group runs one job at a
 * time. A job entering with cancel-in-progress true cancels the running and
 * the waiting job and starts at once. With false it waits, and a job already
 * waiting in that group is cancelled in its favour. Cancelling one job does
 * not stop the rest of its run, but a run whose checks or build was cancelled
 * never deploys; deploy starts once both of its run's jobs succeeded.
 */
function replay(pushes: number[], queues: (run: number, kind: Kind) => Queue) {
  const events: { at: number; seq: number; fire: () => void }[] = []
  let seq = 0
  const at = (time: number, fire: () => void) => {
    events.push({ at: time, seq: seq++, fire })
    events.sort((a, b) => a.at - b.at || a.seq - b.seq)
  }
  const groups = new Map<string, { running?: Job; waiting?: Job }>()
  const dropped = new Set<number>()
  const finished = new Map<number, Set<Kind>>()
  const live: { at: number; run: number }[] = []

  const cancel = (job: Job | undefined) => {
    if (!job) return
    job.cancelled = true
    if (job.kind !== "deploy") dropped.add(job.run)
  }
  const start = (now: number, job: Job, slot: { running?: Job; waiting?: Job }) => {
    slot.running = job
    at(now + MINUTES[job.kind], () => finish(now + MINUTES[job.kind], job, slot))
  }
  const enter = (now: number, job: Job) => {
    const queue = queues(job.run, job.kind)
    const slot = groups.get(queue.group) ?? {}
    groups.set(queue.group, slot)
    if (queue.cancel) {
      cancel(slot.waiting)
      cancel(slot.running)
      slot.waiting = undefined
      start(now, job, slot)
    } else if (!slot.running || slot.running.cancelled) {
      start(now, job, slot)
    } else {
      cancel(slot.waiting)
      slot.waiting = job
    }
  }
  const finish = (now: number, job: Job, slot: { running?: Job; waiting?: Job }) => {
    if (job.cancelled) return
    slot.running = undefined
    const next = slot.waiting
    slot.waiting = undefined
    if (next) start(now, next, slot)
    if (job.kind === "deploy") {
      live.push({ at: now, run: job.run })
      return
    }
    const done = finished.get(job.run) ?? new Set<Kind>()
    finished.set(job.run, done.add(job.kind))
    if (done.has("checks") && done.has("build") && !dropped.has(job.run)) {
      enter(now, { run: job.run, kind: "deploy", cancelled: false })
    }
  }

  pushes.forEach((time, run) =>
    at(time, () => {
      enter(time, { run, kind: "checks", cancelled: false })
      enter(time, { run, kind: "build", cancelled: false })
    }),
  )
  while (events.length) events.shift()!.fire()

  // How long each merge waited until a deploy containing it (its own run or a
  // later one, since main only moves forward) finished.
  const waits = pushes.map((time, run) => {
    const next = live.filter((d) => d.run >= run && d.at >= time).map((d) => d.at - time)
    return next.length ? Math.min(...next) : Infinity
  })
  return { live, waits, worstWait: Math.max(...waits) }
}

const fromWorkflow = (run: number, kind: Kind) => queueOf(kind, push(run + 1))
// The settings deploy.yml had until 2026-09-22 and the one-line alternative
// with a single shared checks queue — both kept here as controls for the model.
const before = (_run: number, kind: Kind): Queue =>
  kind === "deploy" ? { group: "production-deploy", cancel: false } : { group: `prod-${kind}-refs/heads/main`, cancel: true }
const sharedChecksQueue = (_run: number, kind: Kind): Queue =>
  kind === "deploy" ? { group: "production-deploy", cancel: false } : { group: `prod-${kind}-refs/heads/main`, cancel: false }

// A merge waits at most for the build already running, then its own build (its
// checks run alongside and are shorter), then its deploy.
const BOUND = MINUTES.build + Math.max(MINUTES.build, MINUTES.checks) + MINUTES.deploy

describe("deploy.yml queue settings", () => {
  it("keeps the bootstrap-resume queues exactly as they were", () => {
    const resume = dispatch("recovery-bootstrap-resume")
    expect(queueOf("checks", resume)).toEqual({ group: `prod-bootstrap-resume-checks-${RESUME_SHA}`, cancel: false })
    expect(queueOf("build", resume)).toEqual({ group: `prod-bootstrap-resume-build-${RESUME_SHA}`, cancel: false })
  })

  it("still lets a manual re-deploy supersede what is running, as before", () => {
    for (const mode of ["normal", "recovery-bootstrap"]) {
      expect(queueOf("checks", dispatch(mode)), mode).toEqual({ group: "prod-checks-refs/heads/main", cancel: true })
      expect(queueOf("build", dispatch(mode)), mode).toEqual({ group: "prod-build-refs/heads/main", cancel: true })
    }
  })

  it("never lets a push cancel a build or checks already running, and gives each push its own checks", () => {
    expect(queueOf("build", push(1))).toEqual({ group: "prod-build-refs/heads/main", cancel: false })
    expect(queueOf("build", push(2)).group).toBe(queueOf("build", push(1)).group)
    expect(queueOf("checks", push(1)).cancel).toBe(false)
    expect(queueOf("checks", push(2)).group).not.toBe(queueOf("checks", push(1)).group)
    expect(queueOf("deploy", push(1))).toEqual({ group: "production-deploy", cancel: false })
  })
})

describe("a burst of merges reaches production", () => {
  it("puts every merge of 2026-09-21 live within two builds and a deploy", () => {
    const { waits } = replay(PUSHES_2026_09_21, fromWorkflow)
    const late = waits.map((w, i) => ({ w, i })).filter(({ w }) => w > BOUND + 1e-9)
    expect(late, `bound ${BOUND.toFixed(1)} min`).toEqual([])
  })

  it("keeps deploying while someone merges every five minutes for two hours", () => {
    const { live, worstWait } = replay(STEADY_BURST, fromWorkflow)
    expect(worstWait).toBeLessThanOrEqual(BOUND + 1e-9)
    const lastMerge = STEADY_BURST[STEADY_BURST.length - 1]
    expect(live.filter((d) => d.at <= lastMerge).length).toBeGreaterThanOrEqual(Math.floor(lastMerge / (2 * MINUTES.build)))
  })

  it("reproduces 2026-09-21 under the old settings, so the model is the real queue", () => {
    const day = replay(PUSHES_2026_09_21, before)
    expect(day.live).toHaveLength(8) // eight runs deployed that day
    expect(day.worstWait).toBeGreaterThan(85) // measured: 90 minutes (#366)
    const burst = replay(STEADY_BURST, before)
    expect(burst.live.filter((d) => d.at <= STEADY_BURST[STEADY_BURST.length - 1])).toEqual([])
  })

  it("needs a checks slot per push: one shared checks queue loses the bound", () => {
    expect(replay(STEADY_BURST, sharedChecksQueue).worstWait).toBeGreaterThan(BOUND + 5)
  })
})
