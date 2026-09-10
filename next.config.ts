import createNextIntlPlugin from "next-intl/plugin"
import withSerwistInit from "@serwist/next"
import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")
const nextBuildCpus = process.env.NEXT_BUILD_CPUS
  ? Number(process.env.NEXT_BUILD_CPUS)
  : undefined

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // Precache the offline fallback page so the SW can serve it without a
  // network request. revision:null means the SW does NOT use a hash to
  // fingerprint this entry — instead serwist re-fetches and re-caches /offline
  // on every new SW install (i.e. on every deploy). That is correct behaviour:
  // the page is static, and the next deploy naturally refreshes it.
  additionalPrecacheEntries: [{ url: "/offline", revision: null }],
})

const nextConfig: NextConfig = {
  output: "standalone",
  // Avoid advertising the framework on every public response. Error handling
  // and observability must not rely on an unauthenticated technology banner.
  poweredByHeader: false,
  // Build-memory: the custom webpack hook below disables Next's default build
  // worker unless it is opted back in explicitly. Keep server, edge and client
  // compilation in disposable sequential workers so one compiler graph cannot
  // retain the previous graph on the 8 GiB hosted runner. The lower-risk
  // webpack memory optimizations stay enabled for the same reason.
  experimental: {
    cpus: nextBuildCpus,
    webpackBuildWorker: process.env.LEADDRIVE_COLD_PRODUCTION_BUILD === "1" ? true : undefined,
    webpackMemoryOptimizations: process.env.PROD_BUILD_FAST !== "1",
  },
  // Kept so prerender-without-DB builds don't fail on env-dependent type
  // resolution. The note that used to sit here — "tsc currently passes clean
  // (0 errors, 2026-05-30)" — went stale: the baseline was 568 errors by
  // 2026-08-09, and on 2026-08-11 this flag let `Cannot find name 'tc'` build
  // successfully and crash the inbox in the browser. Nothing here guards that;
  // the guard is the blocking TS2304/TS2307/TS1xxx grep in pr-checks.yml.
  typescript: { ignoreBuildErrors: true },
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  // d3-force is ESM-only; transpile it through the app pipeline so the KPI-Arena
  // bubble component's client bundle/manifest is generated cleanly under
  // Next 16 + webpack standalone (paired with the ssr:false dynamic import).
  transpilePackages: ["d3-force"],

  // NOTE: do NOT add outputFileTracingIncludes for Prisma here. It makes
  // Next.js pre-create .next/standalone/node_modules/.prisma/ with a partial
  // tree during build, and then the deploy workflow's
  // `cp -r node_modules/.prisma .next/standalone/node_modules/.prisma`
  // nests everything under .prisma/.prisma/ — leaving Prisma unable to find
  // the query engine at runtime. The CI workflow copies the full Prisma
  // client explicitly into the standalone bundle.
  //
  // F-39: heic-convert + its full runtime dependency chain is force-traced
  // into the photos route bundle. Both static `import heicConvert` at
  // module-top AND dynamic `await import()` empirically failed to pull it
  // in (verified: prod standalone node_modules missing the directory).
  // Chain: heic-convert → heic-decode → libheif-js (WASM) + jpeg-js +
  // pngjs. None of these are traceable by webpack because libheif-js
  // dynamically `require`s its WASM blob at runtime. Explicit include is
  // the only path that survives `output: "standalone"`. No CI-step
  // manual-copy collision (unlike Prisma).
  outputFileTracingIncludes: {
    "/api/v1/mtm/photos/**": [
      "./node_modules/heic-convert/**",
      "./node_modules/heic-decode/**",
      "./node_modules/libheif-js/**",
      "./node_modules/jpeg-js/**",
      "./node_modules/pngjs/**",
    ],
  },

  // libheif-js loads its WASM blob through a deliberate runtime `require`.
  // Webpack cannot statically analyze that dependency and emits a critical
  // dependency warning even though the standalone tracing includes the full
  // runtime chain above. Keep this narrowly scoped to the known vendor file.
  webpack(config) {
    // CI production builds start from an empty checkout and never reuse .next.
    // A filesystem cache only consumes the hosted runner's bounded disk there;
    // disabling it also prevents interrupted pack files from crowding out the
    // standalone artifact. Developer builds retain Next's normal cache.
    if (process.env.LEADDRIVE_COLD_PRODUCTION_BUILD === "1") {
      config.cache = false
    }
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /libheif-js[\\/]libheif-wasm[\\/]libheif-bundle\.js$/,
        message: /require function is used in a way in which dependencies cannot be statically extracted/,
      },
    ]
    // zod@4 ships `"sideEffects": false`, but its barrel entry
    // (node_modules/zod/v4/classic/external.js) registers the English locale at
    // import time: `config(en())`. webpack believes the package flag, skips the
    // barrel as a pure re-export chain, and the locale is never registered — so
    // in a production build EVERY zod issue falls back to the bare string
    // "Invalid input", with no field and no reason. `next dev` does not
    // tree-shake, so this is invisible until the artifact is on prod: on
    // 2026-09-10 the admin could not create a tenant because /api/v1/admin/tenants
    // answered "Invalid input" and named neither the field nor what was wrong.
    // Marking zod's modules side-effectful keeps the barrel in the graph.
    // Verified with a minimal webpack build: without this rule the message is
    // "Invalid input", with it "Invalid input: expected string, received undefined".
    config.module.rules.push({
      test: /[\\/]node_modules[\\/]zod[\\/]/,
      sideEffects: true,
    })
    return config
  },

  // F-41: route /uploads/* through the API proxy BEFORE filesystem/public
  // lookup. The object form is security-critical: an array-form rewrite runs
  // after public-file resolution, so a real runtime file could bypass the API
  // route's anonymous-name/session/RBAC policy. DB rows already store
  // `/uploads/<subdir>/<file>` URLs, so no reference migration is needed.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/uploads/:path*", destination: "/api/v1/uploads/:path*" },
      ],
      afterFiles: [],
      fallback: [],
    }
  },
  // The omni-channel workspace is now the canonical inbox at /inbox (the old 2-zone view
  // is archived at /inbox/legacy, unlinked). The former /inbox/v2 URL — and any open tabs
  // or bookmarks — redirect to /inbox. EXACT-match source: /inbox/analytics, /inbox/web-chat,
  // /inbox/chatbot-rules and /inbox/legacy are untouched.
  async redirects() {
    return [
      { source: "/inbox/v2", destination: "/inbox", permanent: false },
    ]
  },
}

export default withSentryConfig(withSerwist(withNextIntl(nextConfig)), {
  // Only upload source maps when SENTRY_AUTH_TOKEN is set
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    // Delete maps after upload so they aren't served in client bundles
    // (replaces the removed `hideSourceMaps` option in @sentry/nextjs v10).
    deleteSourcemapsAfterUpload: true,
  },

  // Suppress logs unless debugging
  silent: !process.env.CI,

  // Organization and project (set via env or here)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token for source map uploads
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Automatically tree-shake Sentry logger statements (Sentry v10 API)
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
})
