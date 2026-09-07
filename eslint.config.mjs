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
    // 試作3: functions/ はFirebase Functions用の独立したプロジェクト
    // （別のnode_modules・tsconfigを持つ）。Next.jsアプリ用のこのESLint設定の
    // 対象外とする（functions/自体にはtscによる型チェックがある）。
    "functions/**",
  ]),
]);

export default eslintConfig;
