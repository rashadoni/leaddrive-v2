import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Finding F-37 (docs/isms/ISMS-02-gap-analysis.md).
 *
 * The operator workflows reach production by handing a remote shell a string:
 *
 *   ssh … "REPAIR_SLUG='$REPAIR_SLUG' … bash -s" <<'REMOTE'
 *
 * The value sits inside single quotes on the REMOTE command line, so a single
 * quote in the input closes the quoting and everything after it runs as root on
 * production. Passing the input through `env:` — which these workflows already
 * do — prevents expression injection into the workflow file; it does nothing
 * about the shell on the other end of the ssh.
 *
 * WHAT THIS GATE ASKS, AND WHY IT CHANGED
 *
 * The first version asked "does a workflow that mentions `bash -s` and takes
 * free text contain a step named 'Validate inputs'?". That was a rule about a
 * step's NAME, and it produced a false positive the week it was written:
 * swissmed-mtm-browser-evidence.yml does
 *
 *   ssh … 'bash -s' -- "$MTM_EVIDENCE_FIXTURE_CONFIRMATION" … <<'REMOTE'
 *
 * which is not merely acceptable but STRICTLY SAFER than validating. The value
 * arrives as a positional argument — argv, not shell text — so there is no
 * injection channel left to filter. Demanding a validation step there would
 * have been satisfied by adding the words, and a gate that can be satisfied by
 * wording stops meaning anything. Worse, a check that fires on safe code gets
 * ignored, and then it is not there when it fires on unsafe code.
 *
 * So the gate now tests the property instead of the ceremony: does an operator
 * input get EXPANDED INTO the command string sent to the remote shell? If yes,
 * the input's shape must be checked first. If it is passed as an argument, no
 * validation is required, because nothing can be escaped out of.
 */

const DIR = ".github/workflows"

/**
 * The remote command strings: a double-quoted argument that itself contains
 * `bash -s`. `ssh host 'bash -s' -- "$VALUE"` does not match — there the
 * variable is a separate argv element, which is the point.
 */
function remoteCommandStrings(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*\bbash -s\b[^"\n]*)"/g)].map(m => m[1])
}

/** Shell variables expanded inside a string, e.g. SLUG='$SET_SLUG'. */
function expandedVariables(commandString: string): string[] {
  return [...commandString.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)].map(m => m[1])
}

function freeTextDispatchInputs(source: string): string[] {
  const dispatch = /workflow_dispatch:\s*\n([\s\S]*?)\n\s{0,4}(jobs|permissions|concurrency|env):/.exec(source)
  if (!dispatch) return []
  const names: string[] = []
  const block = dispatch[1]
  for (const m of block.matchAll(/\n {6}(\w+):\n((?: {8}.*\n)+)/g)) {
    const [, name, body] = m
    // A choice input cannot carry a payload: GitHub restricts it to the options.
    if (/type:\s*choice/.test(body)) continue
    if (/type:\s*boolean/.test(body)) continue
    names.push(name)
  }
  return names
}

/** Env var names carrying a free-text input, from `SOME_VAR: ${{ inputs.x }}`. */
function envVarsCarryingInput(source: string, inputs: string[]): Set<string> {
  const carried = new Set<string>()
  for (const m of source.matchAll(/^\s*([A-Z_][A-Z0-9_]*):\s*\$\{\{\s*(?:inputs|github\.event\.inputs)\.(\w+)\s*\}\}/gm)) {
    if (inputs.includes(m[2])) carried.add(m[1])
  }
  return carried
}

type Workflow = { file: string; source: string; interpolated: string[] }

function scan(): { interpolating: Workflow[]; argvOnly: string[] } {
  const interpolating: Workflow[] = []
  const argvOnly: string[] = []

  for (const file of readdirSync(DIR).filter(f => f.endsWith(".yml"))) {
    const source = readFileSync(join(DIR, file), "utf8")
    if (!source.includes("bash -s")) continue

    const inputs = freeTextDispatchInputs(source)
    if (inputs.length === 0) continue

    const carried = envVarsCarryingInput(source, inputs)
    // Assignments inside the remote string are usually renamed copies
    // (SET_SLUG='$SET_SLUG'), so treat any variable reaching the string as
    // operator-controlled unless it demonstrably is not.
    const interpolated = remoteCommandStrings(source)
      .flatMap(expandedVariables)
      .filter((v, i, all) => all.indexOf(v) === i)

    if (interpolated.length > 0) {
      interpolating.push({ file, source, interpolated })
    } else if (carried.size > 0) {
      argvOnly.push(file)
    }
  }
  return { interpolating, argvOnly }
}

describe("operator input never reaches a production shell as text", () => {
  const { interpolating, argvOnly } = scan()

  it("finds the workflows at all", () => {
    // Guards against the gate passing because the directory moved.
    expect(readdirSync(DIR).filter(f => f.endsWith(".yml")).length).toBeGreaterThan(5)
  })

  it("still identifies workflows that interpolate into the remote command", () => {
    // If this reaches zero the gate has stopped testing anything: either every
    // workflow switched to argv (good — delete this file) or the detection
    // broke (bad, and silent).
    expect(interpolating.length).toBeGreaterThan(0)
  })

  it.each(interpolating.map(w => [w.file, w] as const))(
    "%s validates the values it expands into the remote command",
    (file, workflow) => {
      expect(
        workflow.source,
        `${file} expands ${workflow.interpolated.map(v => "$" + v).join(", ")} into the ` +
        `string it sends to a remote shell, with no validation step. Either copy ` +
        `the "Validate inputs" step from set-tenant-user-password.yml, or — better — ` +
        `pass the values as positional arguments the way ` +
        `swissmed-mtm-browser-evidence.yml does: ssh … 'bash -s' -- "$VALUE". ` +
        `An argument cannot be escaped out of, so there is nothing left to filter.`,
      ).toContain("Validate inputs")
    },
  )

  it("accepts passing operator input as an argument instead of validating it", () => {
    // The safer pattern must not be a gate failure, or the next author copies
    // the more dangerous one to make CI green.
    const source = readFileSync(join(DIR, "swissmed-mtm-browser-evidence.yml"), "utf8")
    expect(source).toMatch(/'bash -s'\s+--/)
    expect(remoteCommandStrings(source)).toHaveLength(0)
    expect(argvOnly).toContain("swissmed-mtm-browser-evidence.yml")
  })
})
