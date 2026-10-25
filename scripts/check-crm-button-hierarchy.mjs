/** Source guard for ordinary CRM actions. Status/provider/toggle controls must
 * declare their colour role explicitly; public sites and demo replicas are not
 * authenticated CRM workflows. This scan is source coverage, not browser proof. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const publicSurfaces = [
  'src/components/marketing/', 'src/components/demo-center/',
  'src/components/portal-chat-widget.tsx',
  'src/components/form-builder/public-form-widget.tsx',
  'src/components/ui/shimmer-button.tsx',
];
const basePrimary = /(?:["`\s])bg-primary(?=[\s"`])/;
const customFill = /(?:["`\s])(?:bg-(?:orange|amber|blue|indigo|purple|violet|cyan|teal|emerald|green)-[4-9]\d\d(?=[\s"`])|bg-\[#[\da-fA-F]+\])/;
const selection = /filter|selected|activeTab|discountMode|clientMode|addMode|myTasksOnly|flowView|overdue|currentPage|startsAt|daysBeforeDeadline|\bview\b/i;
const roles = new Set(['status', 'provider', 'call', 'toggle']);

export function findButtonViolations(source, file = 'fixture.tsx') {
  if (publicSurfaces.some(prefix => file.startsWith(prefix))) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (['Button', 'button', 'a', 'Link', 'Badge'].includes(tag)) {
        const attrs = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(sf), a.initializer?.getText(sf) ?? 'true']));
        if (tag === 'Badge' && !attrs.onClick) return;
        const classes = attrs.className ?? '';
        const variant = attrs.variant ?? '"default"';
        const semantic = roles.has((attrs['data-crm-color-role'] ?? '').replaceAll('"', ''));
        const add = rule => problems.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, rule });
        if (tag === 'Badge' && attrs.onClick && !semantic && variant.includes('"default"')) add('interactive-badge-uses-primary');
        if (tag === 'Button' && variant.startsWith('{') && variant.includes('"default"') && selection.test(variant) && !semantic) add('selection-uses-primary');
        if (tag !== 'Button' && basePrimary.test(classes) && !attrs['data-crm-button'] && !attrs['data-crm-tab'] && !attrs['data-crm-filter'] && !semantic) add('native-primary-without-shared-style');
        if (customFill.test(classes) && !semantic) add('local-action-colour');
        if (tag === 'Button' && /default|brand/.test(variant) && /(?:["`\s])text-white(?=[\s"`])/.test(classes) && !semantic && !/bg-(?:red|rose)-/.test(classes)) add('fixed-white-text-breaks-dark-primary');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return problems;
}

export function scanCrmButtons(root = process.cwd()) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.tsx')) files.push(file);
    }
  }
  walk('src/app/(dashboard)'); walk('src/components');
  return { files: files.length, problems: files.flatMap(file => findButtonViolations(fs.readFileSync(path.join(root, file), 'utf8'), file)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = scanCrmButtons();
  console.log(JSON.stringify(result, null, 2));
  if (result.problems.length) process.exitCode = 1;
}
