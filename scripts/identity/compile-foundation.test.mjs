import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { admitIdentityBuild } from "./compile-foundation.mjs"
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), "identity-build-admission-")), workspace = join(base, "repo"), temp = join(base, "scratch")
  t.after(() => rm(base, { recursive: true, force: true }))
  await mkdir(workspace); await mkdir(temp); await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "leaddrive-v2" }))
  return { workspace, temp, env: { CI: "true", GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", GITHUB_REPOSITORY: "rashadoni/leaddrive-v2", GITHUB_WORKSPACE: workspace, RUNNER_TEMP: temp } }
}
test("scoped compiler admits only the explicit hosted repository and outside scratch", async t => {
  const f = await fixture(t), result = await admitIdentityBuild(f.env, f.workspace)
  assert.equal(result.workspace, f.workspace); assert.equal(result.output, join(f.temp, "identity-foundation"))
})
test("workstation CI flags, wrong host/repository or cwd cannot start the compiler", async t => {
  const f = await fixture(t)
  for (const change of [{ CI: "false" }, { GITHUB_ACTIONS: "false" }, { RUNNER_OS: "macOS" }, { GITHUB_REPOSITORY: "other/repository" }]) await assert.rejects(admitIdentityBuild({ ...f.env, ...change }, f.workspace), /IDENTITY_BUILD_HOST_REFUSED/)
  await assert.rejects(admitIdentityBuild(f.env, f.temp), /IDENTITY_BUILD_PATH_REFUSED/)
})
test("repository scratch and a symlink back into source are refused", async t => {
  const f = await fixture(t), alias = join(f.temp, "source-link")
  await symlink(f.workspace, alias, "dir")
  for (const path of [f.workspace, alias]) await assert.rejects(admitIdentityBuild({ ...f.env, RUNNER_TEMP: path }, f.workspace), /IDENTITY_BUILD_PATH_REFUSED/)
})
