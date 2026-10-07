import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const helper = "src/lib/workforce/sensitive-operation-log.ts"
function files(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}
const scope = [
  ...files("src/lib/workforce"), ...files("src/app/api/v1/workforce"),
  ...readdirSync(join(root, "src/app/api/cron"), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith("workforce"))
    .flatMap(entry => files(`src/app/api/cron/${entry.name}`)),
  "src/lib/with-workforce-rls-auth.ts",
]
const sources = scope.map(path => ({ path, ast: ts.createSourceFile(path, readFileSync(join(root, path), "utf8"), ts.ScriptTarget.Latest, true) }))
function visit(node: ts.Node, inspect: (node: ts.Node) => void) {
  inspect(node)
  ts.forEachChild(node, child => visit(child, inspect))
}

describe("Owned Workforce source logging boundary", () => {
  it("allows console references only in the two reviewed shared sink calls, rejecting aliases too", () => {
    const sinkReferences: string[] = []
    const violations: string[] = []
    for (const { path, ast } of sources) visit(ast, node => {
      if ((ts.isIdentifier(node) && node.text === "console") || (ts.isStringLiteral(node) && ["console", "node:console"].includes(node.text))) {
        const property = node.parent
        const call = property.parent
        if (path === helper && ts.isPropertyAccessExpression(property) && property.expression === node
          && ["error", "warn"].includes(property.name.text) && ts.isCallExpression(call) && call.expression === property) {
          sinkReferences.push(property.name.text)
        } else violations.push(`${path}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`)
      }
    })
    expect(violations, JSON.stringify(violations)).toEqual([])
    expect(sinkReferences.sort()).toEqual(["error", "warn"])
  })
  it("traces every owned logger operation to an allowlisted literal", () => {
    const declarations = new Map<string, Set<string>>()
    const helperAst = sources.find(source => source.path === helper)!.ast
    for (const statement of helperAst.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name) continue
      const values = new Set<string>()
      for (const parameter of statement.parameters) visit(parameter, node => {
        if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) values.add(node.literal.text)
      })
      declarations.set(statement.name.text, values)
    }
    let calls = 0
    const violations: string[] = []
    for (const { path, ast } of sources) visit(ast, node => {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !declarations.has(node.expression.text)) return
      calls++
      const input = node.arguments[0]
      const property = input && ts.isObjectLiteralExpression(input) && input.properties.length === 1 ? input.properties[0] : null
      // One existing private adapter forwards a finite operation from two literal callers.
      // Verify both the adapter's non-exported declaration and every reference, including alias escapes.
      if (path === "src/lib/workforce/evidence-timeline-access.ts" && property
        && ts.isPropertyAssignment(property) && property.initializer.getText(ast) === "input.operation") {
        let declarationCount = 0
        let callerCount = 0
        visit(ast, candidate => {
          if (!ts.isIdentifier(candidate) || candidate.text !== "evidenceAccessSnapshot") return
          const parent = candidate.parent
          if (ts.isFunctionDeclaration(parent) && parent.name === candidate && !parent.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
            declarationCount++
          } else if (ts.isCallExpression(parent) && parent.expression === candidate && parent.arguments.length === 1 && ts.isObjectLiteralExpression(parent.arguments[0])) {
            const properties = parent.arguments[0].properties
            const operation = properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(ast) === "operation")
            if (properties.some(item => ts.isSpreadAssignment(item)) || !operation || !ts.isPropertyAssignment(operation)
              || !ts.isStringLiteral(operation.initializer) || !declarations.get(node.expression.getText(ast))!.has(operation.initializer.text)) violations.push(`${path}:adapter argument`)
            callerCount++
          } else violations.push(`${path}:adapter escaped`)
        })
        expect(declarationCount).toBe(1)
        expect(callerCount).toBe(2)
        return
      }
      if (!property || !ts.isPropertyAssignment(property) || property.name.getText(ast) !== "operation"
        || !ts.isStringLiteral(property.initializer) || !declarations.get(node.expression.text)!.has(property.initializer.text)) {
        violations.push(`${path}:${node.getStart(ast)}`)
      }
    })
    expect(violations, JSON.stringify(violations)).toEqual([])
    expect(calls).toBeGreaterThanOrEqual(53)
  })
  it("requires a boundary audit if owned files add a direct external telemetry sink or dynamic evaluation", () => {
    const violations: string[] = []
    for (const { path, ast } of sources) visit(ast, node => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
        && /(?:sentry|analytics|telemetry|(?:^|\/)logger$|(?:^|:)console$)/i.test(node.moduleSpecifier.text)) violations.push(path)
      if (ts.isCallExpression(node) && ["eval", "Function"].includes(node.expression.getText(ast))) violations.push(path)
    })
    expect(violations.map(path => relative(root, join(root, path)))).toEqual([])
  })
})
