import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"

/**
 * The database decides which voice-session statuses may exist; the application
 * decides which ones it writes. Nothing kept the two in step, and twice now the
 * app has written a value the CHECK constraint rejects.
 *
 * The second time cost real money. The reaper closes abandoned sessions in one
 * loop over a 200-row batch, oldest first, with no per-row error handling — so
 * a single rejected write aborts the batch for every tenant, leaves the row
 * `active`, and hands the same row back first on the next run. The reservation
 * is never released. An organisation reached 115 of 120 reserved minutes having
 * spoken 60.
 *
 * Neither failure was invisible: Postgres raised, the cron logged it, and it was
 * read as noise twice. So the guard belongs here, where it fails before merge
 * rather than in a log nobody reads.
 */

const SRC = join(process.cwd(), "src")
const MIGRATIONS = join(process.cwd(), "prisma", "migrations")

/** Every status the CHECK constraint allows, per the most recent migration that redefines it. */
function allowedStatuses(): string[] {
  const dirs = readdirSync(MIGRATIONS)
    .filter(d => statSync(join(MIGRATIONS, d)).isDirectory())
    .sort() // migration directories are timestamp-prefixed, so the last one wins
  let allowed: string[] | null = null
  for (const dir of dirs) {
    let sql: string
    try {
      sql = readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8")
    } catch {
      continue
    }
    // Match the constraint on voice_sessions specifically — other tables have
    // status checks of their own and must not be picked up here.
    const re = /voice_sessions_status_check[\s\S]{0,200}?CHECK\s*\(\s*"?status"?\s+IN\s*\(([^)]*)\)/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(sql))) {
      allowed = [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])
    }
  }
  return allowed ?? []
}

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue
      out.push(...tsFiles(full))
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full)
    }
  }
  return out
}

/** Every status the application writes to voice_sessions, with the file that writes it. */
function writtenStatuses(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of tsFiles(SRC)) {
    const source = readFileSync(file, "utf8")
    if (!source.includes("voiceSession")) continue
    const call = /voiceSession\.(?:update|updateMany|create|createMany|upsert)\b/g
    let m: RegExpExecArray | null
    while ((m = call.exec(source))) {
      // A write's `data` block sits within a few hundred characters of the call.
      // Deliberately generous: a missed write is a silent hole in this guard,
      // while an extra status only makes the constraint slightly wider.
      const window = source.slice(m.index, m.index + 800)
      for (const s of window.matchAll(/status:\s*[^,\n]*?"([a-z_]+)"/g)) {
        if (!found.has(s[1])) found.set(s[1], file.replace(process.cwd() + "/", ""))
      }
      // `status: cond ? "a" : "b"` — both arms are written values.
      for (const s of window.matchAll(/status:\s*[^,\n]*\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/g)) {
        if (!found.has(s[1])) found.set(s[1], file.replace(process.cwd() + "/", ""))
        if (!found.has(s[2])) found.set(s[2], file.replace(process.cwd() + "/", ""))
      }
    }
  }
  return found
}

describe("voice session status contract", () => {
  it("finds the constraint and the writes at all", () => {
    // Negative control. Both halves of this test are pattern matches over source
    // text, and a pattern that stops matching would turn this file into a test
    // that always passes — which is the failure mode it exists to prevent.
    expect(allowedStatuses().length).toBeGreaterThanOrEqual(3)
    expect(allowedStatuses()).toContain("active")
    const written = writtenStatuses()
    expect(written.size).toBeGreaterThanOrEqual(3)
    expect([...written.keys()]).toContain("active")
  })

  it("allows every status the application writes", () => {
    const allowed = new Set(allowedStatuses())
    const rejected = [...writtenStatuses().entries()].filter(([status]) => !allowed.has(status))
    expect(
      rejected.map(([status, file]) => `${status} (written in ${file})`),
    ).toEqual([])
  })
})
