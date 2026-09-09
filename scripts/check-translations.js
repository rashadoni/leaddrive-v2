/**
 * Translation parity checker.
 *
 * Walks every key in messages/en.json (source of truth) and verifies
 * the same path exists in messages/ru.json and messages/az.json.
 *
 * Exits 0 if parity is complete, 1 otherwise so it can be wired into CI
 * or a pre-commit hook.
 *
 * Usage:
 *   npm run i18n:check
 *   node scripts/check-translations.js
 *   node scripts/check-translations.js --fix        # stub missing keys with [TODO:lang] placeholders
 *   node scripts/check-translations.js --source=ru  # use ru.json as the source instead
 */

const fs = require("node:fs");
const path = require("node:path");

const MESSAGES_DIR = path.resolve(process.cwd(), "messages");
const LOCALES = ["en", "ru", "az"];

function parseArgs() {
  const args = { fix: false, source: "en" };
  for (const a of process.argv.slice(2)) {
    if (a === "--fix") args.fix = true;
    else if (a.startsWith("--source=")) {
      const val = a.slice("--source=".length);
      if (!LOCALES.includes(val)) {
        console.error(`Invalid --source. Must be one of: ${LOCALES.join(", ")}`);
        process.exit(1);
      }
      args.source = val;
    }
  }
  return args;
}

function loadLocale(locale) {
  return JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8"));
}

/** Collect leaf paths (dotted) from a JSON object. Arrays are treated as leaves. */
function collectKeys(obj, prefix, out) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    out.push(prefix);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    collectKeys(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

function getAt(obj, pathDotted) {
  const parts = pathDotted.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = cur[p];
    if (cur === undefined) return undefined;
  }
  return cur;
}

function setAt(obj, pathDotted, value) {
  const parts = pathDotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== "object" || Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function main() {
  const args = parseArgs();
  const source = loadLocale(args.source);
  const sourceKeys = [];
  collectKeys(source, "", sourceKeys);

  const lines = [`Source: ${args.source}.json — ${sourceKeys.length} leaf keys`];
  let failed = false;

  for (const loc of LOCALES.filter((l) => l !== args.source)) {
    const data = loadLocale(loc);
    const missing = [];
    for (const key of sourceKeys) if (getAt(data, key) === undefined) missing.push(key);

    const dataKeys = [];
    collectKeys(data, "", dataKeys);
    const extra = dataKeys.filter((k) => getAt(source, k) === undefined);

    lines.push(`\n[${loc}.json] missing=${missing.length} extra=${extra.length}`);
    if (missing.length) {
      const show = missing.slice(0, 20);
      for (const k of show) lines.push(`  - ${k}`);
      if (missing.length > show.length) lines.push(`  ... and ${missing.length - show.length} more`);
    }

    if (missing.length) failed = true;

    if (args.fix && missing.length) {
      for (const key of missing) {
        const srcValue = getAt(source, key);
        const placeholder = typeof srcValue === "string" ? `[TODO:${loc}] ${srcValue}` : srcValue;
        setAt(data, key, placeholder);
      }
      fs.writeFileSync(path.join(MESSAGES_DIR, `${loc}.json`), JSON.stringify(data, null, 2) + "\n");
      lines.push(`  → wrote ${missing.length} placeholders to ${loc}.json`);
    }
  }

  // Single write avoids slow per-line flushes on huge key sets.
  process.stdout.write(lines.join("\n") + "\n");

  if (failed && !args.fix) {
    process.stderr.write("\n❌ Translation parity FAILED. Run with --fix to stub missing keys.\n");
    process.exit(1);
  }
  process.stdout.write("\n✅ Translation parity OK\n");
}

main();
