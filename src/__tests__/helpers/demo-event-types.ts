import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { REPORTED_JOURNEY_EVENTS } from "@/lib/demo-center/journey"
import { demoEventSchema } from "@/lib/demo-center/validation"

/**
 * Every value application code can write into `demo_access_events.eventType`.
 *
 * The earlier guard read eleven hand-picked files with `[A-Z_]+` patterns, and
 * missed both the files that moved (issue-grant.ts, the phone modules) and the
 * guided player's `journey.*` names — which is how an allow-list that rejected
 * every story move shipped green. This one reads all of `src/`, takes any
 * quoted literal, resolves `const NAME = "…"` in the same file, and maps the
 * two known dynamic writes to the vocabularies they are parsed from. Any other
 * non-literal `eventType:` in a file that writes demo events throws, so a new
 * dynamic write has to be taught here before it can ship.
 */
const DYNAMIC_SOURCES: Record<string, readonly string[]> = {
  // events route, guided player: parsed by demoJourneyReportSchema.
  "report.name": REPORTED_JOURNEY_EVENTS,
  // events route, module player: parsed by demoEventSchema.
  "parsed.data.eventType": demoEventSchema.shape.eventType.options,
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

export function writtenDemoEventTypes(root = process.cwd()): Set<string> {
  const written = new Set<string>()
  for (const file of sourceFiles(path.join(root, "src"))) {
    const source = readFileSync(file, "utf8")
    if (!/demoAccessEvent\.(create|createMany)\b/.test(source) && !/events:\s*\{\s*create:/.test(source)) continue
    for (const [, value] of source.matchAll(/eventType:\s*"([^"]+)"/g)) written.add(value)
    for (const [, expression] of source.matchAll(/eventType:\s*([A-Za-z_][\w.]*)/g)) {
      if (expression === "true" || expression === "false") continue // a select, not a write
      const constant = source.match(new RegExp(`^(?:export )?const ${expression.replace(".", "\\.")} = "([^"]+)"`, "m"))
      if (constant) {
        written.add(constant[1])
        continue
      }
      const dynamic = DYNAMIC_SOURCES[expression]
      if (!dynamic) {
        throw new Error(`${path.relative(root, file)} writes eventType from \`${expression}\`; add its vocabulary to DYNAMIC_SOURCES`)
      }
      for (const value of dynamic) written.add(value)
    }
  }
  return written
}
