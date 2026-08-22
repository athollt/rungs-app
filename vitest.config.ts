import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import "dotenv/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Unit tests are *.test.ts; Playwright owns e2e/*.spec.ts. Keep the two
    // runners from colliding (Vitest's default glob also matches .spec.ts).
    include: ["**/*.test.{ts,tsx}"],
    // Globs, not bare names: a bare "node_modules" only matches a path equal
    // to it, so nested package tests were collected and run (938 of them).
    // .claude holds the agent worktrees, which are copies of this repo and
    // would otherwise have every test collected a second time.
    exclude: [
      "**/node_modules/**",
      "**/e2e/**",
      "**/.next/**",
      "**/.claude/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
