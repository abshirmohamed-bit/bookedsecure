import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Test-only config. Module transform/import of the server modules is slow in
 * CI-like environments, so the default 5s per-test timeout is raised to keep
 * the suite deterministic rather than load-dependent.
 */
export default defineConfig({
  test: {
    // Opt-in only: `canary/` makes real Lovable AI gateway calls, so it is
    // never part of the default suite. Run it explicitly with:
    //   RUN_AI_CANARY=1 bunx vitest run canary/ai-extraction.canary.test.ts
    exclude: [
      "node_modules/**",
      "dist/**",
      ...(process.env["RUN_AI_CANARY"] === "1" ? [] : ["canary/**"]),
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
