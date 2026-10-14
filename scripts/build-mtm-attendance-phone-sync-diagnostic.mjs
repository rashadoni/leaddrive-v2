import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

const output = process.argv[2]
if (!output || process.argv.length !== 3) throw new Error('One output path is required')
const directory = fs.mkdtempSync(join(tmpdir(), 'mtm-phone-sync-diagnostic-'))
try {
  const phone = join(directory, 'phone.cjs')
  execFileSync(process.execPath, ['scripts/build-mtm-attendance-phone-controller.mjs', phone])
  const result = ts.transpileModule(fs.readFileSync('scripts/mtm-attendance-phone-sync-diagnostic.ts', 'utf8'), {
    fileName: 'phone-sync-diagnostic.cts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16, esModuleInterop: true },
  })
  let body = result.outputText
  if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw new Error('Diagnostic controller did not compile')
  for (const [link, replacement] of [
    ['require("./mtm-attendance-phone-fixture")', '__phoneDiagnostic.phone'],
    ['require("./mtm-attendance-demo-verification")', '__phoneDiagnostic.shared'],
  ]) {
    if (body.split(link).length !== 2) throw new Error('Review diagnostic controller dependencies')
    body = body.replace(link, replacement)
  }
  const modeGuard = 'if (!["--phone-sync-diagnostic", "--validate-phone-sync-diagnostic"].includes(process.argv[2])) { process.stderr.write("Unsupported phone diagnostic mode\\n"); process.exit(1); }\n'
  fs.writeFileSync(output, `${modeGuard}const __phoneDiagnostic = (() => { const exports = {};\n${fs.readFileSync(phone, 'utf8')}\nreturn { phone: exports, shared: __phoneShared }; })();\n${body}`, { mode: 0o600 })
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
