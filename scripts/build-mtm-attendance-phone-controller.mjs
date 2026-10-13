import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

const output = process.argv[2]
if (!output || process.argv.length !== 3) throw new Error('One output path is required')
const directory = fs.mkdtempSync(join(tmpdir(), 'mtm-phone-controller-'))
try {
  const shared = join(directory, 'shared.cjs')
  execFileSync(process.execPath, ['scripts/build-mtm-attendance-demo-controller.mjs', shared])
  const result = ts.transpileModule(fs.readFileSync('scripts/mtm-attendance-phone-fixture.ts', 'utf8'), {
    fileName: 'phone.cts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16, esModuleInterop: true },
  })
  const link = 'require("./mtm-attendance-demo-verification")'
  if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
    || result.outputText.split(link).length !== 2) throw new Error('Review phone controller dependencies')
  fs.writeFileSync(output, `const __phoneShared = (() => { const exports = {};\n${fs.readFileSync(shared, 'utf8')}\nreturn exports; })();\n${result.outputText.replace(link, '__phoneShared')}`, { mode: 0o600 })
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
