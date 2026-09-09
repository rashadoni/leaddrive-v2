#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const workflowDir = path.resolve(".github/workflows");
const files = (await readdir(workflowDir))
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort();
const errors = [];

for (const name of files) {
  const file = path.join(workflowDir, name);
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (/runs-on\s*:\s*.*macos-/i.test(line)) {
      errors.push(`${name}:${index + 1}: GitHub-hosted macOS runner is prohibited`);
    }

    if (/runs-on\s*:/i.test(line) && /\bmacOS\b/i.test(line)) {
      for (const label of ["self-hosted", "ARM64", "leaddrive-mac-local"]) {
        if (!line.includes(label)) {
          errors.push(`${name}:${index + 1}: macOS runner must include ${label}`);
        }
      }
    }

    if (/runs-on\s*:/i.test(line) && /leaddrive-(?:ci|ci-light|typecheck)\b/i.test(line)) {
      errors.push(`${name}:${index + 1}: legacy Contabo CI runner label is prohibited`);
    }
  });
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Runner policy passed for ${files.length} workflow files.`);
