#!/usr/bin/env python3
"""
Deterministic RLS-context gap finder (the tool that found 83 + 13 gaps the agent
audit missed). Run from repo root: `python3 scripts/rls/find-context-gaps.py`.

It reports any route handler that reaches an ORG-SCOPED prisma model (a model with
an `organizationId` field) WITHOUT a context-delivering wrapper
(withRls/withRlsAuth/withRlsSessionAuth/withInboxSessionWrite/
withSocialMonitoringMutationFence/withSocialConnectAuth/withMobileRls/
withMobileFieldSuiteRls/withMobileTenantCapabilityRls/withMtmRlsAuth/
withRouteFieldRlsAuth/withRouteFieldWebRlsAuth/withMtmAttendanceAuth/withWorkforceHrmRlsAuth/
withWorkforceRlsAuth/withWorkforceSessionAuth/withWorkforceSessionAdminAuth/
withWorkforceSessionGrantManagementAuth/
withWorkforceSessionEvidenceTimelineAuth/withWorkforceSessionExceptionQueueAuth/
withWorkforceSessionPolicyConfigurationAuth/
withWorkforceSessionPilotFenceAuth/
withWorkforceSessionRetentionReadAuth/
withWorkforceSessionScheduleConfigurationAuth/
withWorkforceCompatAuth/
runWithTenant/runWithRlsBypass), at three depths:

  1. ROUTE-LEVEL   — handler does `prisma.<orgModel>` directly.
  2. LIB-DELEGATION (single level) — handler calls a helper that does direct org-prisma.
  3. LIB-DELEGATION (recursive)    — handler reaches org-prisma through a CHAIN of
                                     helpers (call-graph fixpoint, any depth).

A bare getOrgId/getSession/requireAuth is deliberately NOT a wrapper — it resolves
the org but does not DELIVER durable context (the 2026-06-11 snapshot-boundary
incident). The committed test `src/__tests__/rls-route-context-coverage.test.ts`
re-derives layer 1 as a build gate; layers 2+3 live here. Exit code 1 if any gap,
2 if the script could not read the tree (a gate that cannot look is not green).

DETERMINISM (2026-10-31). The input is the files git tracks (`git ls-files`),
sorted, and a call is resolved the way TypeScript resolves it: to a function of
the same file, or through that file's imports (static, `await import(...)`,
`import * as ns`) and the re-exports (`export {…} from`, `export * from`) of the
module it names. Until then helpers were keyed by bare name across all of src/
and the FIRST definition found won (`setdefault`): 523 names are defined in more
than one file (`POST` in 208, `record` in 51…), so the answer depended on the
order the filesystem returned directory entries in. On one tree it printed 1052,
1069 and 1605 context-requiring helpers and 0, 2 or 4 gaps on different
machines, and deploy run 41211546756 failed on attempt 1 and passed on a rerun.

Companion runtime backstop: the prisma `$allOperations` extension logs `[RLS-GUARD]`
for any no-context org query at runtime (src/lib/prisma.ts). Note: these static
checks verify context PRESENCE, not context CORRECTNESS (a handler wrapped with the
WRONG org is a confused-deputy authz bug none of this catches).

KNOWN LIMITS (architect 2026-06-16, [P2] — the runtime [RLS-GUARD] still catches
these at execution):
  - org access is matched as `prisma.<model>` only — `tx.<model>` inside an interactive
    `$transaction(async (tx) => …)` is invisible to the model regex.
  - the call graph captures only `function foo(){…}` and `const foo = (…) => {…}` shapes;
    class methods, object-literal methods, and `const foo = async function(){…}` helpers
    are NOT in the graph. A member call `obj.foo(…)` is followed only when `obj` is a
    namespace import of a module.
  - a function that contains a wrapper anywhere in its body counts as delivering
    context for all of it.
"""
import os, posixpath, re, subprocess, sys

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
    r'|withMtmAttendanceAuth(?:<[^>]+>)?\('
    r'|withWorkforceHrmRlsAuth(?:<[^>]+>)?\('
    r'|withWorkforceRlsAuth(?:<[^>]+>)?\('
    r'|withWorkforceSessionAuth(?:<[^>]+>)?\('
    r'|withWorkforceSessionAdminAuth(?:<[^>]+>)?\('
    r'|withWorkforceSessionGrantManagementAuth(?:<[^>]+>)?\('
    r'|withWorkforceSessionEvidenceTimelineAuth(?:<[^>]+>)?\('
    r'|withWorkforceSessionExceptionQueueAuth(?:<[^>]+>)?\('
    r'|withWorkforceSessionPolicyConfigurationAuth(?:<[^>]+>)?\('
    r'|withWorkforceSessionPilotFenceAuth(?:<[^>]+>)?\('
    r'|withWorkforceSessionRetentionReadAuth(?:<[^>]+>)?\('
    r'|withWorkforceSessionScheduleConfigurationAuth(?:<[^>]+>)?\('
    r'|withWorkforceCompatAuth(?:<[^>]+>)?\('
    r'|runWithTenant|runWithRlsBypass'
)

FUNC_DECL = re.compile(r'(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)[^{]*\{')
ARROW_DECL = re.compile(r'(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>\s*\{')
DEFAULT_FUNC = re.compile(r'export\s+default\s+(?:async\s+)?function\s+(\w+)')
DEFAULT_NAME = re.compile(r'export\s+default\s+(\w+)\s*;?\s*$', re.M)
STATIC_IMPORT = re.compile(
    r'^\s*import\s+(?!type\s)(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s*as\s+(\w+))?\s*from\s*["\']([^"\']+)["\']',
    re.M)
DYNAMIC_DESTRUCTURE = re.compile(r'\{([^{}]*)\}\s*=\s*await\s+import\(\s*["\']([^"\']+)["\']\s*\)')
DYNAMIC_NAMESPACE = re.compile(r'(?:const|let|var)\s+(\w+)\s*=\s*await\s+import\(\s*["\']([^"\']+)["\']\s*\)')
DYNAMIC_MEMBER_CALL = re.compile(r'\(\s*await\s+import\(\s*["\']([^"\']+)["\']\s*\)\s*\)\s*\.\s*(\w+)\s*\(')
REEXPORT_NAMED = re.compile(r'^\s*export\s+(?!type\s)\{([^}]*)\}\s*from\s*["\']([^"\']+)["\']', re.M)
REEXPORT_STAR = re.compile(r'^\s*export\s+\*\s+from\s*["\']([^"\']+)["\']', re.M)
EXPORT_LOCAL = re.compile(r'^\s*export\s+(?!type\s)\{([^}]*)\}\s*;?\s*$', re.M)
BARE_CALL = re.compile(r'(?<![\w$.])(\w+)\s*(?:<[^<>()]*>)?\s*\(')
MEMBER_CALL = re.compile(r'(?<![\w$.])(\w+)\s*\.\s*(\w+)\s*\(')
HANDLER = re.compile(r'export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b')


def tracked_files():
    try:
        out = subprocess.run(["git", "ls-files", "-z", "--", "src"],
                             check=True, capture_output=True).stdout
    except (OSError, subprocess.CalledProcessError) as exc:
        sys.exit(f"find-context-gaps: cannot list tracked files with git: {exc}")
    files = sorted(p for p in out.decode().split("\0") if p.endswith(".ts")
                   and "__tests__" not in p and os.path.isfile(p))
    if not files:
        sys.exit("find-context-gaps: git lists no tracked src/**/*.ts — refusing to report 0 gaps")
    return files


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


def specifiers(group, separator):
    """`a, b as c, type D` -> [(imported, local)]; separator is `as` or `:`."""
    pairs = []
    for item in group.split(","):
        item = re.sub(r'^\s*type\s+', '', item).strip()
        if not item:
            continue
        parts = [p.strip() for p in item.split(separator, 1)]
        imported = parts[0]
        local = parts[1] if len(parts) > 1 else parts[0]
        local = local.split("=")[0].strip()  # `{ a = 1 }` default in destructuring
        if re.fullmatch(r'\w+', imported) and re.fullmatch(r'\w+', local):
            pairs.append((imported, local))
    return pairs


class Module:
    def __init__(self, path, src):
        self.path = path
        self.src = src
        self.defs = {}        # name -> [node id]
        self.imports = {}     # local name -> [(spec, imported name)]
        self.namespaces = {}  # local name -> [spec]
        self.reexports = {}   # exported name -> [(spec or None, name)]
        self.star = []        # [spec]


class Graph:
    def __init__(self, files):
        self.files = set(files)
        self.modules = {}
        self.bodies = []      # node id -> (module path, name, body)
        for path in files:
            self.modules[path] = self.parse(path, open(path, encoding="utf-8").read())
        self._exports = {}

    def parse(self, path, src):
        mod = Module(path, src)
        for regex in (FUNC_DECL, ARROW_DECL):
            for m in regex.finditer(src):
                mod.defs.setdefault(m.group(1), []).append(len(self.bodies))
                self.bodies.append((path, m.group(1), brace_body(src, m.end())))
        for m in DEFAULT_FUNC.finditer(src):
            mod.reexports.setdefault("default", []).append((None, m.group(1)))
        for m in DEFAULT_NAME.finditer(src):
            mod.reexports.setdefault("default", []).append((None, m.group(1)))
        for m in STATIC_IMPORT.finditer(src):
            default, named, namespace, spec = m.groups()
            if default:
                mod.imports.setdefault(default, []).append((spec, "default"))
            if named:
                for imported, local in specifiers(named, " as "):
                    mod.imports.setdefault(local, []).append((spec, imported))
            if namespace:
                mod.namespaces.setdefault(namespace, []).append(spec)
        for m in DYNAMIC_DESTRUCTURE.finditer(src):
            for imported, local in specifiers(m.group(1), ":"):
                mod.imports.setdefault(local, []).append((m.group(2), imported))
        for m in DYNAMIC_NAMESPACE.finditer(src):
            mod.namespaces.setdefault(m.group(1), []).append(m.group(2))
        for m in REEXPORT_NAMED.finditer(src):
            for imported, exported in specifiers(m.group(1), " as "):
                mod.reexports.setdefault(exported, []).append((m.group(2), imported))
        for m in REEXPORT_STAR.finditer(src):
            mod.star.append(m.group(1))
        for m in EXPORT_LOCAL.finditer(src):
            for local, exported in specifiers(m.group(1), " as "):
                mod.reexports.setdefault(exported, []).append((None, local))
        return mod

    def resolve_spec(self, from_path, spec):
        if spec.startswith("@/"):
            base = "src/" + spec[2:]
        elif spec.startswith("."):
            base = posixpath.normpath(posixpath.join(posixpath.dirname(from_path), spec))
        else:
            return None  # a package: not our source
        stem = re.sub(r'\.(?:js|ts)$', '', base)
        for candidate in (base, stem + ".ts", stem + "/index.ts"):
            if candidate in self.files:
                return candidate
        return None

    def local(self, mod, name, seen):
        """Nodes a bare `name` refers to inside module `mod`."""
        nodes = list(mod.defs.get(name, []))
        for spec, imported in mod.imports.get(name, []):
            target = self.resolve_spec(mod.path, spec)
            if target:
                nodes += self.exported(target, imported, seen)
        return nodes

    def exported(self, path, name, seen=None):
        """Nodes module `path` exports under `name`, following re-exports."""
        key = (path, name)
        if key in self._exports:
            return self._exports[key]
        seen = set() if seen is None else seen
        if key in seen:
            return []
        seen.add(key)
        mod = self.modules[path]
        nodes = list(mod.defs.get(name, [])) if name != "default" else []
        for spec, inner in mod.reexports.get(name, []):
            if spec is None:
                nodes += self.local(mod, inner, seen)
            else:
                target = self.resolve_spec(path, spec)
                if target:
                    nodes += self.exported(target, inner, seen)
        if not nodes and name != "default":
            for spec in mod.star:
                target = self.resolve_spec(path, spec)
                if target:
                    nodes += self.exported(target, name, seen)
        nodes = sorted(set(nodes))
        if not seen - {key}:  # only memoise answers not cut short by a cycle
            self._exports[key] = nodes
        seen.discard(key)
        return nodes

    def callees(self, path, text):
        """{node id: called name} for every call in `text`, resolved from module `path`."""
        mod = self.modules[path]
        out = {}
        for name in set(BARE_CALL.findall(text)):
            for node in self.local(mod, name, set()):
                out[node] = name
        for obj, name in set(MEMBER_CALL.findall(text)):
            for spec in mod.namespaces.get(obj, []):
                target = self.resolve_spec(path, spec)
                if target:
                    for node in self.exported(target, name):
                        out[node] = f"{obj}.{name}"
        for spec, name in set(DYNAMIC_MEMBER_CALL.findall(text)):
            target = self.resolve_spec(path, spec)
            if target:
                for node in self.exported(target, name):
                    out[node] = name
        return out


def main():
    files = tracked_files()
    models = org_models()
    model_re = re.compile(r'prisma\.(' + '|'.join(models) + r')\b')
    graph = Graph(files)

    bodies = graph.bodies
    direct = [bool(model_re.search(b)) for _, _, b in bodies]
    haswrap = [bool(DELIVER.search(b)) for _, _, b in bodies]
    callers = [set() for _ in bodies]
    for caller, (path, _, body) in enumerate(bodies):
        for callee in graph.callees(path, body):
            callers[callee].add(caller)

    # fixpoint: fn REQUIRES context if (direct org-prisma OR calls a ctx-req fn) AND it does not self-wrap
    ctx_req = {n for n in range(len(bodies)) if direct[n] and not haswrap[n]}
    work = sorted(ctx_req)
    while work:
        callee = work.pop()
        for caller in callers[callee]:
            if caller not in ctx_req and not haswrap[caller]:
                ctx_req.add(caller)
                work.append(caller)

    routes = [f for f in files if f.startswith("src/app/api/") and f.endswith("/route.ts")]
    if not routes:
        sys.exit("find-context-gaps: no tracked src/app/api/**/route.ts — refusing to report 0 gaps")
    gaps = []
    for f in routes:
        src = graph.modules[f].src
        starts = [(m.start(), m.end(), m.group(1)) for m in HANDLER.finditer(src)]
        for i, (pos, header_end, method) in enumerate(starts):
            end = starts[i + 1][0] if i + 1 < len(starts) else len(src)
            block = src[pos:end]
            if DELIVER.search(block):
                continue
            if model_re.search(block):
                gaps.append(f"{f} :: {method}  [direct org-prisma]")
                continue
            reached = sorted({name for node, name in graph.callees(f, src[header_end:end]).items() if node in ctx_req})
            if reached:
                gaps.append(f"{f} :: {method}  [delegates to: {','.join(reached)}]")

    print(f"tracked files: {len(files)} | route files: {len(routes)} | helpers in graph: {len(bodies)}")
    print(f"org-scoped models: {len(models)} | context-requiring helpers (any depth): {len(ctx_req)}")
    print(f"RLS-CONTEXT GAPS: {len(gaps)}")
    for g in gaps:
        print("  " + g)
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
