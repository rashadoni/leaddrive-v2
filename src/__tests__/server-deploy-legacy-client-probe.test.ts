import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const deployScript = readFileSync(join(process.cwd(), "scripts/server-deploy.sh"), "utf8")

/**
 * The Fund cutover keeps the previous artifact's Prisma client and, after the
 * irreversible migration, proves that client still works against the migrated
 * schema. Until that proof passes the deploy keeps PM2 stopped — so a proof
 * that cannot even start is not a safety net, it is an outage.
 *
 * That is exactly what happened on 2026-09-07. The client is staged in a
 * directory called `legacy-node_modules`; `@prisma/client/default.js` does a
 * bare `require(".prisma/client/default")`; Node only walks directories named
 * `node_modules`. The probe died with MODULE_NOT_FOUND before opening a
 * connection, the deploy reported it as a schema incompatibility, and
 * production stayed down on a gate that had never once been able to run.
 *
 * The invariant these tests hold: whatever the staging directory is called,
 * Node must be told where to resolve the staged tree from.
 */
describe("production deploy legacy Prisma rollback proof", () => {
  const probeStart = deployScript.indexOf("LEGACY_PRISMA_CLIENT_MODULE=")
  const probeInvocation = deployScript.slice(
    probeStart,
    deployScript.indexOf("EVENT_PLATFORM_PREVIOUS_CLIENT_COMPATIBLE=true", probeStart),
  )

  it("gives Node a resolution root for the staged rollback client", () => {
    expect(probeStart).toBeGreaterThan(-1)
    expect(probeInvocation).toContain("NODE_PATH=")
  })

  it("points that resolution root at the directory holding the staged tree", () => {
    // NODE_PATH must be the parent of the staged @prisma/client, because that
    // is the only directory from which a bare ".prisma/client/default" request
    // can resolve. A rename of the staging directory must move both together.
    // The name appears twice: once defined, once passed through to the probe.
    const clientModule = [
      ...probeInvocation.matchAll(/LEGACY_PRISMA_CLIENT_MODULE="([^"]+)"/g),
    ]
      .map((m) => m[1])
      .find((value) => value !== "$LEGACY_PRISMA_CLIENT_MODULE")
    const nodePath = probeInvocation.match(/NODE_PATH="([^"]+)"/)?.[1]

    expect(clientModule).toBeTruthy()
    expect(nodePath).toBeTruthy()
    expect(clientModule).toBe(`${nodePath}/@prisma/client`)
  })

  it("stages the client and the .prisma runtime in that same directory", () => {
    const nodePath = probeInvocation.match(/NODE_PATH="([^"]+)"/)?.[1]
    expect(nodePath).toBeTruthy()

    // The staging code writes both halves; resolution needs both under one root.
    const staged = nodePath!.replace(
      "$EVENT_PLATFORM_PILOT_RECOVERY_DIR",
      "$stage",
    )
    expect(deployScript).toContain(`${staged}/@prisma/client`)
    expect(deployScript).toContain(`${staged}/.prisma/client`)
  })

  it("does not claim a schema incompatibility it has not established", () => {
    // The probe exits non-zero for any reason, crashes included. The message
    // must not name a cause the deploy has no evidence for.
    expect(probeInvocation).not.toContain("incompatible with the migrated Fund schema")
    expect(probeInvocation).toContain("did not pass the migrated Fund rollback proof")
  })
})
