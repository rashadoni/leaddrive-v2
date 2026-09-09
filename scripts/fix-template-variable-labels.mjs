// One-off data fix (2026-06-10): contract-template variable labels were typed
// with mixed-language parentheticals — "İcraçı (исполнитель)", "Sifarişçi
// (клиент)" — and surface as "translation bugs" in the AZ/EN UI.
//
// Rule (deliberately narrow): strip a trailing parenthetical that CONTAINS
// Cyrillic, but ONLY when the remaining base label has NO Cyrillic itself —
// a legitimately-Russian label ("Исполнитель (подрядчик)") is left untouched.
//
//   node scripts/fix-template-variable-labels.mjs            # dry-run
//   node scripts/fix-template-variable-labels.mjs --execute  # write
import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()
const CYR = /[Ѐ-ӿ]/
const TRAIL_PAREN = /^(.*?)\s*\(([^)]*)\)\s*$/

function cleanLabel(label) {
  if (typeof label !== "string") return null
  const m = TRAIL_PAREN.exec(label)
  if (!m) return null
  const [, base, inner] = m
  if (!CYR.test(inner)) return null // parenthetical isn't Cyrillic — keep
  if (CYR.test(base)) return null // base is Cyrillic too — a RU label, keep
  const cleaned = base.trim()
  return cleaned.length > 0 ? cleaned : null
}

async function main() {
  const execute = process.argv.includes("--execute")
  console.log(`[fix-template-variable-labels] mode=${execute ? "EXECUTE" : "DRY-RUN"}`)

  const templates = await prisma.contractTemplate.findMany({
    select: { id: true, organizationId: true, name: true, variables: true },
  })

  let touched = 0
  for (const tpl of templates) {
    if (!Array.isArray(tpl.variables)) continue
    let changed = false
    const next = tpl.variables.map((v) => {
      if (!v || typeof v !== "object") return v
      const cleaned = cleanLabel(v.label)
      if (cleaned === null) return v
      console.log(`  [${tpl.name}] ${v.name}: "${v.label}" -> "${cleaned}"`)
      changed = true
      return { ...v, label: cleaned }
    })
    if (!changed) continue
    touched++
    if (execute) {
      await prisma.contractTemplate.update({ where: { id: tpl.id }, data: { variables: next } })
    }
  }

  console.log(`[fix-template-variable-labels] done. templatesTouched=${touched}${execute ? "" : " (dry-run, nothing written)"}`)
}

main()
  .catch((e) => {
    console.error("[fix-template-variable-labels] FAILED:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
