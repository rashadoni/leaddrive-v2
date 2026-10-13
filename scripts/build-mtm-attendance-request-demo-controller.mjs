import fs from "node:fs"
import ts from "typescript"
const output = process.argv[2]
if (!output || process.argv.length !== 3) throw new Error("One controller output path is required")
function compile(file) {
  const result = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: "controller.cts", reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, esModuleInterop: true } })
  if (result.diagnostics?.some(entry => entry.category === ts.DiagnosticCategory.Error)) throw new Error("Controller source did not compile")
  return result.outputText
}
const parser = compile("src/lib/mtm/workday-pauses.ts")
const base = compile("scripts/mtm-attendance-demo-verification.ts")
const requests = compile("scripts/mtm-attendance-request-demo-verification.ts")
const parserLink = 'require("../src/lib/mtm/workday-pauses")'
const baseLink = 'require("./mtm-attendance-demo-verification")'
if (/\brequire\(/.test(parser) || base.split(parserLink).length !== 2 || requests.split(baseLink).length !== 2) throw new Error("Review controller dependency shape")
const wrap = source => `(() => { const exports = {};\n${source}\nreturn exports; })()`
fs.writeFileSync(output, `const __pause = ${wrap(parser)};\nconst __base = ${wrap(base.replace(parserLink, "__pause"))};\n${requests.replace(baseLink, "__base")}`, { mode: 0o600 })
