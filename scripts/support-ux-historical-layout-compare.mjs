import { readFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { compareHistoricalLayouts, requireHistoricalSha } from "./support-ux-historical-layout-contract.mjs"

export async function writeHistoricalComparison(beforePath, afterPath, afterSha, outputDirectory) {
  requireHistoricalSha(afterSha)
  const [before, after] = await Promise.all([beforePath, afterPath].map(async (file) => JSON.parse(await readFile(file, "utf8"))))
  const report = compareHistoricalLayouts(before, after, afterSha)
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(path.join(outputDirectory, "comparison.json"), JSON.stringify(report, null, 2) + "\n")
  await writeFile(path.join(outputDirectory, "comparison.md"), [
    "# Matched historical Support layout comparison", "", "Status: " + report.status,
    "Before exact source: " + report.beforeSha, "After exact source: " + afterSha,
    "Metric: " + report.controls.metricDefinition, "Formula: " + report.formula,
    "Gate: at least 35% per surface; all four must pass. No aggregate average substitutes for a failed surface.", "",
    "Block counts include rendered descendants under main, including offscreen elements; they are not first-viewport counts.",
    "",
    "| Surface | Before px | After px | Reduction | Before/after rendered blocks | Gate |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.results.map((result) => "| " + [result.id, result.beforeTop, result.afterTop, result.reductionPercent.toFixed(2) + "%", result.beforeBlocks + "/" + result.afterBlocks, result.status].join(" | ") + " |"), "",
    "These synthetic matched measurements are separate from production tenant observation and existing visual/performance stability gates.", "",
  ].join("\n"))
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  if (args.length !== 4) { console.error("Expected before evidence, after evidence, exact candidate SHA and output directory"); process.exitCode = 1 }
  else writeHistoricalComparison(...args).then((report) => {
    console.log("Historical layout per-surface comparison: " + report.status)
    if (report.status !== "passed") process.exitCode = 1
  }).catch(() => { console.error("Historical layout comparison rejected incompatible or incomplete evidence"); process.exitCode = 1 })
}
