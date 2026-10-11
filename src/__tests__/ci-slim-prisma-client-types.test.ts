/**
 * The required type check reads a REWRITTEN copy of the generated Prisma
 * client: scripts/ci/slim-prisma-client-types.mjs replaces the repeated
 * nested-write input types with `Omit<…>` of the type they repeat, which takes
 * two thirds out of a 138 MiB declaration file.
 *
 * A gate that trusts rewritten types is only as good as the rewrite. If a
 * rewritten type were looser than the generated one, the type check would stop
 * seeing an error it used to see, and nothing would be red. So what is tested
 * here is not the text the script produces but what the compiler makes of it:
 * every rewritten type must be IDENTICAL to the body it replaced, and the
 * comparison itself must be able to say «different».
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"

const ROOT = process.cwd()
const SCRIPT = path.join(ROOT, "scripts", "ci", "slim-prisma-client-types.mjs")
const TSC = path.join(ROOT, "node_modules", "typescript", "lib", "tsc.js")
const COMPILE = 120_000

const BASE = `  export type DealCreateInput = {
    id?: string
    name: string
    amount?: number | null
    organization: OrganizationCreateNestedOneWithoutDealsInput
    tasks?: TaskCreateNestedManyWithoutDealInput
  }`
const WITHOUT_ORGANIZATION = `  export type DealCreateWithoutOrganizationInput = {
    id?: string
    name: string
    amount?: number | null
    tasks?: TaskCreateNestedManyWithoutDealInput
  }`
const WITHOUT_TWO = `  export type DealCreateWithoutOrganizationAndTasksInput = {
    id?: string
    name: string
    amount?: number | null
  }`
// Each of these looks like a copy of the base and is not one.
const REWORDED = `  export type DealCreateWithoutRewordedInput = {
    id?: string
    name: string
    amount?: number
    tasks?: TaskCreateNestedManyWithoutDealInput
  }`
const REORDERED = `  export type DealCreateWithoutReorderedInput = {
    name: string
    id?: string
    amount?: number | null
    tasks?: TaskCreateNestedManyWithoutDealInput
  }`
const EXTRA = `  export type DealCreateWithoutExtraInput = {
    id?: string
    name: string
    amount?: number | null
    note?: string
  }`
const NOTHING_LEFT_OUT = `  export type DealCreateWithoutNothingInput = {
    id?: string
    name: string
    amount?: number | null
    organization: OrganizationCreateNestedOneWithoutDealsInput
    tasks?: TaskCreateNestedManyWithoutDealInput
  }`
const HELPERS = `  export type OrganizationCreateNestedOneWithoutDealsInput = {
    connect?: { id: string }
  }
  export type TaskCreateNestedManyWithoutDealInput = {
    connect?: { id: string }[]
  }`

const generated = (...members: string[]) => `export namespace Prisma {\n${members.join("\n\n")}\n}\n`
const CLIENT = generated(BASE, WITHOUT_ORGANIZATION, WITHOUT_TWO, REWORDED, REORDERED, EXTRA, NOTHING_LEFT_OUT, HELPERS)

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function rewrite(client: string, options: { proof?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "slim-prisma-"))
  dirs.push(dir)
  const file = path.join(dir, "index.d.ts")
  const proof = path.join(dir, "proof")
  writeFileSync(file, client)
  const run = spawnSync(process.execPath, [SCRIPT, file, ...(options.proof ? ["--proof", proof] : [])], { encoding: "utf8" })
  return { file, proof, status: run.status, output: `${run.stdout}${run.stderr}`, text: readFileSync(file, "utf8") }
}

function compile(project: string) {
  const run = spawnSync(process.execPath, [TSC, "-p", project, "--pretty", "false"], { encoding: "utf8" })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

describe("slim-prisma-client-types", () => {
  it("rewrites a type that is its base minus whole properties, and nothing else", () => {
    const result = rewrite(CLIENT)
    expect(result.status).toBe(0)
    expect(result.output).toContain("2 of 6 nested-write input types rewritten")
    expect(result.text).toContain('  export type DealCreateWithoutOrganizationInput = Omit<DealCreateInput, "organization">')
    expect(result.text).toContain('  export type DealCreateWithoutOrganizationAndTasksInput = Omit<DealCreateInput, "organization" | "tasks">')
    for (const untouched of [BASE, REWORDED, REORDERED, EXTRA, NOTHING_LEFT_OUT, HELPERS]) {
      expect(result.text).toContain(untouched)
    }
  })

  it("the compiler finds every rewritten type identical to the body it replaced", () => {
    const result = rewrite(CLIENT, { proof: true })
    const compiled = compile(result.proof)
    expect(compiled.output).toBe("")
    expect(compiled.status).toBe(0)
  }, COMPILE)

  it("the same comparison names a rewrite that left out one property too many", () => {
    const result = rewrite(CLIENT, { proof: true })
    const client = path.join(result.proof, "client.d.ts")
    const exact = 'DealCreateWithoutOrganizationInput = Omit<DealCreateInput, "organization">'
    const wrong = 'DealCreateWithoutOrganizationInput = Omit<DealCreateInput, "organization" | "amount">'
    const text = readFileSync(client, "utf8")
    expect(text).toContain(exact)
    writeFileSync(client, text.replace(exact, wrong))
    const compiled = compile(result.proof)
    expect(compiled.status).not.toBe(0)
    expect(compiled.output).toContain("DealCreateWithoutOrganizationInput")
    expect(compiled.output).not.toContain("DealCreateWithoutOrganizationAndTasksInput")
  }, COMPILE)

  it("and one that only made a required property optional", () => {
    // Mutual assignability would not be enough for the opposite direction of
    // this mistake; identity is what the proof compares.
    const result = rewrite(CLIENT, { proof: true })
    const client = path.join(result.proof, "client.d.ts")
    const exact = '  export type DealCreateWithoutOrganizationAndTasksInput = Omit<DealCreateInput, "organization" | "tasks">'
    const wrong = "  export type DealCreateWithoutOrganizationAndTasksInput = Partial<Omit<DealCreateInput, \"organization\" | \"tasks\">>"
    const text = readFileSync(client, "utf8")
    expect(text).toContain(exact)
    writeFileSync(client, text.replace(exact, wrong))
    const compiled = compile(result.proof)
    expect(compiled.status).not.toBe(0)
    expect(compiled.output).toContain("DealCreateWithoutOrganizationAndTasksInput")
  }, COMPILE)

  it("a comparison that accepts anything fails its own control", () => {
    const result = rewrite(CLIENT, { proof: true })
    const client = path.join(result.proof, "client.d.ts")
    const text = readFileSync(client, "utf8")
    const helper = /  type __RewriteSame<A, B> = .*\n/u
    expect(text).toMatch(helper)
    writeFileSync(client, text.replace(helper, "  type __RewriteSame<A, B> = true\n"))
    const compiled = compile(result.proof)
    expect(compiled.status).not.toBe(0)
    expect(compiled.output).toContain("check.ts")
    expect(compiled.output).toContain("'false' is not assignable to type 'true'")
  }, COMPILE)

  it("does nothing the second time", () => {
    const first = rewrite(CLIENT)
    const again = spawnSync(process.execPath, [SCRIPT, first.file], { encoding: "utf8" })
    expect(again.status).toBe(0)
    expect(again.stdout).toContain("already rewritten")
    expect(readFileSync(first.file, "utf8")).toBe(first.text)
  })

  it("does not use a base that is more than plain properties", () => {
    // With an index signature in the base, Omit<…> is a different type.
    const indexed = BASE.replace("    id?: string\n", "    id?: string\n    [key: string]: unknown\n")
    const result = rewrite(generated(indexed, WITHOUT_ORGANIZATION, HELPERS))
    expect(result.status).toBe(0)
    expect(result.text).toBe(generated(indexed, WITHOUT_ORGANIZATION, HELPERS))
    expect(result.output).toContain("::warning::")
  })

  it("leaves the file as generated when it could not be exact, and says so", () => {
    const ownOmit = generated("  type Omit<T, K> = T", BASE, WITHOUT_ORGANIZATION, HELPERS)
    const shadowed = rewrite(ownOmit)
    expect(shadowed.status).toBe(0)
    expect(shadowed.text).toBe(ownOmit)
    expect(shadowed.output).toContain("::warning::")
    expect(shadowed.output).toContain("declares its own Omit")

    const unfamiliar = "export declare const nothingLikePrisma: number\n"
    const changed = rewrite(unfamiliar)
    expect(changed.status).toBe(0)
    expect(changed.text).toBe(unfamiliar)
    expect(changed.output).toContain("::warning::")
    expect(changed.output).toContain("changed shape")
  })

  it("is what the required typecheck job runs, between generating the client and compiling", () => {
    // A tested script wired to nothing is decoration.
    const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "pr-checks.yml"), "utf8")
    const job = workflow.slice(workflow.indexOf("\n  typecheck:"), workflow.indexOf("\n  production-build:"))
    const generate = job.indexOf("npx prisma generate")
    const slim = job.indexOf("node scripts/ci/slim-prisma-client-types.mjs")
    const tsc = job.indexOf("npx tsc --noEmit")
    expect(generate).toBeGreaterThan(-1)
    expect(slim).toBeGreaterThan(generate)
    expect(tsc).toBeGreaterThan(slim)
  })
})
