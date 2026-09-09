import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Read as text rather than through a YAML parser: js-yaml is only present
// transitively here, so importing it would make this test die on an unrelated
// dependency bump. The shapes below are all flat enough to read directly.
function workflowText(file: string): string {
  return readFileSync(join(process.cwd(), ".github/workflows", file), "utf8")
}

/** The lines of one job, from its `  <name>:` header to the next job header. */
function jobBlock(text: string, jobName: string): string {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => line === `  ${jobName}:`)
  expect(start, `workflow has no job "${jobName}"`).toBeGreaterThan(-1)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}\S/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join("\n")
}

function jobNames(text: string): string[] {
  const jobsAt = text.indexOf("\njobs:\n")
  return [...text.slice(jobsAt).matchAll(/^ {2}([A-Za-z0-9_-]+):$/gm)].map((m) => m[1])
}

function stepNames(block: string): string[] {
  return [...block.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1].trim())
}

/** The `if:` of the job itself — indented four spaces, not inside a step. */
function jobIf(block: string): string {
  return block.match(/^ {4}if: (.+)$/m)?.[1].trim() ?? ""
}

const prChecks = workflowText("pr-checks.yml")
const deploy = workflowText("deploy.yml")
const staticChecks = jobBlock(prChecks, "static-checks")
const typecheck = jobBlock(prChecks, "typecheck")

/**
 * A merge into main triggers pr-checks.yml and deploy.yml on the same commit.
 * Both used to run the same gates, so every merge occupied one of the three
 * shared self-hosted runners for ~14 minutes proving something the deploy was
 * already proving, and other sessions' pull requests queued behind it.
 *
 * static-checks is therefore limited to pull requests. That is only safe while
 * the deploy runs every gate static-checks runs — which is what these tests
 * hold. Add a gate to static-checks alone and this fails, because on a main
 * push that gate would run nowhere.
 */
describe("pr-checks static-checks is redundant on a main push", () => {
  it("runs for ready pull requests and is triggered when a draft becomes ready", () => {
    expect(jobIf(staticChecks)).toBe("${{ github.event_name == 'pull_request' && github.event.pull_request.draft == false }}")
    expect(prChecks).toMatch(/types:\s*\[[^\]]*ready_for_review[^\]]*\]/)
  })

  it("leaves typecheck running on a main push", () => {
    // The one gate the deploy does not perform. Dropping it from push would
    // let a type regression reach production unchecked.
    expect(jobIf(typecheck)).toContain("github.event_name == 'push'")
    expect(jobNames(deploy)).not.toContain("typecheck")
  })

  it("has every one of its gates covered by the deploy", () => {
    // Setup steps are not gates; they prove nothing on their own.
    const setup = new Set([
      "Checkout code",
      "Reset the workspace except the persistent caches",
      "Setup Node.js",
      "Install dependencies",
      "Generate Prisma client",
      "Generate frozen pre-pilot Prisma client",
      "Resolve the per-job Postgres port",
    ])

    const deployStepNames = new Set(
      jobNames(deploy).flatMap((name) => stepNames(jobBlock(deploy, name))),
    )

    const uncovered = stepNames(staticChecks).filter(
      (name) => !setup.has(name) && !deployStepNames.has(name),
    )

    // The PII lint is a named step here and one line of a shell block there,
    // so it is covered by command rather than by step name.
    expect(uncovered).toEqual(["PII column-wrap lint guard"])
    expect(deploy).toContain("npm run lint:pii-columns")
  })
})
