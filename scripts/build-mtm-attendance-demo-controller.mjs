// Deliberately only these two reviewed sources. TypeScript is a pinned project
// dependency; this does not download a bundler or import the application tree.
import fs from "node:fs"
import ts from "typescript"

const output = process.argv[2]
if (!output || process.argv.length !== 3) throw new Error("One controller output path is required")
function compile(file, fileName) {
  const result = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16, esModuleInterop: true },
  })
  if (result.diagnostics?.some((entry) => entry.category === ts.DiagnosticCategory.Error)) throw new Error("Controller source did not compile")
  return result.outputText
}
const parser = compile("src/lib/mtm/workday-pauses.ts", "workday-pauses.cts")
const controller = compile("scripts/mtm-attendance-demo-verification.ts", "controller.cts")
const link = 'require("../src/lib/mtm/workday-pauses")'
if (controller.split(link).length !== 2 || /\brequire\(/.test(parser)) throw new Error("Controller dependency shape changed; review bundling")
const body = `const __attendancePauseParser = (() => { const exports = {};\n${parser}\nreturn exports; })();\n${controller.replace(link, "__attendancePauseParser")}`
fs.writeFileSync(output, body, { mode: 0o600 })
