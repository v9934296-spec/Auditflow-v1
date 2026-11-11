import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    // Suites share PostgreSQL cluster-wide roles; parallel creation races across databases.
    fileParallelism: false,
    include: ["tests/**/*.db.test.ts"],
  },
});