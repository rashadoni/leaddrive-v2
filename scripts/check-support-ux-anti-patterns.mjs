import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import ts from "typescript"

const defaultRoots = [
  "src/app/(dashboard)/tickets",
  "src/app/(dashboard)/complaints",
  "src/app/(dashboard)/support/agent-desktop",
  "src/app/(dashboard)/support/voip",
  "src/app/(dashboard)/support/entitlements",
  "src/app/(dashboard)/support/skill-routing",
  "src/app/(dashboard)/support/calendar",
  "src/app/(dashboard)/support/ai-settings",
  "src/app/(dashboard)/knowledge-base",
  "src/app/(dashboard)/settings/ticket-categories",
  "src/app/(dashboard)/settings/sla-policies",
  "src/app/(dashboard)/settings/entitlement-templates",
  "src/app/(dashboard)/settings/escalation",
  "src/app/(dashboard)/settings/macros",
  "src/app/(dashboard)/settings/portal-users",
  "src/app/portal/tickets",
  "src/app/portal/knowledge-base",
  "src/app/portal/chat",
  "src/app/portal/layout.tsx",
  "src/app/ticket-closure",
  "src/components/data-table.tsx",
  "src/components/ai-assistant-panel.tsx",
  "src/components/ai/content-search-bar.tsx",
  "src/components/delete-confirm-dialog.tsx",
  "src/components/convert-to-complaint-dialog.tsx",
  "src/components/kb-article-form.tsx",
  "src/components/portal-chat-widget.tsx",
  "src/components/sla-policy-form.tsx",
  "src/components/support-mobile-navigation.tsx",
  "src/components/ticket-form.tsx",
  "src/components/support",
  "src/components/tickets",
  "src/components/voip",
]

const requestedRoots = (process.env.SUPPORT_UX_SCAN_ROOTS ?? "")
  .split(",")
  .map((root) => root.trim())
  .filter(Boolean)
const roots = requestedRoots.length > 0 ? requestedRoots : defaultRoots

const files = []
function collect(target) {
  const metadata = statSync(target)
  if (metadata.isDirectory()) {
    for (const entry of readdirSync(target).sort()) collect(path.join(target, entry))
    return
  }
  if (target.endsWith(".tsx")) files.push(target)
}

for (const root of roots) collect(root)

const findings = []
const technicalCopyAllowlist = new Set(["Alt+"])
const literalAttributeAllowlist = new Set(["Asia/Baku"])
function report(rule, file, line, excerpt) {
  findings.push({ rule, file, line, excerpt: excerpt.trim().slice(0, 180) })
}

for (const file of files) {
  const source = readFileSync(file, "utf8")
  source.split("\n").forEach((line, index) => {
    const lineNumber = index + 1
    if (/\bbg-gradient\b|\b(?:from|via|to)-(?:purple|violet|pink|indigo|cyan)(?:-|\b)/.test(line)) {
      report("generic-ai-palette-or-gradient", file, lineNumber, line)
    }
    if (/\bborder-l-(?:2|4|8)\b.*\b(?:red|orange|amber|yellow|green|emerald|blue|indigo|violet|purple|pink|cyan)-/.test(line)) {
      report("decorative-colored-side-stripe", file, lineNumber, line)
    }
    if (/\btext-(?:3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/.test(line)) {
      report("oversized-page-typography", file, lineNumber, line)
    }
    if (/\btext-\[(?:9|10|11)px\]\b/.test(line)) {
      report("undersized-interface-copy", file, lineNumber, line)
    }
    if (/return\s+`\$\{[^`]+\}\s+(?:B|KB|MB|GB)`/.test(line)) {
      report("hardcoded-file-size-unit", file, lineNumber, line)
    }
    if (/\bglass-panel\b|\bshadow-2xl\b/.test(line)) {
      report("generic-glass-or-heavy-shadow", file, lineNumber, line)
    }
    if (/\bwindow\.(?:alert|confirm|prompt)\s*\(/.test(line)) {
      report("native-blocking-dialog", file, lineNumber, line)
    }
    if (/\banimate-(?!none)[a-z-]+/.test(line) && !line.includes("motion-reduce:animate-none")) {
      report("animation-without-reduced-motion", file, lineNumber, line)
    }
    if (/\btransition(?:-[a-z-]+)?\b/.test(line) && !line.includes("motion-reduce:transition-none")) {
      report("transition-without-reduced-motion", file, lineNumber, line)
    }
    if (/<summary\b/.test(line) && !line.includes("min-h-11")) {
      report("undersized-summary-target", file, lineNumber, line)
    }
    if (/<summary\b/.test(line) && !line.includes("focus-visible:")) {
      report("summary-without-focus-state", file, lineNumber, line)
    }
  })

  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const labelledControlIds = new Set()
  function collectLabelTargets(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === "htmlFor" && node.initializer) {
      labelledControlIds.add(node.initializer.getText(sourceFile))
    }
    ts.forEachChild(node, collectLabelTargets)
  }
  collectLabelTargets(sourceFile)

  function hasLabelAncestor(node) {
    let parent = node.parent
    while (parent) {
      if (ts.isJsxElement(parent)
        && ["label", "Label", "Field"].includes(parent.openingElement.tagName.getText(sourceFile))) return true
      parent = parent.parent
    }
    return false
  }

  function inspectInteractiveNode(node) {
    const isNativeButton = (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && node.tagName.getText(sourceFile) === "button"
    if (isNativeButton) {
      const openingTag = node.getText(sourceFile)
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      const intentionallyUntabbable = /tabIndex\s*=\s*\{\s*-1\s*\}/.test(openingTag)
      if (!intentionallyUntabbable && !openingTag.includes("focus-visible:")) {
        report("native-button-without-focus-state", file, position.line + 1, openingTag)
      }
      if (!intentionallyUntabbable && !/\b(?:min-)?h-(?:11|12|14|16|20)\b/.test(openingTag)) {
        report("undersized-native-button-target", file, position.line + 1, openingTag)
      }
    }

    if (ts.isJsxAttribute(node)
      && ["aria-label", "title", "placeholder", "alt"].includes(node.name.getText(sourceFile))
      && node.initializer
      && ts.isStringLiteral(node.initializer)
      && /[A-Za-zА-Яа-яƏəİıÖöÜüĞğÇçŞş]/.test(node.initializer.text)
      && !literalAttributeAllowlist.has(node.initializer.text)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      report("hardcoded-localizable-attribute", file, position.line + 1, node.getText(sourceFile))
    }

    if (ts.isJsxText(node)) {
      const copy = node.getText(sourceFile).replace(/\s+/g, " ").trim()
      if (/[A-Za-zА-Яа-яƏəİıÖöÜüĞğÇçŞş]{2}/.test(copy) && !technicalCopyAllowlist.has(copy)) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        report("hardcoded-visible-copy", file, position.line + 1, copy)
      }
    }

    const isNativeFormControl = (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && ["input", "select", "textarea"].includes(node.tagName.getText(sourceFile))
    if (isNativeFormControl) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
      const attribute = (name) => attributes.find((item) => item.name.getText(sourceFile) === name)
      const id = attribute("id")
      const type = attribute("type")
      const isHidden = type?.initializer && ts.isStringLiteral(type.initializer) && type.initializer.text === "hidden"
      const hasAccessibleName = Boolean(attribute("aria-label") || attribute("aria-labelledby")
        || (id?.initializer && labelledControlIds.has(id.initializer.getText(sourceFile)))
        || hasLabelAncestor(node))
      if (!isHidden && !hasAccessibleName) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        report("unlabelled-native-form-control", file, position.line + 1, node.getText(sourceFile))
      }
    }
    ts.forEachChild(node, inspectInteractiveNode)
  }
  inspectInteractiveNode(sourceFile)
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.rule}: ${finding.file}:${finding.line}: ${finding.excerpt}`)
  }
  console.error(`Support UX anti-pattern scan failed with ${findings.length} finding(s) across ${files.length} files.`)
  process.exitCode = 1
} else {
  console.log(`Support UX anti-pattern scan passed: ${files.length} visible TSX files, 0 findings.`)
}
