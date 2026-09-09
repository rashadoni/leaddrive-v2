# Security audit 11 — RCE / code execution in code modules

Date: 2026-07-22

## Scope

Checked places where tenant/user-controlled input can become executable code or commands, with focus on Apex-equivalent code modules:

- `src/app/api/v1/code-modules/route.ts`
- `src/app/api/v1/code-modules/[id]/execute/route.ts`
- `src/lib/apex/engine.ts`
- `src/lib/apex/node-vm-executor.ts`
- `src/lib/apex/api-surface.ts`

## Findings

Existing protections confirmed:

- Code-module create/execute endpoints require `settings:write`.
- Manual execution only runs active modules from the current organization.
- CRM repositories are organization-scoped.
- Sandbox does not expose `process`, `require`, `fetch`, `Buffer`, or host globals.
- VM code generation from strings/WASM is disabled.
- Runtime and log output have absolute caps.
- Event/context payloads are deep-frozen.

Primary residual risk found:

- Code modules execute tenant-authored JavaScript through `node:vm`. Node's VM context is not a strong security boundary for hostile code, especially when host objects/functions are bridged into the sandbox.

## Fix shipped

Added a source guard for known Node VM escape and host-runtime primitives:

- dynamic code generation: `eval`, `Function`
- constructor/prototype escape primitives
- host runtime access: `globalThis`, `global`, `process`, `require`, `module.constructor`
- dynamic `import(...)`
- `WebAssembly`
- timers / event-loop escapes
- network/filesystem primitives such as `fetch`, `XMLHttpRequest`, `Buffer`, `fs`, `child_process`

The guard is enforced in two places:

1. At module creation, before storing source.
2. At execution time, so old modules already in the database are rejected before compilation/execution if they contain unsafe primitives.

## Residual risk / next hardening

This is defense-in-depth, not a replacement for a true isolate. Long-term recommended follow-up:

- Replace `node:vm` with a real isolate such as `isolated-vm` or a separate worker process/container with memory and CPU limits.
- Consider a feature flag to disable custom code modules for tenants that do not need them.
- Add an admin review screen for already-created code modules that are rejected by the runtime guard.
