/**
 * Unit tests for the app's pure TypeScript logic (no React Native runtime needed):
 *   pnpm --filter @hayat/mobile test
 *
 * Vite's built-in TS transform tries to resolve `extends: "expo/tsconfig.base"`, which the
 * `expo` package does not export, so test files are transpiled with TypeScript itself.
 */
import path from "node:path";
import ts from "typescript";
import { defineConfig, type Plugin } from "vitest/config";

const transpileTs: Plugin = {
  name: "hayat:transpile-ts",
  enforce: "pre",
  transform(code, id) {
    if (!/\.tsx?$/.test(id.split("?")[0])) return null;
    const out = ts.transpileModule(code, {
      fileName: id,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, sourceMap: true, jsx: ts.JsxEmit.ReactJSX },
    });
    return { code: out.outputText, map: out.sourceMapText ? JSON.parse(out.sourceMapText) : null };
  },
};

export default defineConfig({
  oxc: false,
  plugins: [transpileTs],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
