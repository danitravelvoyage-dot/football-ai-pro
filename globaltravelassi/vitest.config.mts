import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // Database tests build an in-memory Postgres (PGlite) and apply the migrations for every test. Under a full parallel
  // run on a small machine that can take longer than Vitest's 5-second default; it is load, not a hang.
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 20_000 },
});
