const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('/workspace/hrm-request-logging/node_modules/typescript');
const path = '/workspace/hrm-request-logging/src/lib/demo-center/telemetry.ts';
const source = fs.readFileSync(path, 'utf8');
const probeModule = { exports: {} };
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }}).outputText;
vm.runInNewContext(code, { exports: probeModule.exports, module: probeModule, WeakSet, Object, Array });
const canary = 'SYNTHETIC_WORKFORCE_PRIVATE_CANARY';
const event = {
  request: { url: 'https://synthetic.invalid/workforce/requests/' + canary, data: { reason: canary, latitude: 12.345, longitude: 67.89 } },
  exception: { values: [{ type: canary, value: canary }] },
  breadcrumbs: [{ message: canary, data: { employee: canary, token: canary } }],
  contexts: { workforce: { employeeId: canary } },
  extra: { demoUrl: 'https://synthetic.invalid/demo-access/' + 'a'.repeat(64) },
};
const out = probeModule.exports.scrubDemoTokens(event);
const result = {
  scope: 'Pure synthetic local scrubber call only; no SDK, network, production data or credentials',
  source: 'src/lib/demo-center/telemetry.ts',
  source_sha256: crypto.createHash('sha256').update(source).digest('hex'),
  checks: {
    demo_bearer_path_scrubbed: out.extra.demoUrl.endsWith('/demo-access/[redacted]'),
    workforce_request_path_canary_retained: out.request.url.includes(canary),
    request_reason_coordinates_retained: out.request.data.reason === canary && out.request.data.latitude === 12.345 && out.request.data.longitude === 67.89,
    exception_canary_retained: out.exception.values[0].value === canary,
    breadcrumb_canary_retained: out.breadcrumbs[0].data.employee === canary,
    context_canary_retained: out.contexts.workforce.employeeId === canary,
  },
  interpretation: 'Existing beforeSend hook is demo-path specific and does not establish Workforce event privacy. Constructed event acceptance is not proof this exact payload is captured or exported in production.',
};
fs.writeFileSync('/tmp/hrm-privacy-boundary-probe.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
