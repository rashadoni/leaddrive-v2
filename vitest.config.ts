import { defineConfig } from "vitest/config"
import path from "path"

const requestedWorkers = process.env.VITEST_MAX_WORKERS
const maxWorkers = requestedWorkers === undefined ? undefined : Number(requestedWorkers)
if (maxWorkers !== undefined && (!Number.isInteger(maxWorkers) || maxWorkers < 1)) {
  throw new Error("VITEST_MAX_WORKERS must be a positive integer")
}

export default defineConfig({
  test: {
    // The CI container explicitly budgets workers; Vitest does not read this
    // environment variable unless the configuration passes it through.
    maxWorkers,
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    setupFiles: ["./src/__tests__/setup-env.ts"],
    // Sized for where the suite actually runs, not for an idle laptop.
    //
    // CI is one Contabo VPS with 8 vCPU (docs/ci-cost-policy.md) shared by the
    // 12 GiB typecheck and up to three test jobs, each with four vitest
    // workers and a Postgres service container. Its memory is budgeted; its
    // CPU and disk are not. Measured on 2026-09-07 against idle timings:
    //
    //   no-session-object-in-effect-deps   0.95 s idle → >5 s   (default limit)
    //   voice-realtime-section-eval        3.06 s idle → >15 s  (its own limit)
    //
    // i.e. at least a 5× slowdown under contention. With the default 5 s these
    // legitimately-slow tests fail only when the box is busy, the JSON report
    // shows the failure as a bare `Error: STACK_TRACE_ERROR` (see
    // scripts/check-test-baseline.mjs), and the response is a re-run.
    //
    // A timeout exists to catch a hang, and a hang is still caught at 30 s.
    // It does not exist to enforce speed under someone else's load.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: {
      deps: {
        // next-auth and @auth/core are ESM that import "next/server" without an
        // extension. Left external, Node resolves that as a file path, fails,
        // and the SUITE never loads — vitest then reports one failed file and
        // ZERO failed tests, so six suites sat at zero assertions while the
        // headline count did not move. Inlining hands resolution to vite, which
        // reads the package's exports map and finds it.
        inline: [/next-auth/, /@auth\/core/],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
