#!/usr/bin/env node
/** Scoped hosted compilation only; no installs, full-project indexing or build. */
import { execFileSync } from "node:child_process"
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
const inside = (parent, child) => { const rel = relative(parent, child); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)) }

export async function admitIdentityBuild(env, cwd) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux" || env.GITHUB_REPOSITORY !== "rashadoni/leaddrive-v2"
    || !env.GITHUB_WORKSPACE || !env.RUNNER_TEMP) throw new Error("IDENTITY_BUILD_HOST_REFUSED")
  const workspace = await realpath(env.GITHUB_WORKSPACE), current = await realpath(cwd), temp = await realpath(env.RUNNER_TEMP)
  if (workspace !== current || inside(workspace, temp) || inside(join(temp, "identity-foundation"), workspace)) throw new Error("IDENTITY_BUILD_PATH_REFUSED")
  const pkg = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"))
  if (pkg.name !== "leaddrive-v2") throw new Error("IDENTITY_BUILD_REPOSITORY_REFUSED")
  return { workspace, temp, output: join(temp, "identity-foundation") }
}
async function main() {
  const { workspace, temp, output } = await admitIdentityBuild(process.env, process.cwd())
  await mkdir(output, { mode: 0o700 }) // Refuse stale output/symlink; never clean another job's directory.
  const names = ["contract", "registry", "phone-proof", "phone-proof-registry", "credential-setup", "phone-proof-dispatch", "mobile-session-contract", "mobile-session", "membership-registry", "mobile-session-resolver", "tenant-policy", "mobile-password-auth", "legacy-credential-boundary", "legacy-credential-write", "legacy-crm-boundary", "crm-seat-policy", "canonical-password", "crm-session", "administrator", "application-enrollment", "application-actor", "runtime-keys", "mobile-login-runtime", "mobile-runtime", "activation-runtime", "activation", "recovery-authority", "canonical-recovery", "mobile-recovery-runtime", "onboarding-contract", "onboarding-authority", "onboarding", "time-onboarding"]
  const config = join(temp, "identity-foundation-tsconfig.json")
  await writeFile(config, JSON.stringify({ extends: join(workspace, "tsconfig.json"), compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: ["node"], typeRoots: [join(workspace, "node_modules/@types")], strict: true, skipLibCheck: true,
    esModuleInterop: true, noEmit: false, incremental: false, allowJs: false, rootDir: join(workspace, "src/lib"), outDir: output,
  }, files: names.map(name => join(workspace, `src/lib/identity/${name}.ts`)), include: [], exclude: [] }), { flag: "wx", mode: 0o600 })
  execFileSync(process.execPath, [join(workspace, "node_modules/typescript/bin/tsc"), "--project", config], { cwd: workspace, stdio: "inherit", timeout: 120_000 })
  // Exact locked runtime dependencies and the app's existing @/lib alias.
  // These links exist only in scratch output; no source/global dependency changes.
  await mkdir(join(output, "node_modules/@prisma"), { recursive: true })
  await mkdir(join(output, "node_modules/@"), { recursive: true })
  for (const name of ["bcryptjs", "jsonwebtoken", "@prisma/client", "zod"]) await symlink(join(workspace, "node_modules", name), join(output, "node_modules", name), "dir")
  await symlink(output, join(output, "node_modules/@/lib"), "dir")
  const compiled = await import(pathToFileURL(join(output, "identity/tenant-policy.js")).href)
  if (typeof compiled.readIdentityMobileTenantPolicy !== "function") throw new Error("IDENTITY_BUILD_IMPORT_REFUSED")
  process.stdout.write("IDENTITY_SCOPED_TYPES_AND_RUNTIME_IMPORTS_PASS\n")
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write("IDENTITY_SCOPED_COMPILE_FAILED\n"); process.exitCode = 1 })
}
