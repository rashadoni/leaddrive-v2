#!/usr/bin/env python3
"""
Deterministic RLS-context gap finder (the tool that found 83 + 13 gaps the agent
audit missed). Run from repo root: `python3 scripts/rls/find-context-gaps.py`.

It reports any route handler that reaches an ORG-SCOPED prisma model (a model with
an `organizationId` field) WITHOUT a context-delivering wrapper
(withRls/withRlsAuth/withRlsSessionAuth/withInboxSessionWrite/
withSocialMonitoringMutationFence/withSocialConnectAuth/withMobileRls/
withMobileFieldSuiteRls/withMobileTenantCapabilityRls/withMtmRlsAuth/
withRouteFieldRlsAuth/withRouteFieldWebRlsAuth/withWorkforceHrmRlsAuth/
withWorkforceRlsAuth/withWorkforceSessionAuth/withWorkforceSessionAdminAuth/
withWorkforceCompatAuth/
runWithTenant/runWithRlsBypass), at three depths:

  1. ROUTE-LEVEL   — handler does `prisma.<orgModel>` directly.
  2. LIB-DELEGATION (single level) — handler calls a helper that does direct org-prisma.
  3. LIB-DELEGATION (recursive)    — handler reaches org-prisma through a CHAIN of
                                     helpers (call-graph fixpoint, any depth).

A bare getOrgId/getSession/requireAuth is deliberately NOT a wrapper — it resolves
the org but does not DELIVER durable context (the 2026-06-11 snapshot-boundary
incident). The committed test `src/__tests__/rls-route-context-coverage.test.ts`
re-derives layer 1 as a build gate; layers 2+3 live here. Exit code 1 if any gap.

Companion runtime backstop: the prisma `$allOperations` extension logs `[RLS-GUARD]`
for any no-context org query at runtime (src/lib/prisma.ts). Note: these static
checks verify context PRESENCE, not context CORRECTNESS (a handler wrapped with the
WRONG org is a confused-deputy authz bug none of this catches).

KNOWN LIMITS (architect 2026-06-16, [P2] — zero live gaps today, but a FUTURE caller
could slip; the runtime [RLS-GUARD] still catches these at execution):
  - org access is matched as `prisma.<model>` only — `tx.<model>` inside an interactive
    `$transaction(async (tx) => …)` is invisible to the model regex (all 11 such files
    are currently inside wrapped blocks, so harmless now).
  - the call graph captures only `function foo(){…}` and `const foo = (…) => {…}` shapes;
    class methods, object-literal methods, and `const foo = async function(){…}` helpers
    are NOT in the graph (~43 org-touching exports of those shapes exist, none reached
    from an unwrapped handler today). A future unwrapped caller of one of those helpers
    would report 0 here — rely on the runtime [RLS-GUARD] for that class.
  To shrink: broaden the func-capture regex to method-shape + add `\\btx\\.` as a second
  access alias. Not done because current live-gap count is zero.
"""
import re, glob, sys

ROOT = "."
# Keep this in sync with the TypeScript coverage gate: route wrappers may carry
# an explicit Next.js context type, e.g. withRlsAuth<RouteContext>(...).
DELIVER = re.compile(
    r'withRls(?:<[^>]+>)?\('
    r'|withRlsAuth(?:<[^>]+>)?\('
    r'|withRlsSessionAuth(?:<[^>]+>)?\('
    r'|withInboxSessionWrite(?:<[^>]+>)?\('
    r'|withSocialMonitoringMutationFence(?:<[^>]+>)?\('
    r'|withSocialConnectAuth\('
    r'|withMobileRls(?:<[^>]+>)?\('
    r'|withMobileFieldSuiteRls(?:<[^>]+>)?\('
    r'|withMobileTenantCapabilityRls(?:<[^>]+>)?\('
    r'|withMtmRlsAuth(?:<[^>]+>)?\('
    r'|withRouteFieldRlsAuth(?:<[^>]+>)?\('
    r'|withRouteFieldWebRlsAuth(?:<[^>]+>)?\('
    r'|withWorkforceHrmRlsAuth(?:<[^>]+>)?\('
    r'|withWorkforceRlsAuth(?:<[^>]+>)?\('
    r'|withWorkforceSessionAuth(?:<[^>]+>)?\('
    r'|withWorkforceSessionAdminAuth(?:<[^>]+>)?\('
    r'|withWorkforceCompatAuth(?:<[^>]+>)?\('
    r'|runWithTenant|runWithRlsBypass'
)


def org_models():
    schema = open("prisma/schema.prisma").read()
    out = []
    for m in re.finditer(r'^model\s+(\w+)\s*\{([\s\S]*?)\n\}', schema, re.M):
        if re.search(r'^\s+organizationId\s', m.group(2), re.M):
            n = m.group(1)
            out.append(n[0].lower() + n[1:])
    return out


def brace_body(src, i):
    depth, j = 1, i
    while j < len(src) and depth > 0:
        c = src[j]
        depth += (c == '{') - (c == '}')
        j += 1
    return src[i:j - 1]


def main():
    models = org_models()
    model_re = re.compile(r'prisma\.(' + '|'.join(models) + r')\b')

    # build the helper call graph across src/ (lib/server/app helpers)
    funcs = {}
    for f in glob.glob("src/**/*.ts", recursive=True):
        if "__tests__" in f:
            continue
        src = open(f).read()
        for m in re.finditer(r'(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)[^{]*\{', src):
            funcs.setdefault(m.group(1), brace_body(src, m.end()))
        for m in re.finditer(r'(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>\s*\{', src):
            funcs.setdefault(m.group(1), brace_body(src, m.end()))

    direct = {n: bool(model_re.search(b)) for n, b in funcs.items()}
    haswrap = {n: bool(DELIVER.search(b)) for n, b in funcs.items()}
    calls = {n: {c for c in re.findall(r'\b(\w+)\s*\(', b) if c in funcs} for n, b in funcs.items()}

    # fixpoint: fn REQUIRES context if (direct org-prisma OR calls a ctx-req fn) AND it does not self-wrap
    ctx_req = {n for n in funcs if direct[n] and not haswrap[n]}
    changed = True
    while changed:
        changed = False
        for n in funcs:
            if n in ctx_req or haswrap[n]:
                continue
            if calls[n] & ctx_req:
                ctx_req.add(n)
                changed = True
    call_re = re.compile(r'\b(' + '|'.join(re.escape(c) for c in ctx_req) + r')\s*\(') if ctx_req else None

    gaps = []
    for f in glob.glob("src/app/api/**/route.ts", recursive=True):
        src = open(f).read()
        starts = [(m.start(), m.group(1)) for m in
                  re.finditer(r'export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b', src)]
        for i, (pos, method) in enumerate(starts):
            end = starts[i + 1][0] if i + 1 < len(starts) else len(src)
            block = src[pos:end]
            if DELIVER.search(block):
                continue
            if model_re.search(block):
                gaps.append(f"{f} :: {method}  [direct org-prisma]")
            elif call_re and call_re.search(block):
                gaps.append(f"{f} :: {method}  [delegates to: {','.join(sorted(set(call_re.findall(block))))}]")

    print(f"org-scoped models: {len(models)} | context-requiring helpers (any depth): {len(ctx_req)}")
    print(f"RLS-CONTEXT GAPS: {len(gaps)}")
    for g in gaps:
        print("  " + g)
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
