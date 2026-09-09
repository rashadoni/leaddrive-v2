/**
 * The relay has to actually reach production, and must not exist before it can.
 *
 * pm2 starts every app in the ecosystem file, so an entry that is present
 * without its secrets does not sit idle — it crash-loops beside the web app.
 * That is why the entry is conditional, and why this is worth a test: the
 * failure it prevents is a restart storm on the box that serves the CRM.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()

function loadApps(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    const path = join(ROOT, "ecosystem.config.cjs")
    // Read and evaluate fresh: the config reads process.env at load time.
    const source = readFileSync(path, "utf8")
    const module_ = { exports: {} as { apps: Array<Record<string, unknown>> } }
    new Function("module", "process", "require", source)(module_, process, () => ({}))
    return module_.exports.apps
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe("relay deployment", () => {
  it("does not exist on a server that was never given its secrets", () => {
    const apps = loadApps({ SOFTPHONE_RELAY_SECRET: undefined, SOFTPHONE_PBX_SECRET: undefined })
    expect(apps.map((a) => a.name)).toEqual(["leaddrive-v2"])
  })

  it("needs BOTH secrets, not one", () => {
    const half = loadApps({ SOFTPHONE_RELAY_SECRET: "a".repeat(48), SOFTPHONE_PBX_SECRET: undefined })
    expect(half.map((a) => a.name)).toEqual(["leaddrive-v2"])
  })

  it("ships beside the web app once the server is configured", () => {
    const apps = loadApps({ SOFTPHONE_RELAY_SECRET: "a".repeat(48), SOFTPHONE_PBX_SECRET: "b".repeat(48) })
    const relay = apps.find((a) => a.name === "softphone-relay")!
    expect(relay).toBeTruthy()
    expect(String(relay.script)).toContain("scripts/softphone-relay/relay.mjs")
    expect(relay.cwd).toBe(relay.script?.toString().split("/scripts/")[0])
    // Its own logs, so an audio problem is not read out of the web app's file.
    expect(String(relay.out_file)).toContain("softphone-relay")
  })

  it("points pm2 at a path a deploy actually replaces", () => {
    // The failure this exists for, in full: the entry named
    // `${APP_DIR}/scripts/softphone-relay/relay.mjs`, which reads like the
    // repository and is not. A deploy replaces `.next/standalone` and nothing
    // else; `${APP_DIR}` on production is a checkout from months ago. pm2
    // starts every app in this file, a missing script is a non-zero exit, and
    // the whole deploy failed and rolled back on 2026-08-24 — after the swap,
    // so the failure surfaced at the very last step.
    //
    // Asserting "under the standalone bundle" rather than an exact string:
    // the point is the deploy boundary, not the spelling.
    const apps = loadApps({ SOFTPHONE_RELAY_SECRET: "a".repeat(48), SOFTPHONE_PBX_SECRET: "b".repeat(48) })
    const relay = apps.find((a) => a.name === "softphone-relay")!
    expect(String(relay.script)).toContain("/.next/standalone/")
    expect(String(relay.cwd)).toContain("/.next/standalone")
  })

  it("is staged into the artifact by the build that ships it", () => {
    // Ties the two ends together. The config above can point anywhere it likes;
    // this asserts the build actually puts the file there, and puts `ws` — the
    // relay's only non-builtin import — somewhere Node can resolve it from.
    // Without this the config and the build drift apart in silence, which is
    // precisely how the relay reached production as a name with no file.
    const workflow = readFileSync(join(ROOT, ".github/workflows/deploy.yml"), "utf8")
    expect(workflow).toMatch(
      /cp -r scripts\/softphone-relay\/\. \.next\/standalone\/scripts\/softphone-relay\//,
    )
    expect(workflow).toMatch(/cp -r node_modules\/ws \.next\/standalone\/node_modules\/ws/)
    // Staged with an assertion, not `|| true`: a relay that is quietly absent
    // leaves an answered customer waiting for a salesperson who never arrives.
    expect(workflow).toMatch(/softphone relay missing from the standalone artifact/)
  })

  it("keeps both of its ports off the internet", () => {
    // Measured on production 2026-08-24, minutes after the relay first
    // started: `curl http://<public-ip>:8095/` answered from the open
    // internet. Nothing was exploitable through it — a socket without a
    // valid, server-signed, thirty-second ticket is refused — but a browser
    // on an https page cannot open a ws:// socket at all, so the public bind
    // never served one legitimate connection. It only offered strangers
    // something to knock on.
    //
    // Both binds are asserted together because the PBX half was already
    // loopback and the browser half was simply left to Node's default, which
    // is every interface. That asymmetry is the whole bug.
    const apps = loadApps({ SOFTPHONE_RELAY_SECRET: "a".repeat(48), SOFTPHONE_PBX_SECRET: "b".repeat(48) })
    const relay = apps.find((a) => a.name === "softphone-relay")!
    const env = relay.env as Record<string, string>
    expect(env.SOFTPHONE_RELAY_BIND).toBe("127.0.0.1")
    expect(env.SOFTPHONE_PBX_BIND).toBe("127.0.0.1")

    const source = readFileSync(join(ROOT, "scripts/softphone-relay/relay.mjs"), "utf8")
    // The relay must default to loopback on its own, not rely on pm2 passing
    // the variable: it is also started by hand during an incident.
    expect(source).toMatch(/SOFTPHONE_RELAY_BIND \|\| "127\.0\.0\.1"/)
    expect(source).toMatch(/server\.listen\(PORT, BROWSER_BIND/)
  })

  it("is taken down before a deploy starts it again", () => {
    // pm2 refuses to start an app that is already running, and that refusal is
    // a non-zero exit the deploy treats as fatal. Without this the relay would
    // also keep serving the previous deploy's code, silently.
    const deploy = readFileSync(join(ROOT, "scripts/server-deploy.sh"), "utf8")
    // Anchored to the start of a line: the same text appears in a comment
    // above the delete, and matching that would pass while the real command
    // ran in the wrong order.
    const deleteAt = deploy.search(/^pm2 delete softphone-relay/m)
    const startAt = deploy.search(/^pm2 start "\$PM2_CONFIG"/m)
    expect(deleteAt).toBeGreaterThan(-1)
    expect(startAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeLessThan(startAt)
  })

  it("keeps the web app's own entry untouched", () => {
    const before = loadApps({ SOFTPHONE_RELAY_SECRET: undefined, SOFTPHONE_PBX_SECRET: undefined })[0]
    const after = loadApps({ SOFTPHONE_RELAY_SECRET: "a".repeat(48), SOFTPHONE_PBX_SECRET: "b".repeat(48) })[0]
    expect(after).toEqual(before)
  })
})
