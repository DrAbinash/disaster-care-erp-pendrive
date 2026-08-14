import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@workspace/emergency-billing": path.resolve("lib/emergency-billing/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "lib/**/*.test.ts"],
  },
});
