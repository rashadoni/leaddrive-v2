import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

const output = process.argv[2]
if (!output || process.argv.length !== 3) throw new Error('One output path is required')
const directory = fs.mkdtempSync(join(tmpdir(), 'mtm-phone-access-'))
try {
  const phone = join(directory, 'phone.cjs')
  execFileSync(process.execPath, ['scripts/build-mtm-attendance-phone-controller.mjs', phone])
  const result = ts.transpileModule(fs.readFileSync('scripts/mtm-attendance-phone-access.ts', 'utf8'), {
    fileName: 'phone-access.cts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16, esModuleInterop: true },
  })
  let body = result.outputText
  if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw new Error('Access controller did not compile')
  for (const [link, replacement] of [
    ['require("./mtm-attendance-phone-fixture")', '__phoneAccess.phone'],
    ['require("./mtm-attendance-demo-verification")', '__phoneAccess.shared'],
  ]) {
    if (body.split(link).length !== 2) throw new Error('Review access controller dependencies')
    body = body.replace(link, replacement)
  }
  const modeGuard = 'if (!["--phone-access", "--phone-access-recipient", "--validate-phone-access"].includes(process.argv[2])) { process.stderr.write("Unsupported phone access mode\\n"); process.exit(1); }\n'
  fs.writeFileSync(output, `${modeGuard}const __phoneAccess = (() => { const exports = {};\n${fs.readFileSync(phone, 'utf8')}\nreturn { phone: exports, shared: __phoneShared }; })();\n${body}`, { mode: 0o600 })
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
