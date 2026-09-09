import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

const deployScript = readFileSync(join(process.cwd(), "scripts/server-deploy.sh"), "utf8")
const probeSource = readFileSync(
  join(process.cwd(), "scripts/event-platform-legacy-client-probe.mjs"),
  "utf8",
)

const scratch = mkdtempSync(join(tmpdir(), "legacy-prisma-resolution-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/**
 * Stage a `@prisma/client`-shaped package the way the deploy script stages the
 * previous artifact's client, and try to load it exactly as the probe does.
 *
 * The shape is what matters, not Prisma itself: the real `@prisma/client` is a
 * thin wrapper whose own code requires the BARE specifier
 * `.prisma/client/default`, and the generated client is its SIBLING rather than
 * a nested dependency. Node resolves a bare specifier only through ancestor
 * directories literally named `node_modules`, so the sibling is reachable under
 * that name and invisible under any other — even though `ls` shows both
 * directories sitting next to each other.
 */
function loadStagedClient(stagingDirName: string): { ok: boolean; error: string } {
  const root = mkdtempSync(join(scratch, "stage-"))
  const staged = join(root, stagingDirName)
  mkdirSync(join(staged, "@prisma", "client"), { recursive: true })
  mkdirSync(join(staged, ".prisma", "client"), { recursive: true })

  writeFileSync(
    join(staged, ".prisma", "client", "default.js"),
    "module.exports = { PrismaClient: function PrismaClient() {} }\n",
  )
  writeFileSync(
    join(staged, "@prisma", "client", "package.json"),
    JSON.stringify({ name: "@prisma/client", version: "0.0.0-test", main: "default.js" }),
  )
  writeFileSync(
    join(staged, "@prisma", "client", "default.js"),
    'module.exports = require(".prisma/client/default")\n',
  )

  try {
    const out = execFileSync(
      process.execPath,
      ["-e", `require(${JSON.stringify(join(staged, "@prisma", "client"))}); console.log("loaded")`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
    return { ok: out.includes("loaded"), error: "" }
  } catch (error) {
    const err = error as { stderr?: string; message?: string }
    return { ok: false, error: err.stderr || err.message || "" }
  }
}

describe("durable Fund recovery state stages the previous Prisma client resolvably", () => {
  it('resolves the generated client when the staging directory is named "node_modules"', () => {
    const result = loadStagedClient("node_modules")
    expect(result.error).toBe("")
    expect(result.ok).toBe(true)
  })

  it("does NOT resolve under the old legacy-node_modules name — the bug this guards", () => {
    // Regression anchor. Without this the first test passes under any name and
    // proves nothing: it is the rename that fixes production, so the negative
    // case has to be pinned too.
    const result = loadStagedClient("legacy-node_modules")
    expect(result.ok).toBe(false)
    expect(result.error).toContain(".prisma/client")
  })

  it("stages into a directory literally named node_modules", () => {
    expect(deployScript).toContain('install -d -m 0700 "$stage/node_modules/@prisma"')
    expect(deployScript).toContain('cp -a -- "$source_root/.prisma/client" "$stage/node_modules/.prisma/client"')
    // Nothing may reintroduce the unresolvable layout. Matched as a path
    // segment, not as free text: the comment above the staging call names the
    // old directory on purpose, to explain why it may not come back.
    expect(deployScript).not.toMatch(/["/$]legacy-node_modules\//)
  })

  it("reads the client back from the same directory it staged into", () => {
    // Staging and probing drifting apart is silent: the probe would fail with a
    // schema-shaped message while both directories exist on disk.
    expect(deployScript).toContain(
      'LEGACY_PRISMA_CLIENT_MODULE="$EVENT_PLATFORM_PILOT_RECOVERY_DIR/node_modules/@prisma/client"',
    )
    expect(deployScript).toContain('[ -d "$EVENT_PLATFORM_PILOT_RECOVERY_DIR/node_modules/@prisma/client" ]')
  })
})

describe("the probe separates a load failure from a schema mismatch", () => {
  it("does not let an unloadable client be reported as schema-incompatible", () => {
    // The deploy turns ANY non-zero exit into "the exact previous Prisma client
    // is incompatible with the migrated Fund schema". That verdict sends the
    // reader to the schema; the real cause was a filename. The probe must say
    // which failure it hit before the caller flattens it.
    expect(probeSource).toContain("could not be LOADED (not a schema mismatch)")
    expect(probeSource).toContain('must be named "node_modules"')
  })
})
