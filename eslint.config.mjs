import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Field UX audit 2026-09-05 (W-02 / task C2): the MTM module formats dates
  // through src/lib/format-date.ts only. Direct Intl calls render Azerbaijani
  // as "2026 M09 5, Sat" and "Mon/Tue/Wed" on ICU builds without az data.
  {
    files: ["src/components/mtm/**/*.{ts,tsx}", "src/app/(dashboard)/mtm/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toLocaleDateString']",
          message: "Use formatDate() from @/lib/format-date so Azerbaijani dates never fall back to ICU's 'M09' month names.",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleTimeString']",
          message: "Use formatTime() from @/lib/format-date.",
        },
        {
          selector: "NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
          message: "Use createDateFormatter() / formatDate() / formatDateTime() from @/lib/format-date.",
        },
      ],
    },
  },
]);

export default eslintConfig;
