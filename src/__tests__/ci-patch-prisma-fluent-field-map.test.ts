/**
 * Patch only disposable copies, never the shared development installation.
 * Exercise both shipped library formats with the real Prisma runtime and an
 * independent miniature DMMF. Query transport and transaction transport are
 * mocked; no generated client, database, engine binary, or network is needed.
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"

const ROOT = process.cwd()
const SCRIPT = path.join(ROOT, "scripts/ci/patch-prisma-fluent-field-map.mjs")
const requireFromRoot = createRequire(path.join(ROOT, "package.json"))
const PRISMA_DIR = path.dirname(requireFromRoot.resolve("@prisma/client/package.json"))
const VERSION = JSON.parse(readFileSync(path.join(PRISMA_DIR, "package.json"), "utf8")).version
const TARGETS = ["runtime/library.js", "runtime/library.mjs"]
const MARKER = "/* leaddrive: scripts/ci/patch-prisma-fluent-field-map.mjs */"
const ORIGINAL = "e._runtimeDataModel.models[r].fields.reduce((l,u)=>({...l,[u.name]:u}),{})"
const REPLACEMENT = `Object.fromEntries(e._runtimeDataModel.models[r].fields.map(u=>[u.name,u]))${MARKER}`
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
const installedBefore = TARGETS.map((file) => sha256(path.join(PRISMA_DIR, file)))
const scratch = mkdtempSync(path.join(tmpdir(), "prisma-fluent-field-map-"))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
  expect(TARGETS.map((file) => sha256(path.join(PRISMA_DIR, file)))).toEqual(installedBefore)
})

let projects = 0
function project(version = VERSION) {
  const root = path.join(scratch, `project-${++projects}`)
  const prisma = path.join(root, "node_modules/@prisma/client")
  mkdirSync(path.join(prisma, "runtime"), { recursive: true })
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "probe", private: true }))
  writeFileSync(path.join(prisma, "package.json"), JSON.stringify({ name: "@prisma/client", version }))
  for (const file of TARGETS) cpSync(path.join(PRISMA_DIR, file), path.join(prisma, file))
  return {
    root,
    prisma,
    file: (file: string) => path.join(prisma, file),
    read: (file: string) => readFileSync(path.join(prisma, file), "utf8"),
    hashes: () => TARGETS.map((file) => sha256(path.join(prisma, file))),
  }
}

const LOCAL_ENV = { ...process.env }
delete LOCAL_ENV.GITHUB_ACTIONS
function patch(root: string, flags = ["--allow-local"], ci = false, cwd = ROOT) {
  const result = spawnSync(process.execPath, [SCRIPT, ...flags, ...(cwd === root ? [] : [root])], {
    cwd,
    env: { ...LOCAL_ENV, ...(ci ? { GITHUB_ACTIONS: "true" } : {}) },
    encoding: "utf8",
    timeout: 10_000,
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

describe("patch-prisma-fluent-field-map safeguards", () => {
  it("matches the locked library runtime and changes only the one expression in both formats", () => {
    expect(VERSION).toBe("6.19.2")
    const copy = project()
    const before = TARGETS.map(copy.read)
    const run = patch(copy.root)
    expect(run.status, run.out).toBe(0)
    for (const [index, file] of TARGETS.entries()) {
      expect(before[index].split(ORIGINAL)).toHaveLength(2)
      expect(copy.read(file)).toBe(before[index].replace(ORIGINAL, REPLACEMENT))
    }
    const once = copy.hashes()
    const again = patch(copy.root)
    expect(again.status, again.out).toBe(0)
    expect(again.out.match(/already patched/g)).toHaveLength(2)
    expect(copy.hashes()).toEqual(once)
  })

  it("resolves from the supplied project or cwd, and allows explicit CI execution", () => {
    const copy = project()
    const run = patch(copy.root, [], true, copy.root)
    expect(run.status, run.out).toBe(0)
    expect(run.out).toContain(copy.file(TARGETS[0]))
  })

  it("refuses local writes without the flag", () => {
    const copy = project()
    const before = copy.hashes()
    const run = patch(copy.root, [])
    expect(run.status).toBe(1)
    expect(run.out).toContain("outside GitHub Actions")
    expect(copy.hashes()).toEqual(before)
  })

  it.each(["6.19.3", "6.19.1", "7.0.0"])("refuses version %s without changing either runtime", (version) => {
    const copy = project(version)
    const before = copy.hashes()
    const run = patch(copy.root)
    expect(run.status).toBe(1)
    expect(run.out).toContain(`installed @prisma/client is ${version}`)
    expect(copy.hashes()).toEqual(before)
  })

  it.each([
    ["missing expression", (source: string) => source.replace(ORIGINAL, "{}")],
    ["duplicate expression", (source: string) => `${source}\n/* ${ORIGINAL} */`],
    ["incomplete marker", (source: string) => `${source}\n${MARKER}`],
  ])("validates the second runtime before any write: %s", (_label, edit) => {
    const copy = project()
    writeFileSync(copy.file(TARGETS[1]), edit(copy.read(TARGETS[1])))
    const before = copy.hashes()
    const run = patch(copy.root)
    expect(run.status).toBe(1)
    expect(run.out).toContain("expected one applyFluent field map")
    expect(copy.hashes()).toEqual(before)
  })

  it("refuses a missing second runtime before writing the first", () => {
    const copy = project()
    const before = sha256(copy.file(TARGETS[0]))
    rmSync(copy.file(TARGETS[1]))
    expect(patch(copy.root).status).toBe(1)
    expect(sha256(copy.file(TARGETS[0]))).toBe(before)
  })

  it.each(["node_modules", "package", "runtime"])("refuses an escaping %s symlink even with --allow-local or in CI", (level) => {
    const owner = project()
    const copy = project()
    const from = level === "node_modules" ? path.join(copy.root, "node_modules") : level === "package" ? copy.prisma : copy.file(TARGETS[1])
    const to = level === "node_modules" ? path.join(owner.root, "node_modules") : level === "package" ? owner.prisma : owner.file(TARGETS[1])
    rmSync(from, { recursive: true, force: true })
    symlinkSync(to, from)
    const ownerBefore = owner.hashes()
    const copyBefore = copy.hashes()
    for (const ci of [false, true]) {
      const run = patch(copy.root, ci ? [] : ["--allow-local"], ci)
      expect(run.status, run.out).toBe(1)
      expect(run.out).toContain("refusing")
      expect(owner.hashes()).toEqual(ownerBefore)
      expect(copy.hashes()).toEqual(copyBefore)
    }
  })

  it("--check is read-only outside CI and rejects an unpatched or partly patched artifact", () => {
    const copy = project()
    const original = copy.hashes()
    expect(patch(copy.root, ["--check"]).status).toBe(1)
    expect(copy.hashes()).toEqual(original)
    writeFileSync(copy.file(TARGETS[0]), copy.read(TARGETS[0]).replace(ORIGINAL, REPLACEMENT))
    const partial = copy.hashes()
    expect(patch(copy.root, ["--check"]).status).toBe(1)
    expect(copy.hashes()).toEqual(partial)
    const repair = patch(copy.root)
    expect(repair.status, repair.out).toBe(0)
    const complete = copy.hashes()
    const check = patch(copy.root, ["--check"])
    expect(check.status, check.out).toBe(0)
    expect(check.out.match(/verified/g)).toHaveLength(2)
    expect(copy.hashes()).toEqual(complete)
  })

  it("refuses shared runtime inodes before writing either file", () => {
    const owner = project()
    const copy = project()
    rmSync(copy.file(TARGETS[1]))
    linkSync(owner.file(TARGETS[1]), copy.file(TARGETS[1]))
    const ownerBefore = owner.hashes()
    const copyBefore = copy.hashes()
    const run = patch(copy.root)
    expect(run.status).toBe(1)
    expect(run.out).toContain("shared/hardlinked inode")
    expect(copy.hashes()).toEqual(copyBefore)
    expect(owner.hashes()).toEqual(ownerBefore)
  })

  it("rejects invalid options and absent installs", () => {
    const copy = project()
    const before = copy.hashes()
    expect(patch(copy.root, ["--allow-locale"]).status).toBe(1)
    expect(patch(copy.root, ["--allow-local", copy.root]).status).toBe(1)
    expect(copy.hashes()).toEqual(before)
    rmSync(path.join(copy.root, "node_modules"), { recursive: true })
    expect(patch(copy.root).status).toBe(1)
  })

  it("patches both production builds and verifies the assembled deployment before packaging", () => {
    for (const file of ["deploy.yml", "pr-checks.yml"]) {
      const workflow = readFileSync(path.join(ROOT, ".github/workflows", file), "utf8")
      const patchAt = workflow.indexOf("run: node scripts/ci/patch-prisma-fluent-field-map.mjs\n")
      const buildAt = workflow.indexOf("/usr/bin/time -v npx next build --webpack")
      expect(patchAt, file).toBeGreaterThan(0)
      expect(workflow.lastIndexOf("run: npx prisma generate", patchAt), file).toBeGreaterThan(0)
      expect(buildAt, file).toBeGreaterThan(patchAt)
      if (file === "deploy.yml") {
        const assembleAt = workflow.indexOf("- name: Assemble standalone bundle")
        const checkAt = workflow.indexOf("run: node scripts/ci/patch-prisma-fluent-field-map.mjs --check .next/standalone")
        expect(assembleAt).toBeGreaterThan(buildAt)
        expect(checkAt).toBeGreaterThan(assembleAt)
        expect(workflow.indexOf("- name: Create deployment tarball")).toBeGreaterThan(checkAt)
      }
    }
  })
})

// Execute each actual runtime in its own native Node module context. This also
// tests that the ESM edit parses and imports, without Vitest rewriting it.
const RUNTIME_BEHAVIOR = String.raw`
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
globalThis.fetch = () => { throw new Error("Network is forbidden in this fixture"); };
const runtime = await import(pathToFileURL(process.argv[1]).href);
const { getPrismaClient } = runtime.default ?? runtime;
const scalar = name => ({ name, kind: "scalar", type: "String", isList: false, isRequired: true, isId: name === "id" });
const relation = (name, type) => ({ name, kind: "object", type, isList: false, isRequired: true, relationName: name });
const model = fields => ({ dbName: null, fields, primaryKey: null, uniqueFields: [], uniqueIndexes: [] });
const PrismaClient = getPrismaClient({
  dirname: process.cwd(), clientVersion: "6.19.2", engineVersion: "fixture",
  generator: { provider: { value: "prisma-client-js" }, config: { engineType: "library" }, previewFeatures: [] },
  relativeEnvPaths: {}, relativePath: ".", activeProvider: "postgresql", datasourceNames: ["db"],
  // Selects the lazy proxy engine, so constructing the client needs no native
  // engine binary. All requests below stop at mocked transport, before I/O.
  inlineDatasources: { db: { url: { value: "prisma://localhost/?api_key=fixture" } } },
  inlineSchema: "", inlineSchemaHash: "fixture",
  runtimeDataModel: { models: {
    Organization: model([scalar("id"), ...Array.from({ length: 534 }, (_, i) => scalar("field" + i)), relation("owner", "User")]),
    User: model([scalar("id"), relation("organization", "Organization")]),
  }, enums: {}, types: {} },
});
const client = new PrismaClient();
const requests = [];
let failure;
client._requestHandler.request = async params => {
  requests.push(params);
  if (failure) throw failure;
  return { id: "org-1" };
};
const transactions = [];
const info = { id: "transaction-1", payload: { fixture: true } };
client._engine.transaction = async (action, _headers, options) => {
  transactions.push({ action, options });
  return info;
};

const getter = client.organization.findUnique;
assert.equal(requests.length, 0);
const lazy = getter({ where: { id: "org-1" } });
assert.equal(requests.length, 0);
assert.equal(lazy[Symbol.toStringTag], "PrismaPromise");
assert.equal(typeof lazy.owner, "function");
assert.equal(lazy.field0, undefined);
assert.ok(Object.keys(lazy).includes("owner"));
assert.deepEqual(await lazy, { id: "org-1" });
assert.deepEqual(await lazy, { id: "org-1" });
assert.equal(requests.length, 1, "awaiting the same lazy query does not run twice");
assert.equal(requests[0].action, "findUnique");
assert.equal(requests[0].modelName, "Organization");
assert.deepEqual(requests[0].args, { where: { id: "org-1" } });

await client.organization.findFirst({ where: { id: "org-1" } });
assert.equal(requests.at(-1).action, "findFirst");
const chained = client.organization.findUnique({ where: { id: "org-1" } })
  .owner().organization({ select: { id: true } });
assert.equal(requests.length, 2);
await chained;
assert.deepEqual(requests.at(-1).dataPath, ["select", "owner", "select", "organization"]);
assert.deepEqual(requests.at(-1).args, {
  where: { id: "org-1" }, select: { owner: { select: { organization: { select: { id: true } } } } },
});
assert.equal(requests.at(-1).protocolQuery.modelName, "Organization");

const extensionCalls = [];
const extended = client.$extends({
  query: { organization: { findUnique: async ({ model, operation, args, query }) => {
    extensionCalls.push({ model, operation });
    return query({ ...args, where: { ...args.where, id: "scoped-org" } });
  } } },
  result: { organization: { label: { needs: { id: true }, compute: value => "label:" + value.id } } },
});
const result = await extended.organization.findUnique({ where: { id: "unscoped-org" } });
assert.equal(result.label, "label:org-1");
assert.deepEqual(extensionCalls, [{ model: "Organization", operation: "findUnique" }]);
assert.equal(requests.at(-1).args.where.id, "scoped-org");

const txStart = requests.length;
await extended.$transaction(async tx => {
  await tx.organization.findUnique({ where: { id: "org-1" } });
  await tx.organization.findUnique({ where: { id: "org-1" } }).owner();
});
const firstTx = requests[txStart].transaction;
assert.equal(firstTx.kind, "itx");
assert.equal(firstTx.id, info.id);
assert.equal(firstTx.payload, info.payload);
assert.equal(requests[txStart + 1].transaction, firstTx, "both fluent queries retain the same transaction");
assert.equal(requests[txStart].args.where.id, "scoped-org");
assert.equal(requests[txStart + 1].args.where.id, "scoped-org");
assert.deepEqual(transactions.map(tx => tx.action), ["start", "commit"]);
assert.equal(transactions.at(-1).options, info);

const batchStart = requests.length;
await client.$transaction([
  client.organization.findUnique({ where: { id: "org-1" } }),
  client.organization.findFirst({ where: { id: "org-2" } }),
]);
const batch = requests.slice(batchStart);
assert.deepEqual(batch.map(r => r.transaction.kind), ["batch", "batch"]);
assert.deepEqual(batch.map(r => r.transaction.index), [0, 1]);
assert.equal(batch[0].transaction.id, batch[1].transaction.id);

const beforeValidation = requests.length;
await assert.rejects(async () => await client.organization.findUnique({ select: { id: true }, include: { owner: true } }),
  error => error.name === "PrismaClientValidationError");
assert.equal(requests.length, beforeValidation);
failure = new Error("fixture query rejected");
await assert.rejects(client.$transaction(tx => tx.organization.findUnique({ where: { id: "org-1" } }).owner()),
  error => error === failure);
assert.deepEqual(transactions.slice(-2).map(tx => tx.action), ["start", "rollback"]);

console.log("runtime-behavior-ok");
`

describe("patched Prisma runtime behavior", () => {
  it("preserves field references, empty maps, key order, duplicates and special own-property names", () => {
    const copy = project()
    const before = copy.read(TARGETS[0])
    expect(patch(copy.root).status).toBe(0)
    expect(before).toContain(ORIGINAL)
    expect(copy.read(TARGETS[0])).toContain(REPLACEMENT)
    // Evaluate the exact installed and replacement expressions; do not rewrite
    // either algorithm in the test. All input is trusted installed source.
    const evaluate = (expression: string, fields: { name: string }[]) =>
      new Function("e", "r", `return ${expression}`)({ _runtimeDataModel: { models: { Probe: { fields } } } }, "Probe")
    const fields = ["id", "__proto__", "constructor", "hasOwnProperty", "id", "toString"].map((name) => ({ name }))
    for (const input of [[], fields]) {
      const original = evaluate(ORIGINAL, input)
      const patched = evaluate(REPLACEMENT, input)
      expect(Object.getPrototypeOf(patched)).toBe(Object.prototype)
      expect(Object.getOwnPropertyDescriptors(patched)).toEqual(Object.getOwnPropertyDescriptors(original))
      expect(Reflect.ownKeys(patched)).toEqual(Reflect.ownKeys(original))
      for (const field of input) expect(patched[field.name]).toBe(input.findLast((candidate) => candidate.name === field.name))
    }
  })

  it.each(TARGETS)("preserves lazy queries, relations, extensions, transactions and errors in %s", (file) => {
    const copy = project()
    // Both the unpatched control and patched runtime must satisfy the same
    // behavioral contract. The schema is independent of shared generated code.
    for (const patched of [false, true]) {
      if (patched) expect(patch(copy.root).status).toBe(0)
      const run = spawnSync(process.execPath, ["--input-type=module", "-e", RUNTIME_BEHAVIOR, copy.file(file)], {
        cwd: copy.root,
        env: LOCAL_ENV,
        encoding: "utf8",
        timeout: 10_000,
      })
      expect(run.status, `${patched ? "patched" : "original"}: ${run.stdout}\n${run.stderr}`).toBe(0)
      expect(run.stdout).toContain("runtime-behavior-ok")
    }
  })
})
