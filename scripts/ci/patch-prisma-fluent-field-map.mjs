#!/usr/bin/env node
/**
 * Replace Prisma 6.19.2's quadratic applyFluent field-map construction with
 * a linear construction. A model method getter builds this map even before
 * executing a query; Organization currently has more than 500 fields.
 * Production CPU profiling found the spread-reduce on this request hot path.
 *
 * Run explicitly after npm ci / prisma generate and before the CI production
 * build. Only the configured library engine's CommonJS and ESM runtimes are
 * patched. This changes no query, authorization, transaction, or cache policy.
 * Object.fromEntries preserves field references, last duplicate wins, and own
 * data properties for names such as __proto__, unlike assignment into {}.
 *
 * Both files must have exactly one original or already-patched expression.
 * All paths, versions and contents are checked before either file is written.
 * Unknown Prisma versions fail closed and require review or patch retirement.
 *
 * node scripts/ci/patch-prisma-fluent-field-map.mjs [--allow-local | --check] [project-root]
 * --check only verifies both patched runtimes, including in assembled artifacts.
 *
 * --allow-local permits a disposable, project-owned install only. It does NOT
 * permit symlinked/shared dependencies outside that project's node_modules.
 * Resolve from the target project, not this script's checkout, for CI use.
 */
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const NAME = "patch-prisma-fluent-field-map"
const VERSION = "6.19.2"
const TARGETS = ["runtime/library.js", "runtime/library.mjs"]
const MARKER = "/* leaddrive: scripts/ci/patch-prisma-fluent-field-map.mjs */"
const NEEDLE = "e._runtimeDataModel.models[r].fields.reduce((l,u)=>({...l,[u.name]:u}),{})"
const PATCHED = `Object.fromEntries(e._runtimeDataModel.models[r].fields.map(u=>[u.name,u]))${MARKER}`

function refuse(message) {
  throw new Error(message)
}

function occurrences(source, text) {
  return source.split(text).length - 1
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function main() {
  const args = process.argv.slice(2)
  const checkOnly = args.includes("--check")
  const positional = args.filter((arg) => arg !== "--allow-local" && arg !== "--check")
  if (positional.length > 1 || positional.some((arg) => arg.startsWith("-"))) {
    refuse(`usage: node scripts/ci/${NAME}.mjs [--allow-local | --check] [project-root]`)
  }
  if (!checkOnly && process.env.GITHUB_ACTIONS !== "true" && !args.includes("--allow-local")) {
    refuse("refusing outside GitHub Actions without --allow-local; use only a disposable project-owned install")
  }

  const root = realpathSync(path.resolve(positional[0] ?? process.cwd()))
  const expectedModules = path.join(root, "node_modules")
  const actualModules = realpathSync(expectedModules)
  if (actualModules !== expectedModules) {
    refuse(`refusing shared/symlinked node_modules outside the project-owned path: ${actualModules}`)
  }

  const packageJson = realpathSync(createRequire(path.join(root, "package.json")).resolve("@prisma/client/package.json"))
  const prismaDir = path.dirname(packageJson)
  if (!isInside(expectedModules, packageJson)) {
    refuse(`refusing @prisma/client outside the project's node_modules: ${packageJson}`)
  }
  const { version } = JSON.parse(readFileSync(packageJson, "utf8"))
  if (version !== VERSION) {
    refuse(`installed @prisma/client is ${version}; this patch supports only ${VERSION}. Review the runtime and update or retire the patch.`)
  }

  // Prepare every write first: a missing, escaped, or changed second runtime
  // must not leave the first runtime patched after a validation failure.
  const changes = TARGETS.map((relative) => {
    const target = realpathSync(path.join(prismaDir, relative))
    if (!isInside(prismaDir, target) || !isInside(expectedModules, target)) {
      refuse(`refusing runtime outside the project-owned @prisma/client package: ${target}`)
    }
    if (!checkOnly && statSync(target).nlink !== 1) {
      refuse(`refusing runtime with a shared/hardlinked inode: ${target}`)
    }
    const source = readFileSync(target, "utf8")
    const unpatched = occurrences(source, NEEDLE)
    const patched = occurrences(source, PATCHED)
    const markers = occurrences(source, MARKER)
    if (!((unpatched === 1 && patched === 0 && markers === 0) || (unpatched === 0 && patched === 1 && markers === 1))) {
      refuse(`expected one applyFluent field map in ${relative}; found ${unpatched} unpatched, ${patched} patched and ${markers} markers`)
    }
    if (checkOnly && unpatched !== 0) refuse(`unpatched runtime in --check mode: ${relative}`)
    return { target, source: unpatched ? source.replace(NEEDLE, PATCHED) : source, changed: unpatched === 1 }
  })

  for (const { target, source, changed } of changes) {
    if (changed && !checkOnly) writeFileSync(target, source)
    console.log(`${NAME}: ${checkOnly ? "verified" : changed ? "patched" : "already patched"} ${target} (@prisma/client ${version})`)
  }
}

try {
  main()
} catch (error) {
  console.error(`::error::${NAME}: ${error.message}`)
  process.exitCode = 1
}
