// One browser, actual Vitest-rendered help. Run after the narrow UI test.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const {createRequire} = require('node:module')
const root = process.cwd(), req = createRequire(path.join(root, 'package.json'))
;(async () => {
  const input = process.env.MTM_ATTENDANCE_RENDER_DIR || '/tmp/mtm-hr-help-render'
  const output = path.join(root, 'docs/mtm-attendance/evidence/hr-help/actual')
  fs.mkdirSync(output, {recursive: true})
  const classes = new Set(), sources = {}
  for (const locale of ['ru', 'az', 'en']) {
    const name = `attendance-help-${locale}.html`, html = fs.readFileSync(path.join(input, name), 'utf8')
    sources[name] = crypto.createHash('sha256').update(html).digest('hex')
    for (const match of html.matchAll(/class="([^"]+)"/g)) for (const name of match[1].split(/\s+/)) classes.add(name)
  }
  const {compile} = req('@tailwindcss/node')
  const css = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);')
  const compiler = await compile(css, {base: path.join(root, 'src/app'), onDependency() {}})
  fs.writeFileSync(path.join(input, 'attendance.css'), compiler.build([...classes]))
  const {chromium} = req('playwright')
  const browser = await chromium.launch({executablePath: '/home/codex-alt/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-sandbox']})
  const results = []
  try {
    for (const locale of ['ru', 'az', 'en']) for (const width of [1440, 390]) {
      const page = await browser.newPage({viewport: {width, height: 1000}, deviceScaleFactor: 1})
      await page.goto('file://' + path.join(input, `attendance-help-${locale}.html`))
      const summary = page.locator('summary'), details = page.locator('details')
      if (await details.evaluate(el => el.open)) throw Error('Help must start collapsed')
      await summary.focus(); await summary.press('Enter')
      if (!await details.evaluate(el => el.open)) throw Error('Enter did not open help')
      await summary.press('Space')
      if (await details.evaluate(el => el.open)) throw Error('Space did not close help')
      await summary.press('Enter')
      await page.screenshot({path: path.join(output, `attendance-help-${locale}-${width}.png`), fullPage: true})
      const result = await page.evaluate(() => ({width: innerWidth, scrollWidth: document.documentElement.scrollWidth, minTarget: document.querySelector('summary').getBoundingClientRect().height, topics: document.querySelectorAll('details section').length, keyboardFocused: document.activeElement === document.querySelector('summary'), expanded: document.querySelector('details').open, innerScrolls: [...document.querySelectorAll('*')].filter(el => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight + 1).length}))
      if (result.scrollWidth !== width || result.minTarget < 44 || !result.expanded || !result.keyboardFocused) throw Error('Help layout/accessibility check failed')
      results.push({locale, ...result}); await page.close()
    }
  } finally { await browser.close() }
  fs.writeFileSync(path.join(output, 'actual-capture-results.json'), JSON.stringify({sources, results}, null, 2) + '\n')
  console.log(JSON.stringify(results))
})().catch(error => {console.error(error); process.exitCode = 1})
