import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      "@spaghettilab/protocol": path.join(root, "src/index.ts"),
    },
  },
});
